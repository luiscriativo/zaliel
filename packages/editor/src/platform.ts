// O que o editor precisa do "sistema" (arquivos, janelas, menus).
// O app desktop implementa isto pelo preload do Electron; outro ambiente
// pode implementar do jeito dele sem mudar o editor.
import type { ImportResult } from '@zaliel/core';

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
  /** Réguas nas bordas do canvas (e guias arrastáveis a partir delas). */
  rulers: boolean;
  /** Mostrar as grades de layout dos frames. */
  layoutGrids: boolean;
  /** Grava sozinho, logo depois de cada alteração, os arquivos que já têm caminho. */
  autoSave: boolean;
  /** Nome que aparece nos comentários (vazio = nome do usuário do sistema). */
  author: string;
  /** Servidor local de automação (desligado por padrão). */
  automation?: { enabled: boolean; port: number; token: string };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  nudge: 1,
  bigNudge: 10,
  pixelGrid: true,
  snapping: true,
  welcomed: false,
  rulers: true,
  layoutGrids: true,
  autoSave: true,
  author: '',
};

/** Arquivo de outro programa já lido do disco (a conversão acontece no editor). */
export type ImportPayload =
  | { kind: 'fig'; name: string; schema: Uint8Array; data: Uint8Array; images: Record<string, Uint8Array>; background?: string }
  | { kind: 'pen'; name: string; text: string; imports: Record<string, { name: string; text: string }>; images: Record<string, Uint8Array> }
  /** Já convertido pelo sistema (arquivos grandes são convertidos fora da janela). */
  | { kind: 'converted'; name: string; json: string; report: ImportResult['report'] };

export interface AutomationInfo {
  enabled: boolean;
  port: number;
  token: string;
  running: boolean;
  error: string | null;
  /** Executável do app e o script da ponte stdio. */
  exe: string;
  bridge: string;
}

export interface RecoveryEntry {
  id: string;
  name: string;
  path: string | null;
  savedAt: number;
}

export interface Platform {
  version: string;
  os: 'win32' | 'darwin' | 'linux' | 'web';
  /** Nome do usuário no sistema (autor padrão dos comentários). */
  user: string;
  openDialog(): Promise<{ path: string; text: string } | null>;
  readFile(path: string): Promise<string>;
  /** Grava o texto; sem caminho, pergunta onde salvar. Devolve o caminho final. */
  saveFile(path: string | null, text: string, suggestedName: string): Promise<string | null>;
  exportFile(data: Uint8Array | string, suggestedName: string, kind: 'png' | 'jpg' | 'webp' | 'svg' | 'pdf'): Promise<string | null>;
  /** Escolhe uma pasta e grava vários arquivos nela (o nome pode ter subpastas: "Página/Tela.png"). */
  exportBatch(files: { name: string; data: Uint8Array | string }[]): Promise<{ folder: string; count: number } | null>;
  /** Pergunta o que fazer com alterações não salvas. */
  askUnsaved(name: string): Promise<'save' | 'discard' | 'cancel'>;
  pickLibrary(): Promise<{ path: string; text: string } | null>;
  pickImages(): Promise<ImportedImage[]>;
  /** Escolhe (ou lê, com `path`) um arquivo de outro programa para importar. */
  importDesign(path?: string): Promise<{ ok: true; payload: ImportPayload } | { ok: false; error: string } | null>;
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
  /** Automação local (opcional: só existe no app desktop). */
  automation?: {
    info(): Promise<AutomationInfo>;
    regenerate(): Promise<Settings>;
    /** Passa a atender os pedidos que chegam do servidor local. */
    serve(handler: (payload: unknown) => Promise<unknown>): void;
    /** Lê um arquivo como base64 (imagens). */
    readBinary(path: string): Promise<string>;
    /** Grava um arquivo (base64 = true: `data` vem em base64). */
    writeFile(path: string, data: string, base64: boolean): Promise<void>;
  };
  update: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    download(): Promise<UpdateStatus>;
    install(): Promise<{ ok: boolean }>;
  };
}
