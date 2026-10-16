// Processo principal do Zaliel: janelas, arquivos .zal, recuperação e bloqueio de rede.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, type BrowserWindowConstructorOptions } from 'electron';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Updater } from './updater';
import { IMPORT_EXTENSIONS } from './importer';
import createImportWorker from './import-worker?nodeWorker';
import { startAutomation, newToken, DEFAULT_PORT, type AutomationServer, type AutomationSettings } from './automation';

// Gancho de desenvolvimento: perfil separado para testes (--user-data=<pasta>)
const userDataArg = process.argv.find((a) => a.startsWith('--user-data='));
if (userDataArg) app.setPath('userData', path.resolve(userDataArg.slice('--user-data='.length)));

const isMac = process.platform === 'darwin';
const DEV_URL = process.env.ELECTRON_RENDERER_URL;

interface WinState {
  dirty: boolean;
  allowClose: boolean;
  path: string | null;
}
const state = new WeakMap<BrowserWindow, WinState>();
const pendingOpen: string[] = [];
let updater: Updater;

// ── Utilidades de arquivo ────────────────────────────────────────────────────

const dataFile = (name: string) => path.join(app.getPath('userData'), name);

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Grava de forma segura: arquivo temporário + renomear (não corrompe se faltar luz). */
async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  try {
    await fs.rename(tmp, file);
  } catch (e) {
    // no Windows, renomear por cima de um arquivo aberto pode falhar: grava direto
    await fs.writeFile(file, data);
    await fs.rm(tmp, { force: true });
    if ((e as NodeJS.ErrnoException).code !== 'EPERM' && (e as NodeJS.ErrnoException).code !== 'EBUSY') throw e;
  }
}

const zalArg = (argv: string[]) => argv.slice(1).find((a) => /\.zal$/i.test(a) && !a.startsWith('--') && existsSync(a));

// ── Configurações, recentes e recuperação ───────────────────────────────────

const DEFAULT_SETTINGS = { theme: 'system', nudge: 1, bigNudge: 10, pixelGrid: true, snapping: true, welcomed: false, rulers: true, layoutGrids: true, autoSave: true, author: '', automation: { enabled: false, port: DEFAULT_PORT, token: '' } as AutomationSettings };

// ── Automação local (desligada até o usuário ligar nas preferências) ────────

let automation: AutomationServer | null = null;
let automationConf: AutomationSettings | null = null;
let automationError: string | null = null;
const automationReady = new Set<number>(); // webContents com o editor pronto para receber pedidos
let lastFocused: number | null = null;
let automationSeq = 0;
const automationPending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

/** Caminho da ponte stdio (fora do .asar no app instalado, para dar para executar). */
function bridgePath(): string {
  return path.join(__dirname, 'ponte.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

/** Janela que recebe os pedidos: a última focada com o editor pronto (abre uma se não houver). */
async function automationTarget(): Promise<Electron.WebContents> {
  const pick = () => {
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && automationReady.has(w.webContents.id));
    return wins.find((w) => w.webContents.id === lastFocused) ?? wins[0];
  };
  let win = pick();
  if (!win) {
    if (!BrowserWindow.getAllWindows().length) createWindow();
    for (let i = 0; i < 200 && !win; i++) {
      await new Promise((r) => setTimeout(r, 100));
      win = pick();
    }
  }
  if (!win) throw new Error('A janela do Zaliel não ficou pronta.');
  return win.webContents;
}

async function automationCall(payload: unknown, timeoutMs = 180000): Promise<unknown> {
  const wc = await automationTarget();
  const id = ++automationSeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      automationPending.delete(id);
      reject(new Error('O editor demorou demais para responder.'));
    }, timeoutMs);
    automationPending.set(id, { resolve, reject, timer });
    wc.send('automation:request', { id, payload });
  });
}

async function syncAutomation(conf: AutomationSettings | undefined): Promise<void> {
  const next = conf ?? DEFAULT_SETTINGS.automation;
  const same = automationConf && automationConf.enabled === next.enabled && automationConf.port === next.port && automationConf.token === next.token;
  if (same && (automation || !next.enabled)) return;
  automationConf = { ...next };
  if (automation) {
    await automation.close();
    automation = null;
  }
  automationError = null;
  if (!next.enabled || !next.token) return;
  try {
    automation = await startAutomation(next, {
      version: app.getVersion(),
      describe: () => automationCall({ kind: 'describe' }) as Promise<{ tools: unknown[]; instructions: string }>,
      call: (name, args) => automationCall({ kind: 'call', name, args }) as Promise<{ content: unknown[]; isError?: boolean }>,
    });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    automationError = code === 'EADDRINUSE' ? `A porta ${next.port} já está em uso por outro programa.` : String((e as Error)?.message ?? e);
  }
}

async function automationSettings(): Promise<AutomationSettings> {
  const s = { ...DEFAULT_SETTINGS, ...(await readJson<Record<string, unknown>>(dataFile('settings.json'), {})) };
  return { ...DEFAULT_SETTINGS.automation, ...((s.automation as AutomationSettings) ?? {}) };
}

interface Recent {
  path: string;
  name: string;
  openedAt: number;
}

async function recentList() {
  const list = await readJson<Recent[]>(dataFile('recent.json'), []);
  return list.map((r) => ({ ...r, exists: existsSync(r.path) }));
}

async function addRecent(p: string, name: string) {
  const list = (await readJson<Recent[]>(dataFile('recent.json'), [])).filter((r) => path.resolve(r.path) !== path.resolve(p));
  list.unshift({ path: p, name, openedAt: Date.now() });
  await writeAtomic(dataFile('recent.json'), JSON.stringify(list.slice(0, 20), null, 2));
  if (process.platform !== 'linux') app.addRecentDocument(p);
}

const recoveryDir = () => dataFile('recovery');
const safeId = (id: string) => id.replace(/[^a-z0-9_-]/gi, '').slice(0, 64);

// ── Janelas ──────────────────────────────────────────────────────────────────

function themeColors(theme: 'light' | 'dark') {
  return theme === 'dark' ? { color: '#131210', symbolColor: '#a9a397' } : { color: '#e9e5dd', symbolColor: '#5e584e' };
}

function createWindow(openPath?: string): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors;
  const opts: BrowserWindowConstructorOptions = {
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: dark ? '#131210' : '#e9e5dd',
    title: 'Zaliel',
    ...(existsSync(path.join(__dirname, '../../build/icon.png')) ? { icon: path.join(__dirname, '../../build/icon.png') } : {}),
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 13 } } : { titleBarOverlay: { ...themeColors(dark ? 'dark' : 'light'), height: 40 } }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  };
  const win = new BrowserWindow(opts);
  state.set(win, { dirty: false, allowClose: false, path: null });

  win.once('ready-to-show', () => win.show());
  win.on('focus', () => (lastFocused = win.webContents.id));
  win.on('close', (e) => {
    const s = state.get(win);
    if (s && s.dirty && !s.allowClose) {
      e.preventDefault();
      win.webContents.send('close-requested');
    }
  });

  // a janela nunca navega para fora do app; links externos abrem no navegador
  win.webContents.on('will-navigate', (e, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return;
    e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (openPath) pendingFor.set(win.webContents.id, openPath);
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '../renderer/index.html'));
  return win;
}

const pendingFor = new Map<number, string>();

function sendOpen(p: string) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) {
    pendingOpen.push(p);
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
  win.webContents.send('open-path', p);
}

// ── Rede: tudo bloqueado ─────────────────────────────────────────────────────

function lockDownNetwork() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, cb) => {
    // em desenvolvimento só o servidor local do Vite passa
    const allowed = !!DEV_URL && /^(https?|wss?):\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(details.url);
    cb({ cancel: !allowed });
  });
  // só a leitura de fontes instaladas é permitida (para listar as fontes do sistema)
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'local-fonts' || permission === 'clipboard-read' || permission === 'clipboard-sanitized-write'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'local-fonts' || permission === 'clipboard-read' || permission === 'clipboard-sanitized-write');
}

// ── IPC ──────────────────────────────────────────────────────────────────────

function registerIpc() {
  const fromEvent = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => BrowserWindow.fromWebContents(e.sender)!;
  const zalFilter = [{ name: 'Documento Zaliel', extensions: ['zal'] }];

  ipcMain.handle('app:info', () => {
    let user = '';
    try {
      user = os.userInfo().username;
    } catch {
      /* sem nome de usuário */
    }
    return { version: app.getVersion(), os: process.platform, dev: !app.isPackaged, user };
  });
  // fechar/trocar com alterações: salvar, não salvar ou cancelar
  ipcMain.handle('dialog:unsaved', async (e, name: string) => {
    const r = await dialog.showMessageBox(fromEvent(e), {
      type: 'warning',
      title: 'Zaliel',
      message: `Salvar as alterações em “${name}”?`,
      detail: 'Se não salvar, as alterações feitas desde a última gravação serão perdidas.',
      buttons: ['Salvar', 'Não salvar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    return (['save', 'discard', 'cancel'] as const)[r.response] ?? 'cancel';
  });
  ipcMain.handle('app:pending-open', (e) => {
    const p = pendingFor.get(e.sender.id) ?? pendingOpen.shift() ?? null;
    pendingFor.delete(e.sender.id);
    return p;
  });

  ipcMain.handle('file:open-dialog', async (e) => {
    const r = await dialog.showOpenDialog(fromEvent(e), { title: 'Abrir arquivo', filters: zalFilter, properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { path: r.filePaths[0], text: await fs.readFile(r.filePaths[0], 'utf8') };
  });
  ipcMain.handle('file:pick-library', async (e) => {
    const r = await dialog.showOpenDialog(fromEvent(e), { title: 'Escolher arquivo de biblioteca', filters: zalFilter, properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { path: r.filePaths[0], text: await fs.readFile(r.filePaths[0], 'utf8') };
  });
  ipcMain.handle('file:read', (_e, p: string) => fs.readFile(p, 'utf8'));
  ipcMain.handle('file:save', async (e, { path: p, text, suggestedName }: { path: string | null; text: string; suggestedName: string }) => {
    let target = p;
    if (!target) {
      const r = await dialog.showSaveDialog(fromEvent(e), { title: 'Salvar arquivo', defaultPath: path.join(app.getPath('documents'), suggestedName), filters: zalFilter });
      if (r.canceled || !r.filePath) return null;
      target = /\.zal$/i.test(r.filePath) ? r.filePath : `${r.filePath}.zal`;
    }
    await writeAtomic(target, text);
    return target;
  });
  ipcMain.handle('file:export', async (e, { data, name, kind }: { data: Uint8Array | string; name: string; kind: string }) => {
    const labels: Record<string, string> = { png: 'Imagem PNG', jpg: 'Imagem JPG', webp: 'Imagem WebP', svg: 'Vetor SVG', pdf: 'Documento PDF' };
    const r = await dialog.showSaveDialog(fromEvent(e), { title: 'Exportar', defaultPath: path.join(app.getPath('downloads'), name.replace(/[\\/:*?"<>|]/g, '-')), filters: [{ name: labels[kind] ?? kind, extensions: [kind] }] });
    if (r.canceled || !r.filePath) return null;
    await writeAtomic(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
    return r.filePath;
  });
  // exportação em lote: escolhe a pasta e grava todos os arquivos (nomes podem ter subpastas)
  ipcMain.handle('file:export-batch', async (e, files: { name: string; data: Uint8Array | string }[]) => {
    const r = await dialog.showOpenDialog(fromEvent(e), { title: 'Escolher pasta para exportar', defaultPath: app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const root = r.filePaths[0];
    let count = 0;
    for (const f of files) {
      const parts = f.name.split('/').map((s) => s.replace(/[\\:*?"<>|]/g, '-').replace(/^\.+/, '_').trim() || '_');
      const target = path.join(root, ...parts);
      if (!target.startsWith(root)) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await writeAtomic(target, typeof f.data === 'string' ? f.data : Buffer.from(f.data));
      count++;
    }
    return { folder: root, count };
  });
  ipcMain.handle('file:import', async (e, file?: string) => {
    let target = file ?? null;
    if (!target) {
      const r = await dialog.showOpenDialog(fromEvent(e), { title: 'Importar arquivo', filters: [{ name: 'Arquivos de design', extensions: IMPORT_EXTENSIONS }], properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return null;
      target = r.filePaths[0];
    }
    // leitura e conversão numa thread separada: arquivos grandes não travam o aplicativo
    return new Promise((resolve) => {
      const worker = createImportWorker({ workerData: { file: target } });
      worker.once('message', (res) => {
        resolve(res);
        void worker.terminate();
      });
      worker.once('error', (err) => resolve({ ok: false, error: String(err?.message ?? err) }));
    });
  });
  ipcMain.handle('file:pick-images', async (e) => {
    const r = await dialog.showOpenDialog(fromEvent(e), { title: 'Importar imagens', filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }], properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };
    return Promise.all(r.filePaths.map(async (p) => ({ name: path.basename(p), mime: mime[path.extname(p).slice(1).toLowerCase()] ?? 'image/png', data: (await fs.readFile(p)).toString('base64') })));
  });
  ipcMain.handle('file:reveal', (_e, p: string) => shell.showItemInFolder(p));

  ipcMain.handle('recent:list', () => recentList());
  ipcMain.handle('recent:add', (_e, p: string, name: string) => addRecent(p, name));
  ipcMain.handle('recent:remove', async (_e, p: string) => {
    const list = (await readJson<Recent[]>(dataFile('recent.json'), [])).filter((r) => r.path !== p);
    await writeAtomic(dataFile('recent.json'), JSON.stringify(list, null, 2));
  });

  ipcMain.handle('settings:get', async () => ({ ...DEFAULT_SETTINGS, ...(await readJson(dataFile('settings.json'), {})) }));
  ipcMain.handle('settings:set', async (_e, patch: Record<string, unknown>) => {
    const next = { ...DEFAULT_SETTINGS, ...(await readJson(dataFile('settings.json'), {})), ...patch } as typeof DEFAULT_SETTINGS;
    // ligar a automação pela primeira vez cria o token
    if (next.automation?.enabled && !next.automation.token) next.automation = { ...next.automation, token: newToken() };
    await writeAtomic(dataFile('settings.json'), JSON.stringify(next, null, 2));
    if (patch.theme) nativeTheme.themeSource = patch.theme as 'system' | 'light' | 'dark';
    if (patch.automation) await syncAutomation(next.automation);
    return next;
  });

  // automação: estado do servidor, novo token e a conversa com o editor
  ipcMain.handle('automation:info', async () => {
    const conf = await automationSettings();
    return { ...conf, running: !!automation, error: automationError, exe: process.execPath, bridge: bridgePath() };
  });
  ipcMain.handle('automation:regenerate', async () => {
    const s = { ...DEFAULT_SETTINGS, ...(await readJson(dataFile('settings.json'), {})) } as typeof DEFAULT_SETTINGS;
    s.automation = { ...DEFAULT_SETTINGS.automation, ...s.automation, token: newToken() };
    await writeAtomic(dataFile('settings.json'), JSON.stringify(s, null, 2));
    await syncAutomation(s.automation);
    return s;
  });
  // arquivos pedidos pela automação (imagens para inserir, exportações)
  ipcMain.handle('automation:read-binary', async (_e, p: string) => {
    if (!automation) throw new Error('automação desligada');
    return (await fs.readFile(p)).toString('base64');
  });
  ipcMain.handle('automation:write-file', async (_e, p: string, data: string, base64: boolean) => {
    if (!automation) throw new Error('automação desligada');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await writeAtomic(p, base64 ? Buffer.from(data, 'base64') : data);
  });
  ipcMain.on('automation:ready', (e) => {
    automationReady.add(e.sender.id);
    e.sender.once('destroyed', () => automationReady.delete(e.sender.id));
  });
  ipcMain.on('automation:response', (_e, msg: { id: number; result?: unknown; error?: string }) => {
    const p = automationPending.get(msg.id);
    if (!p) return;
    automationPending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  });

  ipcMain.handle('recovery:write', async (_e, entry: { id: string; name: string; path: string | null; savedAt: number }, text: string) => {
    await fs.mkdir(recoveryDir(), { recursive: true });
    const id = safeId(entry.id);
    await writeAtomic(path.join(recoveryDir(), `${id}.zal`), text);
    await writeAtomic(path.join(recoveryDir(), `${id}.json`), JSON.stringify({ ...entry, id }));
  });
  ipcMain.handle('recovery:list', async () => {
    try {
      const files = (await fs.readdir(recoveryDir())).filter((f) => f.endsWith('.json'));
      const out = [];
      for (const f of files) out.push(await readJson(path.join(recoveryDir(), f), null));
      return out.filter(Boolean);
    } catch {
      return [];
    }
  });
  ipcMain.handle('recovery:read', async (_e, id: string) => {
    try {
      return await fs.readFile(path.join(recoveryDir(), `${safeId(id)}.zal`), 'utf8');
    } catch {
      return null;
    }
  });
  ipcMain.handle('recovery:clear', async (_e, id: string) => {
    await fs.rm(path.join(recoveryDir(), `${safeId(id)}.zal`), { force: true });
    await fs.rm(path.join(recoveryDir(), `${safeId(id)}.json`), { force: true });
  });

  ipcMain.on('window:state', (e, s: { title: string; dirty: boolean; theme: 'light' | 'dark'; path: string | null }) => {
    const win = fromEvent(e);
    const st = state.get(win);
    if (st) {
      st.dirty = s.dirty;
      st.path = s.path;
    }
    win.setTitle(s.title);
    if (isMac) {
      win.setDocumentEdited(s.dirty);
      if (s.path) win.setRepresentedFilename(s.path);
    } else {
      try {
        win.setTitleBarOverlay({ ...themeColors(s.theme), height: 40 });
      } catch {
        /* Linux sem suporte */
      }
    }
    win.setBackgroundColor(s.theme === 'dark' ? '#131210' : '#e9e5dd');
  });
  ipcMain.on('window:new', () => createWindow());
  ipcMain.on('window:confirm-close', (e) => {
    const win = fromEvent(e);
    const st = state.get(win);
    if (st) st.allowClose = true;
    win.close();
  });

  ipcMain.handle('update:status', () => updater.status);
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:install', () => {
    for (const w of BrowserWindow.getAllWindows()) {
      const st = state.get(w);
      if (st) st.allowClose = true;
    }
    return { ok: updater.install() };
  });
}

// ── Ciclo de vida ────────────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const p = zalArg(argv);
    if (p) sendOpen(p);
    else {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) {
        if (w.isMinimized()) w.restore();
        w.focus();
      }
    }
  });

  // macOS: abrir pelo Finder
  app.on('open-file', (e, p) => {
    e.preventDefault();
    if (app.isReady()) sendOpen(p);
    else pendingOpen.push(p);
  });

  app.whenReady().then(async () => {
    const settings = { ...DEFAULT_SETTINGS, ...(await readJson<Record<string, unknown>>(dataFile('settings.json'), {})) };
    nativeTheme.themeSource = settings.theme as 'system' | 'light' | 'dark';
    lockDownNetwork();
    registerIpc();
    updater = new Updater();
    updater.on('status', (st) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update', st);
    });
    updater.start();

    if (isMac) {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          { role: 'appMenu' },
          { role: 'editMenu' },
          { label: 'Janela', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
        ]),
      );
    } else Menu.setApplicationMenu(null);

    const first = zalArg(process.argv) ?? pendingOpen.shift();
    createWindow(first);
    void syncAutomation(await automationSettings());
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
