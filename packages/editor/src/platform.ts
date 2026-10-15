// O que o editor precisa do "sistema" (arquivos, janelas, menus).
// O app desktop implementa isto pelo preload do Electron; outro ambiente
// pode implementar do jeito dele sem mudar o editor.

export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
  exists?: boolean;
}

export interface ImportedImage {
  name: string;
  mime: string;
  data: string; // base64
}

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

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  nudge: number;
  bigNudge: number;
  pixelGrid: boolean;
  snapping: boolean;
  welcomed: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  nudge: 1,
  bigNudge: 10,
  pixelGrid: true,
  snapping: true,
  welcomed: false,
};

export interface RecoveryEntry {
  id: string;
  name: string;
  path: string | null;
  savedAt: number;
}

export interface Platform {
  version: string;
  os: 'win32' | 'darwin' | 'linux' | 'web';
  openDialog(): Promise<{ path: string; text: string } | null>;
  readFile(path: string): Promise<string>;
  /** Grava o texto; sem caminho, pergunta onde salvar. Devolve o caminho final. */
  saveFile(path: string | null, text: string, suggestedName: string): Promise<string | null>;
  exportFile(data: Uint8Array | string, suggestedName: string, kind: 'png' | 'jpg' | 'webp' | 'svg'): Promise<string | null>;
  pickLibrary(): Promise<{ path: string; text: string } | null>;
  pickImages(): Promise<ImportedImage[]>;
  recent(): Promise<RecentFile[]>;
  addRecent(path: string, name: string): Promise<void>;
  removeRecent(path: string): Promise<void>;
  revealFile(path: string): Promise<void>;
  setWindowState(state: { title: string; dirty: boolean; theme: 'light' | 'dark'; path: string | null }): void;
  newWindow(): void;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  writeRecovery(entry: RecoveryEntry, text: string): Promise<void>;
  listRecovery(): Promise<RecoveryEntry[]>;
  readRecovery(id: string): Promise<string | null>;
  clearRecovery(id: string): Promise<void>;
  /** Eventos do sistema: menu nativo, arquivo aberto pelo Explorer/Finder, pedido de fechar a janela. */
  on(event: 'open-path', cb: (path: string) => void): () => void;
  on(event: 'close-requested', cb: () => void): () => void;
  on(event: 'update', cb: (s: UpdateStatus) => void): () => void;
  confirmClose(): void;
  update: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    download(): Promise<UpdateStatus>;
    install(): Promise<{ ok: boolean }>;
  };
}
