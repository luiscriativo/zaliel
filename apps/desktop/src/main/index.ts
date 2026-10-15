// Processo principal do Zaliel: janelas, arquivos .zal, recuperação e bloqueio de rede.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, type BrowserWindowConstructorOptions } from 'electron';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { Updater } from './updater';

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

const DEFAULT_SETTINGS = { theme: 'system', nudge: 1, bigNudge: 10, pixelGrid: true, snapping: true, welcomed: false };

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

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), os: process.platform, dev: !app.isPackaged }));
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
    const labels: Record<string, string> = { png: 'Imagem PNG', jpg: 'Imagem JPG', webp: 'Imagem WebP', svg: 'Vetor SVG' };
    const r = await dialog.showSaveDialog(fromEvent(e), { title: 'Exportar', defaultPath: path.join(app.getPath('downloads'), name.replace(/[\\/:*?"<>|]/g, '-')), filters: [{ name: labels[kind] ?? kind, extensions: [kind] }] });
    if (r.canceled || !r.filePath) return null;
    await writeAtomic(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
    return r.filePath;
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
    const next = { ...DEFAULT_SETTINGS, ...(await readJson(dataFile('settings.json'), {})), ...patch };
    await writeAtomic(dataFile('settings.json'), JSON.stringify(next, null, 2));
    if (patch.theme) nativeTheme.themeSource = patch.theme as 'system' | 'light' | 'dark';
    return next;
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
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
