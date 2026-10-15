// Atualização pelas releases do GitHub (electron-updater), no modelo do Tecius — com uma
// diferença importante: o Zaliel NUNCA verifica sozinho. Só consulta quando o usuário pede.
//  - Windows (instalador) e Linux (AppImage): baixa dentro do app e instala ao reiniciar;
//  - macOS sem certificado da Apple, Windows portátil e Linux .deb/.rpm: abre a página da release.
import { app, shell } from 'electron';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { AppUpdater } from 'electron-updater';

export const RELEASES_URL = 'https://github.com/luiscriativo/zaliel/releases';

export interface UpdateStatus {
  state: 'dev' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  current: string;
  version: string | null;
  percent: number;
  manual: boolean;
  error: string | null;
  checkedAt: number | null;
  notesUrl?: string;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
}

function manualReason(): string | null {
  if (process.platform === 'darwin') {
    // o instalador nativo do Mac só aceita atualizações de apps assinados com Team ID
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    const r = spawnSync('codesign', ['-dv', bundle], { encoding: 'utf8' });
    return /TeamIdentifier=(?!not set)/.test(`${r.stdout || ''}${r.stderr || ''}`) ? null : 'mac';
  }
  if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_DIR) return 'portable';
  if (process.platform === 'linux' && !process.env.APPIMAGE) return 'linux-package';
  return null;
}

export function friendlyError(err: unknown): string {
  const m = String((err as Error)?.message || err || '');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR|socket hang up|network/i.test(m)) return 'Sem conexão com a internet para verificar atualizações.';
  if (/404|Cannot find latest|No published versions/i.test(m)) return 'Ainda não há versões publicadas para atualizar.';
  if (/rate limit|403/i.test(m)) return 'O GitHub limitou as consultas por agora. Tente mais tarde.';
  if (/sha512 checksum mismatch/i.test(m)) return 'O download veio corrompido. Tente baixar de novo.';
  return `Não foi possível atualizar: ${m.split('\n')[0].slice(0, 160)}`;
}

export class Updater extends EventEmitter {
  status: UpdateStatus = { state: 'idle', current: app.getVersion(), version: null, percent: 0, manual: false, error: null, checkedAt: null };
  private updater: AppUpdater | null = null;
  private manual: string | null = null;

  private set(patch: Partial<UpdateStatus>) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }

  /** Prepara o atualizador. Não faz nenhuma consulta de rede. */
  start(): void {
    if (!app.isPackaged) {
      this.set({ state: 'dev' });
      return;
    }
    this.manual = manualReason();
  }

  private async load(): Promise<AppUpdater | null> {
    if (this.updater) return this.updater;
    try {
      const { autoUpdater } = await import('electron-updater');
      autoUpdater.autoDownload = false; // o usuário decide quando baixar
      autoUpdater.autoInstallOnAppQuit = !this.manual;
      autoUpdater.logger = null;
      // teste com servidor local: --update-feed=http://127.0.0.1:<porta>/
      const feed = process.argv.find((a) => a.startsWith('--update-feed='))?.slice('--update-feed='.length);
      if (feed && /^http:\/\/127\.0\.0\.1(:\d+)?\//.test(feed)) autoUpdater.setFeedURL({ provider: 'generic', url: feed });
      autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', error: null }));
      autoUpdater.on('update-available', (info) => {
        if (['downloading', 'downloaded'].includes(this.status.state)) return;
        this.set({ state: 'available', version: info.version, manual: !!this.manual, checkedAt: Date.now(), notesUrl: `${RELEASES_URL}/tag/v${info.version}` });
      });
      autoUpdater.on('update-not-available', () => this.set({ state: 'not-available', checkedAt: Date.now() }));
      autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent || 0), bytesPerSecond: p.bytesPerSecond, transferred: p.transferred, total: p.total }));
      autoUpdater.on('update-downloaded', (info) => this.set({ state: 'downloaded', version: info.version, percent: 100 }));
      autoUpdater.on('error', (err) => this.set({ state: 'error', error: friendlyError(err) }));
      this.updater = autoUpdater;
      return autoUpdater;
    } catch (e) {
      this.set({ state: 'error', error: friendlyError(e) });
      return null;
    }
  }

  async check(): Promise<UpdateStatus> {
    if (this.status.state === 'dev') return this.status;
    if (['checking', 'downloading'].includes(this.status.state)) return this.status;
    const u = await this.load();
    if (!u) return this.status;
    this.set({ state: 'checking', error: null });
    try {
      await u.checkForUpdates();
    } catch {
      /* tratado no evento 'error' */
    }
    return this.status;
  }

  async download(): Promise<UpdateStatus> {
    if (this.status.state !== 'available' && this.status.state !== 'error') return this.status;
    if (this.manual || !this.updater) {
      await shell.openExternal(this.status.version ? `${RELEASES_URL}/tag/v${this.status.version}` : `${RELEASES_URL}/latest`);
      return this.status;
    }
    this.set({ state: 'downloading', percent: 0, error: null });
    try {
      await this.updater.downloadUpdate();
    } catch {
      /* tratado no evento 'error' */
    }
    return this.status;
  }

  install(): boolean {
    if (this.status.state !== 'downloaded' || !this.updater) return false;
    // isSilent=false (mostra o instalador), isForceRunAfter=true (reabre o app)
    this.updater.quitAndInstall(false, true);
    return true;
  }
}
