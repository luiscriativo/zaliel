// Estado do editor e todas as ações (comandos). Não depende de React:
// o canvas usa direto e a interface observa pelos canais.
import {
  Model,
  createDocument,
  createNode,
  createPage,
  serialize,
  parse,
  FileFormatError,
  resolveInstance,
  componentFinder,
  buildLibrary,
  detachInstance,
  reidentify,
  exportSvg,
  transformRect,
  unionRects,
  invert,
  apply,
  multiply,
  nodeMatrix,
  uid,
  clone,
  hashText,
  ROOT,
  variantAxes,
  findVariant,
  variantName,
  remapOverrides,
  propertyDefs,
  stylePatch,
  detachPatch,
  propagateStyle,
  releaseStyle,
  findStyle,
  textStyleOf,
  parsePath,
  refitPath,
  mapPoints,
  startScreen,
  screenOf,
  buildPdf,
  splitRgba,
  deflate,
  figToDocument,
  penToDocument,
  penDependencies,
  createVersion,
  readVersion,
  addVersion,
  COMPACT_FROM,
  walk,
  type DocVersion,
  type DocComment,
  type ImportResult,
  type ContainerNode,
  type InstanceNode,
  type InstanceOverride,
  type TextNode,
  innerId,
  type Op,
  type Page,
  type Rect,
  type SceneNode,
  type ZalDocument,
  type Point,
  type Paint,
  type VariableCollection,
  type Asset,
  type FindComponent,
  type BooleanOp,
  type ComponentProperty,
  type Style,
  type StyleSlot,
  type Interaction,
  type Guide,
  type PathNode,
  type Transition,
} from '@zaliel/core';
import type { Platform, Settings } from './platform';
import { DEFAULT_SETTINGS } from './platform';
import type { CanvasHost } from './engine/host';
import { loadChunk, STALE_BUILD_EVENT } from './chunks';

export type Tool = 'move' | 'hand' | 'frame' | 'rect' | 'ellipse' | 'line' | 'polygon' | 'star' | 'text' | 'pen' | 'comment';
export type Channel = 'doc' | 'selection' | 'view' | 'ui' | 'tool';
export type Dialog = null | 'settings' | 'shortcuts' | 'about' | 'variables' | 'updates' | 'versions' | 'find' | 'exportBatch';

export interface Toast {
  id: number;
  kind: 'success' | 'info' | 'warn' | 'error';
  text: string;
  detail?: string;
  action?: { label: string; run: () => void };
  /** Fica na tela até ser fechado (sem sumir sozinho). */
  sticky?: boolean;
}

export interface Viewport {
  zoom: number;
  x: number;
  y: number;
}

/** Um arquivo aberto numa aba. A aba ativa vive nos campos do Editor; as outras ficam guardadas aqui. */
export interface DocTab {
  id: string;
  model: Model;
  filePath: string | null;
  pageId: string;
  selection: string[];
  viewport: Viewport;
  scope: string | null;
  laidOut: Set<string>;
  libraryChanges: Map<string, string>;
}

/** Exportação em lote: o que, em que formato e com que nome. */
export interface BatchExport {
  scope: 'selection' | 'page' | 'all';
  format: 'png' | 'jpg' | 'webp' | 'svg' | 'pdf';
  scales: number[];
  /** Nome de cada arquivo: {pagina}, {nome}, {n}, {escala}, {arquivo}; "/" cria pastas. */
  pattern: string;
}

export interface BatchItem {
  node: SceneNode;
  pageId: string;
  pageName: string;
  index: number;
}

/** Opções de localizar e substituir. */
export interface FindOptions {
  texts: boolean;
  names: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  allPages: boolean;
}

/** Um resultado de localizar: texto de uma camada, nome de uma camada ou texto trocado numa instância. */
export interface FindMatch {
  kind: 'text' | 'name' | 'override' | 'prop';
  /** Camada (para "override" e "prop", a instância). */
  id: string;
  /** Chave do override dentro da instância, ou id da propriedade de texto. */
  inner?: string;
  pageId: string;
  pageName: string;
  layer: string;
  value: string;
}

/** Estado do modo de apresentação do protótipo. */
export interface Presentation {
  pageId: string;
  screen: string;
  history: string[];
  /** Transição em andamento (tela de onde veio). */
  from?: string;
  transition?: Transition;
  duration?: number;
  /** Muda a cada navegação (para reiniciar a animação). */
  seq: number;
  /** Sobreposições abertas por cima da tela (a última fica no topo). */
  overlays?: { id: string; interaction: Interaction }[];
}

const BOOLEAN_NAMES: Record<BooleanOp, string> = { union: 'Unir', subtract: 'Subtrair', intersect: 'Interseção', exclude: 'Excluir' };
const PROP_NAMES: Record<ComponentProperty['type'], string> = { boolean: 'Mostrar', text: 'Texto', swap: 'Troca' };

const CLIP_MARK = 'zaliel/clipboard';

export function friendlyFsError(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (/ENOENT/.test(m)) return 'O arquivo não foi encontrado. Ele pode ter sido movido ou apagado.';
  if (/EACCES|EPERM/.test(m)) return 'Sem permissão para acessar este arquivo ou pasta.';
  if (/EBUSY/.test(m)) return 'O arquivo está aberto em outro programa. Feche-o e tente de novo.';
  if (/ENOSPC/.test(m)) return 'Não há espaço livre no disco.';
  return m.split('\n')[0].slice(0, 200);
}

export class Editor {
  model: Model;
  filePath: string | null = null;
  pageId: string;
  selection: string[] = [];
  hover: string | null = null;
  tool: Tool = 'move';
  viewport: Viewport = { zoom: 1, x: 0, y: 0 };
  editingText: string | null = null;
  /** Grupo/instância "aberto" com duplo clique (seleção acontece dentro dele). */
  scope: string | null = null;
  toasts: Toast[] = [];
  dialog: Dialog = null;
  settings: Settings = { ...DEFAULT_SETTINGS };
  systemDark = false;
  host: CanvasHost | null = null;
  /** Mostrar a tela inicial (nenhum arquivo aberto). */
  home = true;
  /** Ajustar o zoom ao conteúdo assim que o canvas estiver pronto. */
  pendingFit = false;
  /** Vetor com os pontos abertos para edição (duplo clique num caminho). */
  vectorEdit: string | null = null;
  /** Aba do painel da direita. */
  rightTab: 'design' | 'prototype' = 'design';
  /** Modo de apresentação do protótipo. */
  presenting: Presentation | null = null;
  /** Comentário aberto (conversa) e comentário novo sendo escrito. */
  commentOpen: string | null = null;
  commentDraft: { pageId: string; x: number; y: number; nodeId?: string } | null = null;
  /** Mostrar os comentários no canvas (e os já resolvidos). */
  showComments = true;
  showResolved = false;
  /** Aba do painel da esquerda. */
  leftTab: 'layers' | 'assets' | 'comments' = 'layers';
  private listeners = new Map<Channel, Set<() => void>>();
  private versions: Record<Channel, number> = { doc: 0, selection: 0, view: 0, ui: 0, tool: 0 };
  private resolved = new Map<string, SceneNode>();
  private resolvedRev = -1;
  private toastSeq = 0;
  private libraryChanges = new Map<string, string>(); // libId → hash novo disponível
  /** Arquivos abertos (abas). Vazio = tela inicial. */
  tabs: DocTab[] = [];
  activeTab: string | null = null;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeModel: (() => void) | null = null;

  constructor(public platform: Platform) {
    this.model = new Model(createDocument());
    this.pageId = this.model.doc.pages[0].id;
    this.attachModel();
    if (typeof window !== 'undefined') window.addEventListener(STALE_BUILD_EVENT, () => this.staleBuild());
  }

  /** A build mudou com a janela aberta: um aviso só, com o botão de recarregar (salvando antes). */
  private staleBuildWarned = false;
  private staleBuild(): void {
    if (this.staleBuildWarned) return;
    this.staleBuildWarned = true;
    const t: Toast = {
      id: ++this.toastSeq,
      kind: 'warn',
      sticky: true,
      text: 'O Zaliel foi atualizado enquanto estava aberto.',
      detail: 'Ícones e importação só voltam a funcionar depois de recarregar a janela.',
      action: { label: 'Recarregar', run: () => void this.confirmCloseAll().then((ok) => ok && location.reload()) },
    };
    // direto na lista: durante a automação os avisos iriam só para quem pediu
    this.toasts = [...this.toasts.slice(-3), t];
    this.emit('ui');
  }

  // ── Observação ─────────────────────────────────────────────────────────────

  on(channel: Channel, fn: () => void): () => void {
    let set = this.listeners.get(channel);
    if (!set) this.listeners.set(channel, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  version(channel: Channel): number {
    return this.versions[channel];
  }

  emit(...channels: Channel[]): void {
    for (const c of channels) {
      this.versions[c]++;
      for (const fn of this.listeners.get(c) ?? []) fn();
    }
    this.host?.invalidate();
  }

  private attachModel() {
    this.unsubscribeModel?.();
    this.unsubscribeModel = this.model.subscribe(({ ops }) => {
      this.invalidateShots(ops);
      // remove da seleção o que deixou de existir
      const alive = this.selection.filter((id) => this.model.index.get(id) || this.isInner(id));
      if (alive.length !== this.selection.length) {
        this.selection = alive;
        this.emit('selection');
      }
      if (!this.model.index.page(this.pageId)) this.pageId = this.model.doc.pages[0].id;
      this.emit('doc');
      this.syncWindow();
      this.scheduleAutoSave();
    });
    if (this.host) this.model.measureText = this.host.measureText;
  }

  /**
   * Avisa o desenho de quais telas do topo mudaram (as imagens guardadas delas, usadas com pouco
   * zoom, precisam ser refeitas). Mudanças em componentes, variáveis ou no documento afetam tudo.
   */
  private invalidateShots(ops: Op[]): void {
    const r = this.host?.renderer;
    if (!r) return;
    if (!ops.length) return r.invalidate();
    const tops = new Set<string>();
    for (const op of ops) {
      // nome do arquivo, comentários e metadados não mudam o desenho
      if (op.op === 'doc' && (op.key === 'comments' || op.key === 'name' || op.key === 'meta')) continue;
      if (op.op === 'doc' || op.op === 'asset' || op.op === 'remove' || op.op === 'move') return r.invalidate();
      const id = op.op === 'insert' ? op.parent : op.id;
      if (this.model.index.page(id)) continue; // fundo, guias e telas novas não estão em imagem
      const chain = [this.model.index.get(id), ...this.model.index.ancestors(id)];
      if (chain.some((n) => n?.type === 'component' || n?.type === 'component-set')) return r.invalidate();
      const top = chain[chain.length - 1];
      // a imagem é feita na origem: mover a própria tela do topo não a muda
      if (op.op === 'set' && chain.length === 1 && (op.key === 'x' || op.key === 'y')) continue;
      if (top) tops.add(top.id);
    }
    r.invalidate(tops);
  }

  get doc(): ZalDocument {
    return this.model.doc;
  }

  get page(): Page {
    return this.model.index.page(this.pageId) ?? this.doc.pages[0];
  }

  get theme(): 'light' | 'dark' {
    return this.settings.theme === 'system' ? (this.systemDark ? 'dark' : 'light') : this.settings.theme;
  }

  syncWindow(): void {
    const name = this.home ? 'Zaliel' : `${this.model.dirty ? '• ' : ''}${this.doc.name} — Zaliel`;
    // a janela pergunta antes de fechar se qualquer aba tiver alterações
    const dirty = !this.home && this.tabs.some((t) => this.tabModel(t).dirty);
    this.platform.setWindowState({ title: name, dirty, theme: this.theme, path: this.filePath });
  }

  // ── Avisos ─────────────────────────────────────────────────────────────────

  /**
   * Automação: com `strict`, uma operação que falha vira erro (em vez de aviso na tela), e os avisos
   * vão para `notices` em vez de aparecer — quem pediu a operação recebe tudo de volta.
   */
  strict = false;
  notices: string[] | null = null;

  toast(kind: Toast['kind'], text: string, opts: { detail?: string; action?: Toast['action'] } = {}): void {
    if (this.notices) {
      this.notices.push(`${kind}: ${text}${opts.detail ? ` (${opts.detail})` : ''}`);
      return;
    }
    const t: Toast = { id: ++this.toastSeq, kind, text, ...opts };
    this.toasts = [...this.toasts.slice(-3), t];
    this.emit('ui');
  }

  dismissToast(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit('ui');
  }

  openDialog(d: Dialog): void {
    this.dialog = d;
    this.emit('ui');
  }

  async loadSettings(): Promise<void> {
    this.settings = await this.platform.getSettings();
    this.emit('ui');
    this.syncWindow();
  }

  async setSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = await this.platform.setSettings(patch);
    this.emit('ui');
    this.syncWindow();
  }

  setSystemDark(dark: boolean): void {
    this.systemDark = dark;
    this.emit('ui');
    this.syncWindow();
  }

  // ── Componentes e instâncias ───────────────────────────────────────────────

  /** Localiza componentes (do arquivo e das bibliotecas) e o conjunto de variantes de cada um. */
  get finder(): FindComponent {
    const idx = this.model.index;
    return componentFinder(this.doc, () => idx.components(), (id) => {
      const p = idx.parentId(id);
      const n = p ? idx.get(p) : undefined;
      return n?.type === 'component-set' ? n : undefined;
    });
  }

  findComponent = (id: string, library?: string): ContainerNode | undefined => this.finder(id, library);

  /** Conjunto de variantes pelo id (do arquivo ou de uma biblioteca). */
  findSet(id: string, library?: string): ContainerNode | undefined {
    const local = !library ? this.model.index.get(id) : undefined;
    if (local?.type === 'component-set') return local;
    for (const lib of this.doc.libraries) {
      if (library && lib.id !== library) continue;
      const s = lib.components.find((c) => c.id === id && c.type === 'component-set');
      if (s) return s;
    }
    return undefined;
  }

  /**
   * Árvore exibida de um nó: instâncias viram o conteúdo do componente e operações
   * booleanas viram o caminho resultante. Em cache por revisão.
   */
  resolve = (n: SceneNode): SceneNode => {
    if (n.type !== 'instance' && n.type !== 'boolean') return n;
    if (this.resolvedRev !== this.model.revision) {
      this.resolved.clear();
      this.resolvedRev = this.model.revision;
    }
    const key = n.type === 'boolean' ? `b:${n.id}:${n.x},${n.y}` : `${n.id}:${n.width}x${n.height}`;
    let r = this.resolved.get(key);
    if (!r) {
      if (n.type === 'boolean') {
        const data = this.host?.booleanData(n);
        if (data === undefined) return n;
        r = booleanAsPath(n, data.d, data.fillRule);
      } else r = resolveInstance(n as InstanceNode, this.finder, this.host?.measureText) ?? missingComponent(n as InstanceNode);
      this.resolved.set(key, r);
    }
    return r;
  };

  /** Id de um nó dentro de uma instância ("instancia/interno"). */
  isInner(id: string): boolean {
    return id.includes('/');
  }

  // ── Documento ──────────────────────────────────────────────────────────────

  // ── Abas ───────────────────────────────────────────────────────────────────

  /** Modelo de uma aba (a ativa usa o do Editor). */
  tabModel(t: DocTab): Model {
    return t.id === this.activeTab ? this.model : t.model;
  }

  /** Caminho do arquivo de uma aba. */
  tabPath(t: DocTab): string | null {
    return t.id === this.activeTab ? this.filePath : t.filePath;
  }

  /** Guarda o estado da aba ativa antes de trocar. */
  private stashTab(): void {
    const t = this.tabs.find((x) => x.id === this.activeTab);
    if (!t) return;
    Object.assign(t, {
      model: this.model,
      filePath: this.filePath,
      pageId: this.pageId,
      selection: this.selection,
      viewport: { ...this.viewport },
      scope: this.scope,
      laidOut: this.laidOut,
      libraryChanges: this.libraryChanges,
    });
  }

  /** Sai dos modos que dependem do arquivo aberto (texto, pontos, apresentação). */
  private leaveModes(): void {
    this.host?.interaction?.cancel();
    this.editingText = null;
    this.vectorEdit = null;
    this.presenting = null;
    this.hover = null;
  }

  switchTab(id: string): void {
    if (id === this.activeTab) return;
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return;
    this.leaveModes();
    this.stashTab();
    this.activeTab = id;
    this.model = t.model;
    this.filePath = t.filePath;
    this.pageId = t.pageId;
    this.selection = t.selection;
    this.viewport = { ...t.viewport };
    this.scope = t.scope;
    this.laidOut = t.laidOut;
    this.libraryChanges = t.libraryChanges;
    this.home = false;
    this.resolved.clear();
    this.host?.resetDocument();
    this.attachModel();
    this.layoutPage(this.pageId);
    this.emit('doc', 'selection', 'view', 'ui', 'tool');
    this.syncWindow();
  }

  /** Próxima aba (ou a anterior, com `step` = -1). */
  cycleTab(step: 1 | -1): void {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeTab);
    this.switchTab(this.tabs[(i + step + this.tabs.length) % this.tabs.length].id);
  }

  moveTab(id: string, to: number): void {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const [t] = this.tabs.splice(from, 1);
    this.tabs.splice(Math.max(0, Math.min(this.tabs.length, to)), 0, t);
    this.emit('ui');
  }

  /** Fecha uma aba (pergunta antes se houver alterações). false = o usuário cancelou. */
  async closeTab(id: string): Promise<boolean> {
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return true;
    if (this.tabModel(t).dirty) {
      this.switchTab(id);
      if (!(await this.confirmDiscard())) return false;
    }
    await this.platform.clearRecovery(this.tabModel(t).doc.id);
    const i = this.tabs.indexOf(t);
    this.tabs.splice(i, 1);
    if (this.activeTab === id) {
      this.activeTab = null;
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      if (next) this.switchTab(next.id);
      else this.goHome();
    } else this.emit('ui');
    this.syncWindow();
    return true;
  }

  /** Antes de fechar a janela: resolve as alterações de todas as abas. false = cancelou. */
  async confirmCloseAll(): Promise<boolean> {
    for (const t of [...this.tabs]) {
      if (!this.tabModel(t).dirty) continue;
      this.switchTab(t.id);
      if (!(await this.confirmDiscard())) return false;
    }
    for (const t of this.tabs) await this.platform.clearRecovery(this.tabModel(t).doc.id);
    return true;
  }

  private goHome(): void {
    this.leaveModes();
    this.home = true;
    this.activeTab = null;
    this.model = new Model(createDocument());
    this.attachModel();
    this.filePath = null;
    this.selection = [];
    this.scope = null;
    this.laidOut = new Set();
    this.libraryChanges = new Map();
    this.emit('doc', 'selection', 'ui', 'tool');
    this.syncWindow();
  }

  /** Aba que já tem este arquivo aberto. */
  private tabForPath(path: string): DocTab | undefined {
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    return this.tabs.find((t) => {
      const fp = this.tabPath(t);
      return fp && norm(fp) === norm(path);
    });
  }

  private loadDocument(doc: ZalDocument, path: string | null) {
    this.leaveModes();
    // a aba ativa é um arquivo novo intocado: o arquivo aberto ocupa o lugar dela
    const current = this.tabs.find((t) => t.id === this.activeTab);
    const reuse = !!current && !this.filePath && !this.model.dirty && !this.model.past.length && this.doc.pages.every((p) => !p.children.length);
    this.stashTab();
    const tab: DocTab = reuse
      ? current!
      : { id: uid(), model: this.model, filePath: null, pageId: '', selection: [], viewport: { zoom: 1, x: 0, y: 0 }, scope: null, laidOut: new Set(), libraryChanges: new Map() };
    if (!reuse) this.tabs.splice(current ? this.tabs.indexOf(current) + 1 : this.tabs.length, 0, tab);
    this.activeTab = tab.id;
    this.laidOut = new Set();
    this.libraryChanges = new Map();
    this.model = new Model(doc);
    this.filePath = path;
    this.pageId = doc.settings?.currentPage && doc.pages.some((p) => p.id === doc.settings!.currentPage) ? doc.settings.currentPage : doc.pages[0].id;
    this.selection = [];
    this.scope = null;
    this.editingText = null;
    this.home = false;
    this.resolved.clear();
    this.host?.resetDocument();
    this.attachModel();
    this.layoutPage(this.pageId);
    this.model.markSaved();
    this.emit('doc', 'selection', 'ui', 'tool');
    this.syncWindow();
    this.pendingFit = true;
    this.host?.whenReady(() => this.fitIfPending());
    this.checkLibraries();
  }

  newDocument(): void {
    const doc = createDocument();
    // o fundo da página acompanha o tema da interface (é uma propriedade do arquivo)
    if (this.theme === 'dark') doc.pages[0].background = '#1e1d1b';
    this.loadDocument(doc, null);
    this.setTool('frame');
  }

  async openPath(path: string): Promise<void> {
    const open = this.tabForPath(path);
    if (open) return this.switchTab(open.id);
    try {
      const text = await this.platform.readFile(path);
      this.openText(text, path);
    } catch (e) {
      this.toast('error', 'Não foi possível abrir o arquivo.', { detail: friendlyFsError(e), action: { label: 'Remover dos recentes', run: () => this.platform.removeRecent(path) } });
    }
  }

  openText(text: string, path: string | null): boolean {
    try {
      const doc = parse(text);
      this.loadDocument(doc, path);
      if (path) this.platform.addRecent(path, doc.name);
      return true;
    } catch (e) {
      const err = e instanceof FileFormatError ? e : new FileFormatError('Não foi possível ler o arquivo.', String(e));
      this.toast('error', err.message, { detail: err.details });
      return false;
    }
  }

  async open(): Promise<void> {
    const res = await this.platform.openDialog();
    if (res) {
      const open = this.tabForPath(res.path);
      if (open) return this.switchTab(open.id);
      if (this.openText(res.text, res.path)) this.toast('success', `“${this.doc.name}” aberto.`);
    }
  }

  /** Pergunta antes de perder as alterações da aba ativa. true = pode seguir. */
  async confirmDiscard(): Promise<boolean> {
    if (this.home || !this.model.dirty) return true;
    const answer = await this.platform.askUnsaved(this.doc.name);
    if (answer === 'cancel') return false;
    if (answer === 'discard') return true;
    return this.save();
  }

  /** Salvamento automático: grava pouco depois da última alteração, se o arquivo já tem caminho. */
  private scheduleAutoSave(): void {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = null;
    if (!this.settings.autoSave || this.home || !this.filePath || !this.model.dirty) return;
    const model = this.model;
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = null;
      // só grava se ainda é a mesma aba, e nunca no meio de um arraste ou de uma edição de texto
      if (this.model !== model || !this.model.dirty) return;
      if (this.editingText || this.host?.interaction?.drag) return this.scheduleAutoSave();
      void this.save(false, true);
    }, 1500);
  }

  async save(as = false, quiet = false): Promise<boolean> {
    if (this.home) return false;
    try {
      const doc = this.doc;
      const model = this.model;
      doc.settings = { ...doc.settings, currentPage: this.pageId };
      await this.autoVersion();
      const at = model.checkpoint();
      const text = serialize(doc);
      const path = await this.platform.saveFile(as ? null : this.filePath, text, `${doc.name}.zal`);
      if (!path) return false;
      const fileName = path.split(/[\\/]/).pop()!.replace(/\.zal$/i, '');
      if (!this.filePath || as) {
        // o nome do documento acompanha o nome do arquivo
        if (fileName && fileName !== doc.name) doc.name = fileName;
      }
      // marca como salvo o ponto gravado (o que mudou durante a gravação continua "não salvo")
      model.markSaved(at);
      const tab = this.tabs.find((t) => this.tabModel(t) === model);
      if (tab && tab.id !== this.activeTab) tab.filePath = path;
      else this.filePath = path;
      if (!quiet) await this.platform.addRecent(path, doc.name);
      await this.platform.clearRecovery(doc.id);
      this.emit('doc', 'ui');
      this.syncWindow();
      if (!quiet) this.toast('success', 'Arquivo salvo.', { detail: path });
      return true;
    } catch (e) {
      this.toast('error', quiet ? 'O salvamento automático falhou.' : 'Não foi possível salvar.', { detail: friendlyFsError(e), action: { label: 'Salvar como…', run: () => this.save(true) } });
      return false;
    }
  }

  // ── Texto em caminho ───────────────────────────────────────────────────────

  /** Há um texto e uma forma selecionados (para pôr o texto no caminho)? */
  canTextOnPath(): boolean {
    const sel = this.selectedNodes();
    return sel.length === 2 && sel.some((n) => n.type === 'text') && sel.some((n) => ['path', 'ellipse', 'rect', 'line', 'polygon', 'star'].includes(n.type));
  }

  /** O texto passa a seguir o contorno da forma (que sai do lugar dela). */
  textOnPath(): void {
    const sel = this.selectedNodes();
    const text = sel.find((n) => n.type === 'text') as TextNode | undefined;
    const shape = sel.find((n) => n !== text);
    if (!text || !shape || !this.host || !this.canTextOnPath()) return this.toast('info', 'Selecione um texto e uma forma (caminho, elipse, retângulo…) para colocar o texto no caminho.');
    const { d } = this.host.outline(shape);
    if (!d) return;
    const parent = this.model.index.parentId(shape.id)!;
    const index = this.model.index.siblings(parent)!.findIndex((s) => s.id === shape.id);
    const sameParent = this.model.index.parentId(text.id) === parent;
    const moved: TextNode = {
      ...clone(text),
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      rotation: shape.rotation,
      flipX: shape.flipX,
      flipY: shape.flipY,
      autoResize: 'none',
      // a elipse começa na direita: começar do lado esquerdo deixa o texto por cima da curva
      textPath: { d, start: shape.type === 'ellipse' ? 50 : 0 },
    };
    const ops: Op[] = [{ op: 'remove', id: text.id }, { op: 'remove', id: shape.id }];
    // o texto fica no lugar da forma na lista de camadas
    const textIndex = this.model.index.siblings(parent)!.findIndex((s) => s.id === text.id);
    ops.push({ op: 'insert', parent, index: sameParent && textIndex < index ? index - 1 : index, node: moved });
    this.run('Texto no caminho', ops, { select: [text.id] });
  }

  /** O texto volta a ser um texto comum (em linhas). */
  releaseTextPath(): void {
    const ops: Op[] = [];
    for (const n of this.selectedNodes()) {
      if (n.type !== 'text' || !n.textPath) continue;
      ops.push({ op: 'set', id: n.id, key: 'textPath', value: undefined }, { op: 'set', id: n.id, key: 'autoResize', value: 'width' });
    }
    if (ops.length) this.run('Soltar texto do caminho', ops);
  }

  // ── Espelhar ───────────────────────────────────────────────────────────────

  /** Espelha a seleção na horizontal ("x") ou na vertical ("y"). Com várias camadas, elas trocam de lado também. */
  flip(axis: 'x' | 'y'): void {
    const ids = this.topLevel(this.selection).filter((id) => !this.isInner(id) && this.model.index.get(id));
    if (!ids.length) return;
    const box = unionRects(ids.map((id) => this.worldBounds(id)));
    const center = axis === 'x' ? box.x + box.width / 2 : box.y + box.height / 2;
    const key = axis === 'x' ? 'flipX' : 'flipY';
    const ops: Op[] = [];
    for (const id of ids) {
      const n = this.model.index.get(id)!;
      ops.push({ op: 'set', id, key, value: n[key] ? undefined : true });
      // espelhar uma camada girada inverte o ângulo
      if (n.rotation) ops.push({ op: 'set', id, key: 'rotation', value: -n.rotation });
      if (ids.length < 2) continue;
      const parent = this.model.index.get(this.model.index.parentId(id) ?? '');
      if (parent && 'layout' in parent && parent.layout && !n.absolute) continue; // o auto layout decide a posição
      const b = this.worldBounds(id);
      const mid = axis === 'x' ? b.x + b.width / 2 : b.y + b.height / 2;
      const d = 2 * (center - mid);
      const inv = invert(this.model.index.parentMatrix(id));
      const p0 = apply(inv, { x: 0, y: 0 });
      const p1 = apply(inv, axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d });
      if (p1.x - p0.x) ops.push({ op: 'set', id, key: 'x', value: Math.round((n.x + p1.x - p0.x) * 100) / 100 });
      if (p1.y - p0.y) ops.push({ op: 'set', id, key: 'y', value: Math.round((n.y + p1.y - p0.y) * 100) / 100 });
    }
    this.run(axis === 'x' ? 'Espelhar na horizontal' : 'Espelhar na vertical', ops);
  }

  // ── Comentários ────────────────────────────────────────────────────────────

  /** Nome de quem comenta: o das preferências, o do sistema ou "Você". */
  get author(): string {
    return this.settings.author || this.platform.user || 'Você';
  }

  get comments(): DocComment[] {
    return this.doc.comments ?? [];
  }

  /** Ponto do comentário no canvas (acompanha a camada a que está preso). */
  commentPoint(c: Pick<DocComment, 'x' | 'y' | 'nodeId'>): Point {
    if (c.nodeId && this.model.index.get(c.nodeId)) {
      const b = this.worldBounds(c.nodeId);
      return { x: b.x + c.x, y: b.y + c.y };
    }
    return { x: c.x, y: c.y };
  }

  /** Começa um comentário num ponto (preso à tela do topo que estiver embaixo). */
  startComment(w: Point): void {
    const screen = [...this.page.children].reverse().find((n) => {
      if (n.visible === false) return false;
      const b = this.worldBounds(n.id);
      return w.x >= b.x && w.x <= b.x + b.width && w.y >= b.y && w.y <= b.y + b.height;
    });
    const b = screen ? this.worldBounds(screen.id) : null;
    this.commentDraft = b ? { pageId: this.pageId, x: w.x - b.x, y: w.y - b.y, nodeId: screen!.id } : { pageId: this.pageId, x: w.x, y: w.y };
    this.commentOpen = null;
    this.emit('ui');
  }

  private setComments(label: string, list: DocComment[]): void {
    this.run(label, [{ op: 'doc', key: 'comments', value: list.length ? list : undefined }]);
  }

  addComment(text: string): void {
    const d = this.commentDraft;
    if (!d || !text.trim()) return;
    const c: DocComment = { id: uid(), ...d, author: this.author, text: text.trim(), createdAt: Date.now() };
    this.setComments('Comentar', [...this.comments, c]);
    this.commentDraft = null;
    this.commentOpen = c.id;
    this.emit('ui');
  }

  replyComment(id: string, text: string): void {
    if (!text.trim()) return;
    this.setComments('Responder comentário', this.comments.map((c) => (c.id === id ? { ...c, replies: [...(c.replies ?? []), { id: uid(), author: this.author, text: text.trim(), createdAt: Date.now() }] } : c)));
  }

  resolveComment(id: string, resolved: boolean): void {
    this.setComments(resolved ? 'Resolver comentário' : 'Reabrir comentário', this.comments.map((c) => (c.id === id ? { ...c, resolved: resolved || undefined } : c)));
    if (resolved && !this.showResolved && this.commentOpen === id) this.commentOpen = null;
    this.emit('ui');
  }

  deleteComment(id: string, replyId?: string): void {
    if (replyId) this.setComments('Apagar resposta', this.comments.map((c) => (c.id === id ? { ...c, replies: c.replies?.filter((r) => r.id !== replyId) } : c)));
    else {
      this.setComments('Apagar comentário', this.comments.filter((c) => c.id !== id));
      if (this.commentOpen === id) this.commentOpen = null;
      this.emit('ui');
    }
  }

  /** Move o alfinete de um comentário (arrastado no canvas). */
  moveComment(id: string, w: Point): void {
    const c = this.comments.find((x) => x.id === id);
    if (!c) return;
    const base = c.nodeId && this.model.index.get(c.nodeId) ? this.worldBounds(c.nodeId) : null;
    const pos = base ? { x: w.x - base.x, y: w.y - base.y } : { x: w.x, y: w.y };
    this.setComments('Mover comentário', this.comments.map((x) => (x.id === id ? { ...x, ...pos } : x)));
  }

  /** Abre a conversa de um comentário (troca de página e mostra o ponto). */
  openComment(id: string | null, reveal = false): void {
    this.commentDraft = null;
    this.commentOpen = id;
    const c = id ? this.comments.find((x) => x.id === id) : undefined;
    if (c && reveal) {
      if (c.pageId !== this.pageId) this.setPage(c.pageId);
      this.showComments = true;
      if (c.resolved) this.showResolved = true;
      const p = this.commentPoint(c);
      const size = this.host?.size() ?? { width: 1000, height: 700 };
      const z = Math.max(this.viewport.zoom, 0.5);
      this.setViewport({ zoom: z, x: size.width / 2 - p.x * z, y: size.height / 2 - p.y * z });
    }
    this.emit('ui');
  }

  toggleComments(): void {
    this.showComments = !this.showComments;
    if (!this.showComments) {
      this.commentOpen = null;
      this.commentDraft = null;
    }
    this.emit('ui');
  }

  // ── Localizar e substituir ─────────────────────────────────────────────────

  findPattern(query: string, o: FindOptions): RegExp | null {
    if (!query) return null;
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // "palavra inteira" sem \b: o \b não entende letras acentuadas
    const body = o.wholeWord ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])` : esc;
    return new RegExp(body, `gu${o.caseSensitive ? '' : 'i'}`);
  }

  findAll(query: string, o: FindOptions): FindMatch[] {
    const re = this.findPattern(query, o);
    if (!re || (!o.texts && !o.names)) return [];
    const test = (v: string) => {
      re.lastIndex = 0;
      return re.test(v);
    };
    const out: FindMatch[] = [];
    const pages = o.allPages ? this.doc.pages : [this.page];
    for (const page of pages) {
      walk(page.children, (n) => {
        const base = { id: n.id, pageId: page.id, pageName: page.name, layer: n.name };
        if (o.names && test(n.name)) out.push({ ...base, kind: 'name', value: n.name });
        if (o.texts && n.type === 'text' && !n.propRefs?.text && test(n.text)) out.push({ ...base, kind: 'text', value: n.text });
        if (o.texts && n.type === 'instance') {
          for (const [inner, ov] of Object.entries(n.overrides ?? {})) {
            if (typeof ov.text === 'string' && test(ov.text)) out.push({ ...base, kind: 'override', inner, value: ov.text });
          }
          // propriedades de texto da instância (ex.: o título de uma barra)
          const props = n.props ?? {};
          if (Object.values(props).some((v) => typeof v === 'string')) {
            for (const d of this.instanceInfo(n).defs) {
              const v = props[d.id];
              if (d.type === 'text' && typeof v === 'string' && test(v)) out.push({ ...base, kind: 'prop', inner: d.id, value: v });
            }
          }
        }
      });
    }
    return out;
  }

  /** Mostra um resultado: troca de página, seleciona e aproxima. */
  revealMatch(m: FindMatch): void {
    if (m.pageId !== this.pageId) this.setPage(m.pageId);
    if (!this.model.index.get(m.id)) return;
    const target = m.kind === 'override' && m.inner && !m.inner.includes('/') ? innerId(m.id, m.inner) : m.id;
    this.select([target]);
    const b = this.worldBounds(m.id);
    if (b) this.fitRect(b, 2, 120);
  }

  /** Substitui nos resultados dados (num passo só do desfazer). Devolve quantos mudaram. */
  replaceMatches(matches: FindMatch[], query: string, replacement: string, o: FindOptions): number {
    const re = this.findPattern(query, o);
    if (!re) return 0;
    const ops: Op[] = [];
    const overrides = new Map<string, Record<string, InstanceOverride>>();
    let count = 0;
    for (const m of matches) {
      const n = this.model.index.get(m.id);
      if (!n) continue;
      if (m.kind === 'name') {
        const next = n.name.replace(re, () => replacement);
        if (next !== n.name) ops.push({ op: 'set', id: n.id, key: 'name', value: next }), count++;
      } else if (m.kind === 'text' && n.type === 'text') {
        const next = n.text.replace(re, () => replacement);
        if (next !== n.text) ops.push({ op: 'set', id: n.id, key: 'text', value: next }), count++;
      } else if (m.kind === 'prop' && n.type === 'instance' && m.inner) {
        const cur = n.props?.[m.inner];
        if (typeof cur !== 'string') continue;
        const next = cur.replace(re, () => replacement);
        if (next !== cur) ops.push({ op: 'set', id: n.id, key: `props.${m.inner}`, value: next }), count++;
      } else if (m.kind === 'override' && n.type === 'instance' && m.inner) {
        const all = overrides.get(n.id) ?? { ...(n.overrides ?? {}) };
        const cur = all[m.inner];
        if (typeof cur?.text !== 'string') continue;
        const next = cur.text.replace(re, () => replacement);
        if (next === cur.text) continue;
        all[m.inner] = { ...cur, text: next };
        overrides.set(n.id, all);
        count++;
      }
    }
    for (const [id, value] of overrides) ops.push({ op: 'set', id, key: 'overrides', value });
    if (ops.length) this.run(count === 1 ? 'Substituir' : `Substituir ${count}`, ops);
    return count;
  }

  // ── Histórico de versões ───────────────────────────────────────────────────

  /** Ao salvar, guarda uma versão automática se a última tem mais de 30 minutos. */
  private async autoVersion(): Promise<void> {
    if (!this.model.dirty) return;
    const last = this.doc.versions?.[this.doc.versions.length - 1];
    if (last && Date.now() - last.createdAt < 30 * 60 * 1000) return;
    // arquivos enormes não ganham versões automáticas (cada uma seria do tamanho do arquivo)
    let count = 0;
    for (const p of this.doc.pages) walk(p.children, () => void count++);
    if (count > COMPACT_FROM) return;
    this.doc.versions = addVersion(this.doc.versions, await createVersion(this.doc, 'Salvo automaticamente', true));
  }

  /** Guarda o estado atual como uma versão com nome. */
  async saveVersion(name: string): Promise<DocVersion | null> {
    if (this.home) return null;
    try {
      const v = await createVersion(this.doc, name.trim() || 'Versão sem nome');
      this.doc.versions = addVersion(this.doc.versions, v);
      this.versionsChanged();
      this.toast('success', `Versão “${v.name}” guardada no arquivo.`);
      return v;
    } catch (e) {
      this.toast('error', 'Não foi possível guardar a versão.', { detail: String((e as Error)?.message ?? e) });
      return null;
    }
  }

  renameVersion(id: string, name: string): void {
    const v = this.doc.versions?.find((x) => x.id === id);
    if (!v || !name.trim()) return;
    // ganhar nome tira a versão da lista das automáticas (que são descartadas com o tempo)
    this.doc.versions = this.doc.versions!.map((x) => (x.id === id ? { ...x, name: name.trim(), auto: undefined } : x));
    this.versionsChanged();
  }

  deleteVersion(id: string): void {
    this.doc.versions = (this.doc.versions ?? []).filter((x) => x.id !== id);
    this.versionsChanged();
  }

  private versionsChanged(): void {
    this.model.markDirty();
    this.emit('doc', 'ui');
    this.syncWindow();
    this.scheduleAutoSave();
  }

  /** Volta o arquivo para uma versão. O estado atual vira uma versão antes, para dar para voltar. */
  async restoreVersion(id: string): Promise<void> {
    const v = this.doc.versions?.find((x) => x.id === id);
    if (!v) return;
    try {
      const before = await createVersion(this.doc, `Antes de restaurar “${v.name}”`);
      this.doc.versions = addVersion(this.doc.versions, before);
      const doc = await readVersion(v, this.doc);
      doc.id = this.doc.id;
      doc.name = this.doc.name;
      this.replaceDocument(doc);
      this.toast('success', `Arquivo restaurado para “${v.name}”.`, { detail: 'O estado anterior foi guardado no histórico como uma versão.' });
    } catch (e) {
      this.toast('error', 'Não foi possível restaurar esta versão.', { detail: String((e as Error)?.message ?? e) });
    }
  }

  /** Abre uma versão numa aba nova, como um arquivo separado. */
  async openVersionCopy(id: string): Promise<void> {
    const v = this.doc.versions?.find((x) => x.id === id);
    if (!v) return;
    try {
      const doc = await readVersion(v, this.doc);
      doc.id = uid();
      doc.name = `${this.doc.name} (${v.name})`;
      doc.versions = undefined;
      doc.assets = { ...doc.assets };
      this.loadDocument(doc, null);
      this.model.markDirty();
      this.syncWindow();
    } catch (e) {
      this.toast('error', 'Não foi possível abrir esta versão.', { detail: String((e as Error)?.message ?? e) });
    }
  }

  /** Troca o conteúdo da aba ativa (mesmo arquivo, mesmo caminho). Não entra no desfazer. */
  private replaceDocument(doc: ZalDocument): void {
    this.leaveModes();
    this.model = new Model(doc);
    if (!doc.pages.some((p) => p.id === this.pageId)) this.pageId = doc.pages[0].id;
    this.selection = [];
    this.scope = null;
    this.resolved.clear();
    this.host?.resetDocument();
    this.attachModel();
    this.laidOut = new Set();
    this.layoutPage(this.pageId);
    this.model.markDirty();
    this.emit('doc', 'selection', 'ui', 'tool');
    this.syncWindow();
    this.scheduleAutoSave();
  }

  async closeDocument(): Promise<void> {
    if (this.activeTab) await this.closeTab(this.activeTab);
  }

  /** Cópia de segurança periódica (recuperação após falha) de cada aba com alterações. */
  async writeRecovery(): Promise<void> {
    if (this.home) return;
    for (const t of this.tabs) {
      const m = this.tabModel(t);
      if (!m.dirty) continue;
      await this.platform.writeRecovery({ id: m.doc.id, name: m.doc.name, path: this.tabPath(t), savedAt: Date.now() }, serialize(m.doc));
    }
  }

  /**
   * Importa um arquivo de outro programa (.fig ou .pen) como documento novo.
   * Sem `path`, abre a janela para escolher.
   */
  async importDesign(path?: string): Promise<void> {
    const t00 = performance.now();
    const res = await this.platform.importDesign(path);
    const tRead = performance.now() - t00;
    if (!res) return;
    if (!res.ok) return this.toast('error', 'Não foi possível importar o arquivo.', { detail: friendlyFsError(res.error) });
    const p = res.payload;
    this.toast('info', `Importando “${p.name}”…`);
    await new Promise((r) => setTimeout(r, 30)); // deixa o aviso aparecer antes do trabalho pesado
    let result: ImportResult;
    const t0 = performance.now();
    try {
      if (p.kind === 'converted') result = { doc: JSON.parse(p.json) as ZalDocument, report: p.report };
      else if (p.kind === 'fig') result = figToDocument(p, p.name);
      else {
        const { loadIconShapes } = await loadChunk(() => import('./engine/icons'));
        const used = [p.text, ...Object.values(p.imports).map((i) => i.text)].flatMap((t) => penDependencies(t).icons);
        const icons = await loadIconShapes(used);
        result = penToDocument({ text: p.text, imports: p.imports, images: p.images, icons }, p.name);
      }
    } catch (e) {
      return this.toast('error', 'Não foi possível ler este arquivo.', { detail: String((e as Error)?.message ?? e).slice(0, 300) });
    }
    const tConvert = performance.now() - t0;
    const t1 = performance.now();
    this.loadDocument(result.doc, null);
    this.model.markDirty();
    this.syncWindow();
    this.lastImport = { ...result.report, timings: { leitura: Math.round(tRead), conversao: Math.round(tConvert), abertura: Math.round(performance.now() - t1) } };
    const r = result.report;
    const missing = this.host ? r.fonts.filter((f) => !this.host!.fonts.has(f)) : [];
    const pages = result.doc.pages.length;
    const detail = [
      ...(missing.length ? [`Fontes não instaladas (exibidas com Inter): ${missing.join(', ')}.`] : []),
      ...r.warnings.slice(0, 6),
      ...(r.warnings.length > 6 ? [`…e mais ${r.warnings.length - 6} aviso(s).`] : []),
    ].join('\n');
    this.toast(r.warnings.length || missing.length ? 'warn' : 'success', `“${p.name}” importado: ${r.counts.total ?? 0} camadas em ${pages} página${pages === 1 ? '' : 's'} (${Math.round(performance.now() - t0)} ms).`, { detail: detail || 'Salve para criar o arquivo .zal.' });
  }

  /** Relatório da última importação (avisos, fontes, contagens). */
  lastImport: (ImportResult['report'] & { timings?: Record<string, number> }) | null = null;

  async restoreRecovery(id: string, path: string | null): Promise<void> {
    const text = await this.platform.readRecovery(id);
    if (!text) return;
    if (this.openText(text, path)) {
      this.model.markDirty(); // continua marcado como não salvo
      this.syncWindow();
      this.emit('doc');
      this.toast('success', 'Trabalho recuperado. Salve para guardar no arquivo.');
    }
  }

  rename(name: string): void {
    const n = name.trim();
    if (!n || n === this.doc.name) return;
    this.model.transact('Renomear arquivo', [{ op: 'doc', key: 'name', value: n }]);
  }

  // ── Transações ─────────────────────────────────────────────────────────────

  run(label: string, ops: Op[], opts?: { merge?: string; select?: string[] }): boolean {
    try {
      this.model.transact(label, ops, { merge: opts?.merge, selection: this.selection });
      if (opts?.select) this.select(opts.select);
      return true;
    } catch (e) {
      if (this.strict) throw e;
      this.toast('error', `Não foi possível: ${label.toLowerCase()}.`, { detail: (e as Error).message });
      return false;
    }
  }

  undo(): void {
    if (this.editingText) return;
    const s = this.model.undo();
    if (!s) return this.toast('info', 'Nada para desfazer.');
    if (s.selection) this.select(s.selection.filter((id) => this.model.index.get(id)));
  }

  redo(): void {
    if (this.editingText) return;
    const s = this.model.redo();
    if (!s) return this.toast('info', 'Nada para refazer.');
  }

  /** Muda uma propriedade em vários nós (respeitando instâncias e textos). */
  setProp(ids: string[], key: string, value: unknown, merge?: string): void {
    const ops: Op[] = [];
    for (const id of ids) {
      if (this.isInner(id)) continue;
      if (this.model.index.get(id)) ops.push({ op: 'set', id, key, value });
    }
    this.run('Editar propriedade', ops, { merge });
  }

  setEach(ids: string[], fn: (n: SceneNode) => Record<string, unknown> | null, label = 'Editar', merge?: string): void {
    const ops: Op[] = [];
    for (const id of ids) {
      const n = this.model.index.get(id);
      if (!n) continue;
      const patch = fn(n);
      if (patch) for (const [key, value] of Object.entries(patch)) ops.push({ op: 'set', id, key, value });
    }
    this.run(label, ops, { merge });
  }

  // ── Seleção ────────────────────────────────────────────────────────────────

  select(ids: string[]): void {
    const uniq = [...new Set(ids)];
    if (uniq.length === this.selection.length && uniq.every((id, i) => id === this.selection[i])) return;
    if (this.vectorEdit && !(uniq.length === 1 && uniq[0] === this.vectorEdit)) this.exitVectorEdit();
    this.selection = uniq;
    if (this.scope && !uniq.every((id) => this.model.index.isAncestor(this.scope!, id))) this.scope = null;
    this.emit('selection');
  }

  toggleSelect(id: string): void {
    this.select(this.selection.includes(id) ? this.selection.filter((s) => s !== id) : [...this.selection, id]);
  }

  selectAll(): void {
    const parent = this.selection.length ? this.model.index.parentId(this.selection[0]) : this.pageId;
    const list = parent ? this.model.index.siblings(parent) : this.page.children;
    this.select((list ?? []).filter((n) => !(n as SceneNode).locked && (n as SceneNode).visible !== false).map((n) => n.id));
  }

  selectedNodes(): SceneNode[] {
    return this.selection.map((id) => this.model.index.get(id)).filter(Boolean) as SceneNode[];
  }

  setHover(id: string | null): void {
    if (this.hover === id) return;
    this.hover = id;
    this.host?.invalidate();
    this.emit('view');
  }

  setTool(tool: Tool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.emit('tool');
  }

  /** Páginas cujo layout já foi conferido desde que o arquivo abriu (ou desde a última fonte carregada). */
  laidOut = new Set<string>();

  /** Calcula o layout de uma página na primeira vez que ela aparece. */
  layoutPage(id: string): void {
    if (this.laidOut.has(id)) return;
    this.laidOut.add(id);
    this.model.refreshLayout([id]);
  }

  /** Uma fonte nova muda a medida dos textos: refaz a página atual e deixa as outras para quando forem abertas. */
  relayoutAfterFonts(): void {
    for (const t of this.tabs) t.laidOut.clear();
    this.laidOut.clear();
    this.layoutPage(this.pageId);
  }

  setPage(id: string): void {
    if (id === this.pageId || !this.model.index.page(id)) return;
    this.pageId = id;
    this.layoutPage(id);
    this.selection = [];
    this.scope = null;
    this.emit('selection', 'doc');
    this.zoomToFit(false);
  }

  // ── Geometria ──────────────────────────────────────────────────────────────

  /** Caixa do nó no espaço da página (considera rotação). */
  worldBounds(id: string): Rect {
    const n = this.model.index.get(id);
    if (!n) return { x: 0, y: 0, width: 0, height: 0 };
    return transformRect(this.model.index.worldMatrix(id), { x: 0, y: 0, width: n.width, height: n.height });
  }

  selectionBounds(): Rect | null {
    const ids = this.selection.filter((id) => this.model.index.get(id));
    if (!ids.length) return null;
    return unionRects(ids.map((id) => this.worldBounds(id)));
  }

  /** Converte um ponto da página para o espaço de um container (ou da página). */
  toLocal(parentId: string, p: Point): Point {
    if (parentId === this.pageId || !this.model.index.get(parentId)) return p;
    return apply(invert(this.model.index.worldMatrix(parentId)), p);
  }

  screenToWorld(p: Point): Point {
    const v = this.viewport;
    return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
  }

  worldToScreen(p: Point): Point {
    const v = this.viewport;
    return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
  }

  // ── Visualização ───────────────────────────────────────────────────────────

  setViewport(v: Viewport): void {
    this.viewport = { zoom: Math.min(256, Math.max(0.02, v.zoom)), x: v.x, y: v.y };
    this.emit('view');
  }

  zoomAt(factor: number, center?: Point): void {
    const size = this.host?.size() ?? { width: 1000, height: 700 };
    const c = center ?? { x: size.width / 2, y: size.height / 2 };
    const v = this.viewport;
    const zoom = Math.min(256, Math.max(0.02, v.zoom * factor));
    const k = zoom / v.zoom;
    this.setViewport({ zoom, x: c.x - (c.x - v.x) * k, y: c.y - (c.y - v.y) * k });
  }

  zoomTo(zoom: number): void {
    this.zoomAt(zoom / this.viewport.zoom);
  }

  fitRect(r: Rect, maxZoom = 1, padding = 80): void {
    const size = this.host?.size() ?? { width: 1000, height: 700 };
    if (!r.width && !r.height) {
      this.setViewport({ zoom: 1, x: size.width / 2 - r.x, y: size.height / 2 - r.y });
      return;
    }
    const zoom = Math.min(maxZoom, (size.width - padding * 2) / Math.max(1, r.width), (size.height - padding * 2) / Math.max(1, r.height));
    const z = Math.max(0.02, zoom);
    this.setViewport({ zoom: z, x: size.width / 2 - (r.x + r.width / 2) * z, y: size.height / 2 - (r.y + r.height / 2) * z });
  }

  fitIfPending(): void {
    if (!this.pendingFit || !this.host?.size().width) return;
    this.pendingFit = false;
    this.zoomToFit(false);
  }

  zoomToFit(announce = true): void {
    const kids = this.page.children.filter((n) => n.visible !== false);
    if (!kids.length) {
      this.setViewport({ zoom: 1, ...centerOrigin(this.host?.size()) });
      return;
    }
    this.fitRect(unionRects(kids.map((n) => this.worldBounds(n.id))), 1);
    if (announce) this.toast('info', 'Tudo à vista.');
  }

  zoomToSelection(): void {
    const b = this.selectionBounds();
    if (b) this.fitRect(b, 8);
  }

  // ── Criação ────────────────────────────────────────────────────────────────

  /** Container que fica embaixo de um ponto (para criar/soltar coisas dentro de frames). */
  containerAt(p: Point, exclude: Set<string> = new Set()): string {
    const visit = (list: SceneNode[]): string | null => {
      for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        if (n.visible === false || exclude.has(n.id) || n.locked) continue;
        if (n.type !== 'frame' && n.type !== 'component' && n.type !== 'component-set') continue;
        const local = apply(invert(this.model.index.worldMatrix(n.id)), p);
        if (local.x >= 0 && local.y >= 0 && local.x <= n.width && local.y <= n.height) {
          // dentro de um conjunto de variantes só as variantes recebem coisas
          if (n.type === 'component-set') {
            const inner = visit(n.children);
            if (inner) return inner;
            continue;
          }
          return visit(n.children) ?? n.id;
        }
      }
      return null;
    };
    return visit(this.page.children) ?? this.pageId;
  }

  insert(node: SceneNode, parent = this.pageId, index?: number, label = 'Inserir'): boolean {
    const list = this.model.index.siblings(parent) ?? [];
    return this.run(label, [{ op: 'insert', parent, index: index ?? list.length, node }], { select: [node.id] });
  }

  /** Cria um nó a partir de um retângulo no espaço da página. */
  createAt(type: Tool, r: Rect): SceneNode | null {
    const parent = this.containerAt({ x: r.x + 1, y: r.y + 1 });
    const local = this.toLocal(parent, { x: r.x, y: r.y });
    const g = { x: Math.round(local.x), y: Math.round(local.y), width: Math.round(r.width), height: Math.round(r.height) };
    let node: SceneNode;
    switch (type) {
      case 'frame': {
        const count = this.page.children.filter((n) => n.type === 'frame').length + 1;
        node = createNode('frame', g, { name: `Frame ${count}` });
        break;
      }
      case 'rect':
      case 'ellipse':
      case 'polygon':
      case 'star':
        node = createNode(type, g);
        break;
      case 'line':
        node = createNode('line', { ...g, height: Math.round(r.height) });
        break;
      case 'text':
        node = createNode('text', g, { text: '' });
        break;
      default:
        return null;
    }
    // um frame novo desenhado por cima de outros nós "adota" os que ficaram dentro dele
    const ops: Op[] = [{ op: 'insert', parent, index: (this.model.index.siblings(parent) ?? []).length, node }];
    if (type === 'frame') {
      const siblings = (this.model.index.siblings(parent) ?? []) as SceneNode[];
      let i = 0;
      for (const s of siblings) {
        const b = this.worldBounds(s.id);
        if (b.x >= r.x && b.y >= r.y && b.x + b.width <= r.x + r.width && b.y + b.height <= r.y + r.height && !s.locked) {
          const lp = { x: s.x - g.x, y: s.y - g.y };
          ops.push({ op: 'move', id: s.id, parent: node.id, index: i++ }, { op: 'set', id: s.id, key: 'x', value: lp.x }, { op: 'set', id: s.id, key: 'y', value: lp.y });
        }
      }
    }
    if (!this.run(`Criar ${node.name.toLowerCase()}`, ops, { select: [node.id] })) return null;
    return this.model.index.get(node.id) ?? null;
  }

  // ── Edição ─────────────────────────────────────────────────────────────────

  deleteSelection(): void {
    const ids = this.topLevel(this.selection);
    if (!ids.length) return;
    const parent = this.model.index.parentId(ids[0]);
    this.run(ids.length > 1 ? `Excluir ${ids.length} camadas` : 'Excluir', ids.map((id) => ({ op: 'remove', id }) as Op));
    if (parent && parent !== this.pageId && this.model.index.get(parent)) this.select([parent]);
    else this.select([]);
  }

  /** Remove ids que estão dentro de outros ids da lista. */
  topLevel(ids: string[]): string[] {
    const set = new Set(ids.filter((id) => this.model.index.get(id)));
    return [...set].filter((id) => !this.model.index.ancestors(id).some((a) => set.has(a.id)));
  }

  /** Ordena pela ordem na árvore (de baixo para cima). */
  inTreeOrder(ids: string[]): string[] {
    const order = new Map<string, number>();
    let i = 0;
    const visit = (list: SceneNode[]) => list.forEach((n) => {
      order.set(n.id, i++);
      if ('children' in n) visit(n.children);
    });
    visit(this.page.children);
    return [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  duplicate(offset = 0): void {
    const ids = this.inTreeOrder(this.topLevel(this.selection));
    if (!ids.length) return;
    const ops: Op[] = [];
    const created: string[] = [];
    for (const id of ids) {
      const n = this.model.index.get(id)!;
      const parent = this.model.index.parentId(id)!;
      const list = this.model.index.siblings(parent)!;
      const copy = reidentify(n);
      copy.x += offset;
      copy.y += offset;
      ops.push({ op: 'insert', parent, index: list.findIndex((s) => s.id === id) + 1 + created.filter((c) => this.model.index.parentId(c) === parent).length, node: copy });
      created.push(copy.id);
    }
    this.run('Duplicar', ops, { select: created });
  }

  async copy(cut = false): Promise<void> {
    const ids = this.inTreeOrder(this.topLevel(this.selection));
    if (!ids.length) return;
    const nodes = ids.map((id) => {
      const n = clone(this.model.index.get(id)!);
      const b = this.worldBounds(id);
      return { ...n, x: b.x, y: b.y }; // guarda posição absoluta
    });
    const assets: Record<string, Asset> = {};
    const used = JSON.stringify(nodes).match(/"asset":"([^"]+)"/g) ?? [];
    for (const m of used) {
      const k = m.slice(9, -1);
      if (this.doc.assets[k]) assets[k] = this.doc.assets[k];
    }
    const payload = JSON.stringify({ [CLIP_MARK]: 1, doc: this.doc.id, nodes, assets });
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      /* sem acesso à área de transferência: fica só a cópia interna */
    }
    internalClipboard = payload;
    if (cut) this.deleteSelection();
    this.toast('info', `${nodes.length === 1 ? '1 camada copiada' : `${nodes.length} camadas copiadas`}.`);
  }

  async paste(at?: Point): Promise<void> {
    let text = internalClipboard;
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const img = it.types.find((t) => t.startsWith('image/'));
        if (img && !it.types.includes('text/plain')) {
          const blob = await it.getType(img);
          const data = await blobToBase64(blob);
          await this.insertImages([{ name: 'Imagem colada', mime: img, data }], at);
          return;
        }
      }
      const t = await navigator.clipboard.readText();
      if (t) text = t;
    } catch {
      /* usa a cópia interna */
    }
    if (!text) return;
    let data: { nodes: SceneNode[]; assets?: Record<string, Asset> } | null = null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed[CLIP_MARK]) data = parsed;
    } catch {
      /* não é JSON */
    }
    if (!data) {
      if (text.trim().startsWith('<svg')) return this.toast('warn', 'Importar SVG colado ainda não está disponível nesta versão.');
      // texto comum vira uma camada de texto
      const c = at ?? this.viewCenter();
      const t = createNode('text', { x: c.x, y: c.y, width: 10, height: 10 }, { text: text.slice(0, 5000) });
      this.insert(t, this.pageId, undefined, 'Colar texto');
      return;
    }
    const ops: Op[] = [];
    for (const [k, v] of Object.entries(data.assets ?? {})) if (!this.doc.assets[k]) ops.push({ op: 'asset', key: k, value: v });
    // cola dentro do frame selecionado (ou ao lado do original)
    let target = this.selection.length === 1 && ['frame', 'component'].includes(this.model.index.get(this.selection[0])?.type ?? '') ? this.selection[0] : this.selection.length ? this.model.index.parentId(this.selection[0])! : this.pageId;
    // colar o próprio frame copiado (ou algo de dentro dele de volta): vai para o pai, não para dentro
    while (target !== this.pageId && data.nodes.some((n) => n.id === target || this.model.index.isAncestor(n.id, target))) target = this.model.index.parentId(target) ?? this.pageId;
    const b = unionRects(data.nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })));
    let dx = 0, dy = 0;
    if (at) {
      dx = at.x - b.x;
      dy = at.y - b.y;
    } else if (!this.isVisible(b)) {
      const c = this.viewCenter();
      dx = c.x - (b.x + b.width / 2);
      dy = c.y - (b.y + b.height / 2);
    }
    const ids: string[] = [];
    const list = this.model.index.siblings(target) ?? [];
    for (const raw of data.nodes) {
      const n = reidentify(raw);
      const local = this.toLocal(target, { x: raw.x + dx, y: raw.y + dy });
      n.x = Math.round(local.x);
      n.y = Math.round(local.y);
      ops.push({ op: 'insert', parent: target, index: list.length + ids.length, node: n });
      ids.push(n.id);
    }
    this.run('Colar', ops, { select: ids });
  }

  isVisible(r: Rect): boolean {
    const size = this.host?.size() ?? { width: 1000, height: 700 };
    const a = this.screenToWorld({ x: 0, y: 0 });
    const b = this.screenToWorld({ x: size.width, y: size.height });
    return r.x < b.x && r.x + r.width > a.x && r.y < b.y && r.y + r.height > a.y;
  }

  viewCenter(): Point {
    const size = this.host?.size() ?? { width: 1000, height: 700 };
    return this.screenToWorld({ x: size.width / 2, y: size.height / 2 });
  }

  /** Embrulha a seleção num grupo/frame/componente/operação booleana. */
  wrap(kind: 'group' | 'frame' | 'component' | 'boolean', extra: Partial<ContainerNode> = {}): void {
    const ids = this.inTreeOrder(this.topLevel(this.selection));
    if (!ids.length) return;
    const parent = this.model.index.parentId(ids[0])!;
    if (!ids.every((id) => this.model.index.parentId(id) === parent)) {
      return this.toast('warn', 'Selecione camadas do mesmo nível para agrupar.');
    }
    if (kind === 'component' && ids.length === 1) {
      const n = this.model.index.get(ids[0])!;
      if (n.type === 'frame') {
        // transformar o frame em componente sem criar um nível a mais
        const comp = { ...clone(n), type: 'component' as const, id: uid() };
        const list = this.model.index.siblings(parent)!;
        const index = list.findIndex((s) => s.id === n.id);
        this.run('Criar componente', [{ op: 'remove', id: n.id }, { op: 'insert', parent, index, node: comp }], { select: [comp.id] });
        this.toast('success', `Componente “${comp.name}” criado.`, { detail: 'Ele aparece em Recursos e pode ser usado como biblioteca por outros arquivos.' });
        return;
      }
    }
    const pm = this.model.index.parentMatrix(ids[0]);
    const inv = invert(pm);
    const b = transformRect(inv, unionRects(ids.map((id) => this.worldBounds(id))));
    const list = this.model.index.siblings(parent)!;
    const index = Math.max(...ids.map((id) => list.findIndex((s) => s.id === id))) + 1 - ids.length;
    const geom = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
    const container = kind === 'boolean' ? createNode('boolean', geom, extra) : createNode(kind === 'group' ? 'group' : kind, geom, kind === 'group' ? {} : { fills: [], clip: kind === 'frame' ? false : true });
    if (kind === 'component') container.name = this.uniqueComponentName('Componente');
    const ops: Op[] = [{ op: 'insert', parent, index, node: container }];
    ids.forEach((id, i) => {
      const n = this.model.index.get(id)!;
      ops.push({ op: 'move', id, parent: container.id, index: i }, { op: 'set', id, key: 'x', value: n.x - container.x }, { op: 'set', id, key: 'y', value: n.y - container.y });
    });
    const label = kind === 'group' ? 'Agrupar' : kind === 'frame' ? 'Criar frame' : kind === 'boolean' ? 'Operação booleana' : 'Criar componente';
    if (this.run(label, ops, { select: [container.id] }) && kind === 'component') this.toast('success', `Componente “${container.name}” criado.`);
  }

  uniqueComponentName(base: string, ignore: Set<string> = new Set()): string {
    const names = new Set([...this.model.index.components(), ...this.model.index.componentSets()].filter((c) => !ignore.has(c.id)).map((c) => c.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  ungroup(): void {
    const ids = this.topLevel(this.selection).filter((id) => {
      const n = this.model.index.get(id);
      return n && 'children' in n && (n.type === 'group' || n.type === 'frame');
    });
    if (!ids.length) return;
    const ops: Op[] = [];
    const freed: string[] = [];
    for (const id of ids) {
      const g = this.model.index.get(id) as ContainerNode;
      const parent = this.model.index.parentId(id)!;
      const list = this.model.index.siblings(parent)!;
      let index = list.findIndex((s) => s.id === id);
      const m = nodeMatrix(g);
      for (const c of g.children) {
        const cm = multiply(m, nodeMatrix(c));
        // mantém a posição visual; rotação do grupo é somada ao filho
        const rot = (c.rotation ?? 0) + (g.rotation ?? 0);
        const center = apply(cm, { x: c.width / 2, y: c.height / 2 });
        ops.push({ op: 'move', id: c.id, parent, index: index++ }, { op: 'set', id: c.id, key: 'x', value: center.x - c.width / 2 }, { op: 'set', id: c.id, key: 'y', value: center.y - c.height / 2 });
        if (rot) ops.push({ op: 'set', id: c.id, key: 'rotation', value: rot });
        freed.push(c.id);
      }
      ops.push({ op: 'remove', id });
    }
    this.run('Desagrupar', ops, { select: freed });
  }

  detach(): void {
    const ids = this.selection.filter((id) => this.model.index.get(id)?.type === 'instance');
    if (!ids.length) return;
    const ops: Op[] = [];
    const out: string[] = [];
    for (const id of ids) {
      const inst = this.model.index.get(id) as InstanceNode;
      const frame = detachInstance(inst, this.finder, this.host?.measureText);
      if (!frame) continue;
      frame.id = uid();
      frame.name = inst.name;
      const parent = this.model.index.parentId(id)!;
      const index = this.model.index.siblings(parent)!.findIndex((s) => s.id === id);
      ops.push({ op: 'remove', id }, { op: 'insert', parent, index, node: frame });
      out.push(frame.id);
    }
    this.run('Desanexar instância', ops, { select: out });
  }

  resetOverrides(): void {
    const ids = this.selection.filter((id) => this.model.index.get(id)?.type === 'instance');
    this.run('Restaurar instância', ids.flatMap((id) => [{ op: 'set', id, key: 'overrides', value: undefined }, { op: 'set', id, key: 'props', value: undefined }] as Op[]));
  }

  goToMainComponent(): void {
    const n = this.selectedNodes()[0];
    if (n?.type !== 'instance') return;
    if (n.library) return this.toast('info', 'Este componente vem de uma biblioteca. Abra o arquivo da biblioteca para editá-lo.');
    const main = this.model.index.get(n.componentId);
    if (!main) return this.toast('warn', 'O componente principal não existe mais neste arquivo.');
    this.setPage(this.model.index.pageOf(main.id)!);
    this.select([main.id]);
    this.zoomToSelection();
  }

  insertComponent(componentId: string, library?: string, at?: Point): void {
    let main = this.findComponent(componentId, library);
    let name = main?.name;
    if (!main) {
      // conjunto de variantes: entra a primeira variante
      const set = this.findSet(componentId, library);
      main = set?.children.find((c) => c.type === 'component') as ContainerNode | undefined;
      name = set?.name;
      if (!main) return this.toast('info', 'Este conjunto ainda não tem variantes.');
    } else {
      const set = this.finder.setOf?.(main.id, library);
      if (set) name = set.name;
    }
    const c = at ?? this.viewCenter();
    const parent = this.containerAt(c);
    const local = this.toLocal(parent, { x: c.x - (at ? 0 : main.width / 2), y: c.y - (at ? 0 : main.height / 2) });
    const inst = createNode('instance', { x: Math.round(local.x), y: Math.round(local.y), width: main.width, height: main.height }, { componentId: main.id, library, name });
    this.insert(inst, parent, undefined, 'Inserir componente');
  }

  setOverride(instanceId: string, innerId: string, patch: Record<string, unknown>): void {
    const inst = this.model.index.get(instanceId) as InstanceNode | undefined;
    if (!inst || inst.type !== 'instance') return;
    const cur = inst.overrides?.[innerId] ?? {};
    this.run('Editar instância', [{ op: 'set', id: instanceId, key: `overrides.${innerId}`, value: { ...cur, ...patch } }], { merge: `ovr-${instanceId}-${innerId}` });
  }

  // ── Variantes ──────────────────────────────────────────────────────────────

  /** Junta componentes selecionados num conjunto de variantes. */
  combineAsVariants(): void {
    const ids = this.inTreeOrder(this.topLevel(this.selection));
    const nodes = ids.map((id) => this.model.index.get(id)!);
    if (!nodes.length || nodes.some((n) => n.type !== 'component')) return this.toast('info', 'Selecione um ou mais componentes para combinar como variantes.');
    const parent = this.model.index.parentId(ids[0])!;
    if (!ids.every((id) => this.model.index.parentId(id) === parent)) return this.toast('warn', 'Os componentes precisam estar no mesmo nível.');
    if (this.model.index.get(parent)?.type === 'component-set') return this.toast('info', 'Estes componentes já são variantes de um conjunto.');
    const comps = (nodes as ContainerNode[]).sort((a, b) => a.y - b.y || a.x - b.x);
    const b = transformRect(invert(this.model.index.parentMatrix(ids[0])), unionRects(ids.map((id) => this.worldBounds(id))));
    const base = comps[0].name.split('/')[0].split('=')[0].trim() || 'Componente';
    const set = createNode('component-set', { x: Math.round(b.x - 20), y: Math.round(b.y - 20), width: Math.round(b.width + 40), height: Math.round(b.height + 40) }, {
      name: this.uniqueComponentName(base, new Set(ids)),
      layout: { direction: comps.length > 1 && b.width < b.height ? 'vertical' : 'horizontal', gap: 20, padding: [20, 20, 20, 20], justify: 'start', align: 'start' },
      sizing: { horizontal: 'hug', vertical: 'hug' },
      properties: comps.find((c) => c.properties?.length)?.properties,
    });
    const list = this.model.index.siblings(parent)!;
    const index = Math.max(...ids.map((id) => list.findIndex((s) => s.id === id))) + 1 - ids.length;
    const ops: Op[] = [{ op: 'insert', parent, index, node: set }];
    comps.forEach((c, i) => {
      const variant = c.variant ?? { Propriedade: i === 0 ? 'Padrão' : `Variante ${i + 1}` };
      ops.push(
        { op: 'move', id: c.id, parent: set.id, index: i },
        { op: 'set', id: c.id, key: 'variant', value: variant },
        { op: 'set', id: c.id, key: 'name', value: variantName(variant) },
        { op: 'set', id: c.id, key: 'properties', value: undefined },
      );
    });
    if (this.run('Combinar como variantes', ops, { select: [set.id] })) this.toast('success', `Conjunto de variantes “${set.name}” criado.`, { detail: 'Adicione variantes e propriedades no painel Design.' });
  }

  /** Conjunto do componente selecionado (ou o próprio conjunto). */
  setFor(id: string): ContainerNode | undefined {
    const n = this.model.index.get(id);
    if (n?.type === 'component-set') return n;
    const p = n && this.model.index.get(this.model.index.parentId(id) ?? '');
    return p?.type === 'component-set' ? p : undefined;
  }

  /** Nova variante, copiando a selecionada (ou a última do conjunto). */
  addVariant(id = this.selection[0]): void {
    const n = id ? this.model.index.get(id) : undefined;
    if (n?.type === 'component' && !this.setFor(id)) {
      // componente solto: primeiro vira um conjunto com ele dentro
      this.select([id]);
      this.combineAsVariants();
      const set = this.selectedNodes()[0];
      if (set?.type === 'component-set') this.addVariant(set.id);
      return;
    }
    const set = id ? this.setFor(id) : undefined;
    if (!set) return;
    const base = (n?.type === 'component' ? n : [...set.children].reverse().find((c) => c.type === 'component')) as ContainerNode | undefined;
    if (!base) return;
    const axes = variantAxes(set);
    const axis = axes[0]?.name ?? 'Propriedade';
    const used = new Set(axes[0]?.values ?? []);
    let k = set.children.length + 1;
    while (used.has(`Variante ${k}`)) k++;
    const copy = reidentify(base);
    copy.variant = { ...(base.variant ?? {}), [axis]: `Variante ${k}` };
    copy.name = variantName(copy.variant);
    if (!set.layout) copy.x = Math.max(...set.children.map((c) => c.x + c.width)) + 20;
    const index = set.children.findIndex((c) => c.id === base.id) + 1;
    this.run('Adicionar variante', [{ op: 'insert', parent: set.id, index, node: copy }], { select: [copy.id] });
  }

  setVariantValue(compId: string, axis: string, value: string): void {
    const c = this.model.index.get(compId) as ContainerNode | undefined;
    const v = value.trim();
    if (!c || !v) return;
    const variant = { ...(c.variant ?? {}), [axis]: v };
    const set = this.setFor(compId);
    if (set?.children.some((o) => o.id !== compId && o.type === 'component' && variantName(o.variant ?? {}) === variantName(variant))) {
      this.toast('warn', 'Já existe uma variante com esses valores.', { detail: 'As instâncias podem não conseguir escolher entre as duas.' });
    }
    this.run('Editar variante', [{ op: 'set', id: compId, key: 'variant', value: variant }, { op: 'set', id: compId, key: 'name', value: variantName(variant) }]);
  }

  /** Renomeia (axis + next), cria (axis null) ou remove (next null) um eixo em todas as variantes do conjunto. */
  editVariantAxis(setId: string, axis: string | null, next: string | null): void {
    const set = this.model.index.get(setId) as ContainerNode | undefined;
    if (!set) return;
    const name = next?.trim();
    if (name && axis !== name && variantAxes(set).some((a) => a.name === name)) return this.toast('warn', `Já existe a propriedade “${name}”.`);
    const ops: Op[] = [];
    for (const c of set.children) {
      if (c.type !== 'component') continue;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(c.variant ?? {})) {
        if (k !== axis) out[k] = v;
        else if (name) out[name] = v; // mantém a ordem dos eixos
      }
      if (!axis && name) out[name] = 'Padrão';
      const has = Object.keys(out).length > 0;
      ops.push({ op: 'set', id: c.id, key: 'variant', value: has ? out : undefined }, { op: 'set', id: c.id, key: 'name', value: has ? variantName(out) : c.name });
    }
    this.run(!axis ? 'Nova propriedade de variante' : name ? 'Renomear propriedade' : 'Remover propriedade', ops);
  }

  /** Troca a variante de uma instância por eixo e valor. */
  setInstanceVariant(instId: string, axis: string, value: string): void {
    const inst = this.model.index.get(instId) as InstanceNode | undefined;
    if (!inst || inst.type !== 'instance') return;
    const main = this.findComponent(inst.componentId, inst.library);
    const set = main && this.finder.setOf?.(main.id, inst.library);
    if (!main || !set) return;
    const target = findVariant(set, { ...(main.variant ?? {}), [axis]: value }, axis);
    if (!target || target.id === main.id) return;
    const ops: Op[] = [
      { op: 'set', id: instId, key: 'componentId', value: target.id },
      { op: 'set', id: instId, key: 'overrides', value: remapOverrides(inst.overrides, main, target) },
    ];
    // instância no tamanho original acompanha o tamanho da nova variante
    if (Math.abs(inst.width - main.width) < 0.5 && Math.abs(inst.height - main.height) < 0.5) {
      ops.push({ op: 'set', id: instId, key: 'width', value: target.width }, { op: 'set', id: instId, key: 'height', value: target.height });
    }
    this.run('Trocar variante', ops);
  }

  // ── Propriedades de componente ─────────────────────────────────────────────

  /** Componente (ou conjunto) dono das propriedades que valem para um nó. */
  propertyOwner(id: string): ContainerNode | undefined {
    const n = this.model.index.get(id);
    if (!n) return undefined;
    if (n.type === 'component-set') return n;
    const comp = n.type === 'component' ? n : this.model.index.ancestors(id).find((a) => a.type === 'component');
    if (!comp || comp.type !== 'component') return undefined;
    return this.setFor(comp.id) ?? comp;
  }

  private setProperties(owner: ContainerNode, list: ComponentProperty[], label: string, extra: Op[] = [], merge?: string): void {
    this.run(label, [{ op: 'set', id: owner.id, key: 'properties', value: list.length ? list : undefined }, ...extra], { merge });
  }

  /** Cria uma propriedade. Com `bind`, já liga o nó a ela (com o valor atual dele como padrão). */
  addProperty(ownerId: string, type: ComponentProperty['type'], bind?: { nodeId: string; slot: 'visible' | 'text' | 'component' }): string | null {
    const owner = this.model.index.get(ownerId) as ContainerNode | undefined;
    if (!owner) return null;
    const list = owner.properties ?? [];
    const node = bind ? this.model.index.get(bind.nodeId) : undefined;
    const id = uid(8);
    // nome a partir da camada ligada: "Mostrar Ícone", "Rótulo", "Troca Ícone"
    const base = !node ? PROP_NAMES[type] : type === 'text' ? node.name : `${PROP_NAMES[type]} ${node.name}`;
    let name = base;
    let k = 2;
    while (list.some((p) => p.name === name)) name = `${base} ${k++}`;
    let prop: ComponentProperty;
    if (type === 'boolean') prop = { id, name, type, default: true };
    else if (type === 'text') prop = { id, name, type, default: node?.type === 'text' ? node.text : 'Texto' };
    else {
      const def = node?.type === 'instance' ? node.componentId : this.model.index.components().find((c) => c.id !== owner.id && !this.model.index.isAncestor(owner.id, c.id))?.id;
      if (!def) {
        this.toast('info', 'Crie outro componente para usar na troca de instância.');
        return null;
      }
      prop = { id, name, type, default: def };
    }
    const extra: Op[] = bind ? [{ op: 'set', id: bind.nodeId, key: `propRefs.${bind.slot}`, value: id }] : [];
    this.setProperties(owner, [...list, prop], 'Nova propriedade', extra);
    return id;
  }

  updateProperty(ownerId: string, propId: string, patch: Partial<ComponentProperty>, merge?: string): void {
    const owner = this.model.index.get(ownerId) as ContainerNode | undefined;
    if (!owner) return;
    this.setProperties(owner, (owner.properties ?? []).map((p) => (p.id === propId ? ({ ...p, ...patch } as ComponentProperty) : p)), 'Editar propriedade', [], merge);
  }

  removeProperty(ownerId: string, propId: string): void {
    const owner = this.model.index.get(ownerId) as ContainerNode | undefined;
    if (!owner) return;
    // solta os nós ligados a ela
    const extra: Op[] = [];
    const visit = (list: SceneNode[]) => list.forEach((n) => {
      for (const [slot, ref] of Object.entries(n.propRefs ?? {})) if (ref === propId) extra.push({ op: 'set', id: n.id, key: `propRefs.${slot}`, value: undefined });
      if ('children' in n) visit(n.children);
    });
    visit(owner.children);
    this.setProperties(owner, (owner.properties ?? []).filter((p) => p.id !== propId), 'Remover propriedade', extra);
  }

  bindProperty(nodeId: string, slot: 'visible' | 'text' | 'component', propId: string | undefined): void {
    this.run(propId ? 'Ligar propriedade' : 'Desligar propriedade', [{ op: 'set', id: nodeId, key: `propRefs.${slot}`, value: propId }]);
  }

  setInstanceProp(instId: string, propId: string, value: boolean | string, merge?: string): void {
    this.run('Editar instância', [{ op: 'set', id: instId, key: `props.${propId}`, value }], { merge });
  }

  /** Propriedades, conjunto e componente principal de uma instância. */
  instanceInfo(inst: InstanceNode): { defs: ComponentProperty[]; set?: ContainerNode; main?: ContainerNode } {
    const main = this.findComponent(inst.componentId, inst.library);
    if (!main) return { defs: [] };
    return { defs: propertyDefs(main, this.finder, inst.library), set: this.finder.setOf?.(main.id, inst.library), main };
  }

  // ── Operações booleanas e vetores ──────────────────────────────────────────

  booleanOperation(op: BooleanOp): void {
    const sel = this.selectedNodes();
    if (sel.length === 1 && sel[0].type === 'boolean') {
      this.run('Operação booleana', [{ op: 'set', id: sel[0].id, key: 'booleanOp', value: op }, { op: 'set', id: sel[0].id, key: 'name', value: BOOLEAN_NAMES[op] }]);
      return;
    }
    const ids = this.inTreeOrder(this.topLevel(this.selection));
    if (ids.length < 2) return this.toast('info', 'Selecione duas ou mais formas para combinar.');
    const bottom = this.model.index.get(ids[0])!;
    const fills = bottom.fills?.length ? clone(bottom.fills) : [{ type: 'solid', color: '#d9d4ca' } as Paint];
    this.wrap('boolean', { booleanOp: op, name: BOOLEAN_NAMES[op], fills, strokes: clone(bottom.strokes), effects: clone(bottom.effects) });
  }

  /** Converte formas e operações booleanas em vetores editáveis (a camada mantém o id). */
  flatten(ids = this.selection): string[] {
    const host = this.host;
    if (!host) return [];
    const merged = this.flattenMerged(ids);
    if (merged) return [merged];
    const ops: Op[] = [];
    const out: string[] = [];
    let skipped = 0;
    for (const id of this.topLevel(ids)) {
      const n = this.model.index.get(id)!;
      if (n.type === 'path') {
        out.push(id);
        continue;
      }
      const shape = ['rect', 'ellipse', 'polygon', 'star', 'line', 'boolean', 'text'].includes(n.type) && !(n.type === 'rect' && n.fills?.some((f) => f.type === 'image'));
      if (!shape || n.locked) {
        skipped++;
        continue;
      }
      if (n.type === 'text' && !host.canOutlineText(n)) {
        this.toast('warn', `Não foi possível ler o contorno da fonte “${n.style.family}”.`, { detail: 'A fonte ainda está carregando ou está num formato que não dá para converter (por exemplo, coleções .ttc).' });
        continue;
      }
      const { d, fillRule } = host.outline(n);
      if (!d) continue;
      const fit = refitPath(n, parsePath(d));
      const { children: _c, booleanOp: _b, points: _p, innerRadius: _i, cornerRadius: _r, layout: _l, clip: _k, text: _t, style: _s, autoResize: _a, textPath: _tp, ...rest } = n as ContainerNode & { points?: number; innerRadius?: number; text?: string; style?: unknown; autoResize?: unknown; textPath?: unknown };
      const node = { ...rest, type: 'path', d: fit.d, ...(fillRule === 'evenodd' ? { fillRule } : {}), x: fit.x, y: fit.y, width: fit.width, height: fit.height } as PathNode;
      if (n.type === 'line') delete node.fills;
      // o vetor que veio de um texto não tem mais estilo de texto nem propriedade de texto ligada
      if (node.styles?.text) {
        const { text: _st, ...others } = node.styles;
        node.styles = Object.keys(others).length ? others : undefined;
      }
      if (node.propRefs?.text) node.propRefs = { ...node.propRefs, text: undefined };
      const parent = this.model.index.parentId(id)!;
      const index = this.model.index.siblings(parent)!.findIndex((s) => s.id === id);
      ops.push({ op: 'remove', id }, { op: 'insert', parent, index, node });
      out.push(id);
    }
    if (skipped && !ops.length && !out.length) this.toast('info', 'Só formas, textos e operações booleanas podem virar vetor.');
    if (ops.length) this.run('Converter em vetor', ops, { select: out });
    return out;
  }

  /** Várias formas do mesmo nível viram um vetor só (com a aparência da forma de cima). */
  private flattenMerged(ids: string[]): string | null {
    const host = this.host;
    const top = this.inTreeOrder(this.topLevel(ids));
    if (!host || top.length < 2) return null;
    const parent = this.model.index.parentId(top[0])!;
    const nodes = top.map((id) => this.model.index.get(id)!);
    const ok = nodes.every((n) => this.model.index.parentId(n.id) === parent && !n.locked && ['rect', 'ellipse', 'polygon', 'star', 'line', 'path', 'boolean', 'text'].includes(n.type) && !(n.type === 'rect' && n.fills?.some((f) => f.type === 'image')) && (n.type !== 'text' || host.canOutlineText(n)));
    if (!ok) return null;
    const all = nodes.flatMap((n) => {
      const { d } = host.outline(n);
      if (!d) return [];
      const m = nodeMatrix(n);
      return mapPoints(parsePath(d), (p) => apply(m, p));
    });
    if (!all.length) return null;
    const fit = refitPath({ x: 0, y: 0, width: 0, height: 0 }, all);
    const look = nodes[nodes.length - 1]; // a de cima
    const node = createNode('path', { x: fit.x, y: fit.y, width: fit.width, height: fit.height }, {
      name: 'Vetor',
      d: fit.d,
      fills: look.type === 'line' ? [] : clone(look.fills ?? []),
      strokes: clone(look.strokes ?? []),
      ...(look.effects?.length ? { effects: clone(look.effects) } : {}),
      ...(look.opacity !== undefined ? { opacity: look.opacity } : {}),
    });
    const list = this.model.index.siblings(parent)!;
    const index = list.findIndex((s) => s.id === look.id) - (nodes.length - 1);
    const ops: Op[] = nodes.map((n) => ({ op: 'remove', id: n.id }) as Op);
    ops.push({ op: 'insert', parent, index: Math.max(0, index), node });
    return this.run('Converter em vetor', ops, { select: [node.id] }) ? node.id : null;
  }

  /** Abre os pontos de um vetor para edição (formas são convertidas antes). */
  enterVectorEdit(id = this.selection[0]): void {
    let n = id ? this.model.index.get(id) : undefined;
    if (!n || n.locked) return;
    if (n.type !== 'path') {
      if (!this.flatten([id]).length) return;
      n = this.model.index.get(id);
      if (n?.type !== 'path') return;
    }
    this.select([id]);
    this.vectorEdit = id;
    this.setTool('move');
    this.emit('selection', 'tool');
  }

  exitVectorEdit(): void {
    if (!this.vectorEdit) return;
    this.vectorEdit = null;
    this.host?.interaction?.vector.clear();
    this.model.seal();
    this.emit('selection', 'tool');
  }

  // ── Guias ──────────────────────────────────────────────────────────────────

  setGuides(guides: Guide[], label = 'Guias'): void {
    this.run(label, [{ op: 'set', id: this.pageId, key: 'guides', value: guides.length ? guides : undefined }]);
  }

  // ── Estilos ────────────────────────────────────────────────────────────────

  /** Cria um estilo a partir de uma camada e já liga a camada a ele. */
  createStyle(slot: StyleSlot, fromId = this.selection[0], name?: string): void {
    const n = fromId ? this.model.index.get(fromId) : undefined;
    if (!n) return;
    const id = uid(10);
    const count = (this.doc.styles ?? []).filter((s) => s.type === (slot === 'text' ? 'text' : slot === 'effect' ? 'effect' : 'color')).length + 1;
    let style: Style;
    if (slot === 'fill' || slot === 'stroke') {
      const paints = slot === 'fill' ? n.fills ?? [] : (n.strokes ?? []).map((s) => s.paint);
      if (!paints.length) return this.toast('info', 'Adicione uma cor antes de criar o estilo.');
      style = { id, name: name ?? `Cor ${count}`, type: 'color', paints: clone(paints) };
    } else if (slot === 'text') {
      if (n.type !== 'text') return;
      style = { id, name: name ?? `Texto ${count}`, type: 'text', text: textStyleOf(n.style) };
    } else {
      if (!n.effects?.length) return this.toast('info', 'Adicione um efeito antes de criar o estilo.');
      style = { id, name: name ?? `Efeito ${count}`, type: 'effect', effects: clone(n.effects) };
    }
    this.run('Criar estilo', [{ op: 'doc', key: 'styles', value: [...(this.doc.styles ?? []), style] }, { op: 'set', id: n.id, key: `styles.${slot}`, value: id }]);
    this.toast('success', `Estilo “${style.name}” criado.`, { detail: 'Ele aparece na lista de estilos e pode ser usado em outras camadas.' });
  }

  applyStyle(ids: string[], slot: StyleSlot, styleId: string): void {
    const style = findStyle(this.doc, styleId);
    if (!style) return;
    this.setEach(ids.filter((id) => !this.isInner(id)), (n) => stylePatch(n, style, slot), 'Aplicar estilo');
  }

  detachStyle(ids: string[], slot: StyleSlot): void {
    this.setEach(ids, (n) => (n.styles?.[slot] ? detachPatch(n, slot) : null), 'Desvincular estilo');
  }

  /** Grava o estilo e reaplica nas camadas que o usam. */
  updateStyle(style: Style, merge?: string): void {
    const list = (this.doc.styles ?? []).map((s) => (s.id === style.id ? style : s));
    this.run('Editar estilo', [{ op: 'doc', key: 'styles', value: list }, ...propagateStyle(this.doc, style)], { merge });
  }

  /** Redefine o estilo com o valor atual de uma camada. */
  redefineStyle(styleId: string, fromId = this.selection[0]): void {
    const style = (this.doc.styles ?? []).find((s) => s.id === styleId);
    const n = fromId ? this.model.index.get(fromId) : undefined;
    if (!style || !n) return;
    const slot = n.styles && (Object.keys(n.styles) as StyleSlot[]).find((k) => n.styles![k] === styleId);
    if (style.type === 'color') this.updateStyle({ ...style, paints: clone(slot === 'stroke' ? (n.strokes ?? []).map((s) => s.paint) : n.fills ?? []) });
    else if (style.type === 'text' && n.type === 'text') this.updateStyle({ ...style, text: textStyleOf(n.style) });
    else if (style.type === 'effect') this.updateStyle({ ...style, effects: clone(n.effects ?? []) });
  }

  deleteStyle(styleId: string): void {
    this.run('Excluir estilo', [{ op: 'doc', key: 'styles', value: (this.doc.styles ?? []).filter((s) => s.id !== styleId) }, ...releaseStyle(this.doc, styleId)]);
  }

  // ── Protótipo ──────────────────────────────────────────────────────────────

  setRightTab(tab: 'design' | 'prototype'): void {
    if (this.rightTab === tab) return;
    this.rightTab = tab;
    this.emit('ui', 'view');
  }

  setInteraction(ids: string[], it: Interaction | undefined, merge?: string): void {
    this.setProp(ids, 'interactions', it ? [it] : undefined, merge);
  }

  setFlowStart(id: string | undefined): void {
    this.run('Início do protótipo', [{ op: 'set', id: this.pageId, key: 'flowStart', value: id }]);
  }

  /** Abre o modo de apresentação na tela da seleção (ou no início do fluxo). */
  present(): void {
    if (this.home) return;
    const page = this.page;
    const sel = this.selection[0];
    const screen = (sel && screenOf(page, sel, (id) => this.model.index.parentId(id))) || startScreen(page);
    if (!screen) return this.toast('info', 'Desenhe um frame para apresentar o protótipo.');
    this.exitVectorEdit();
    this.presenting = { pageId: page.id, screen: screen.id, history: [], seq: 0 };
    this.emit('ui');
  }

  presentGo(target: string, it?: Pick<Interaction, 'transition' | 'duration'>): void {
    const p = this.presenting;
    if (!p || !this.model.index.get(target)) return;
    // navegar fecha as sobreposições abertas
    if (target === p.screen) {
      if (p.overlays?.length) this.presenting = { ...p, overlays: [] };
      return this.emit('ui');
    }
    this.presenting = { ...p, screen: target, history: [...p.history, p.screen], from: p.screen, transition: it?.transition ?? 'instant', duration: it?.duration ?? 300, seq: p.seq + 1, overlays: [] };
    this.emit('ui');
  }

  /** Abre um frame por cima da tela atual (modal, menu, aviso…). */
  presentOverlay(it: Interaction): void {
    const p = this.presenting;
    if (!p || !it.target || !this.model.index.get(it.target) || it.target === p.screen) return;
    const list = (p.overlays ?? []).filter((o) => o.id !== it.target);
    this.presenting = { ...p, overlays: [...list, { id: it.target, interaction: it }] };
    this.emit('ui');
  }

  /** Fecha a sobreposição de cima. */
  presentClose(): void {
    const p = this.presenting;
    if (!p?.overlays?.length) return;
    this.presenting = { ...p, overlays: p.overlays.slice(0, -1) };
    this.emit('ui');
  }

  /** O que um clique numa área com ligação faz. */
  presentAct(it: Interaction): void {
    if (it.action === 'back') return this.presenting?.overlays?.length ? this.presentClose() : this.presentBack();
    if (it.action === 'close') return this.presentClose();
    if (it.action === 'overlay') return this.presentOverlay(it);
    if (it.target) this.presentGo(it.target, it);
  }

  presentBack(): void {
    const p = this.presenting;
    if (p?.overlays?.length) return this.presentClose();
    const prev = p?.history[p.history.length - 1];
    if (!p || !prev) return;
    this.presenting = { ...p, screen: prev, history: p.history.slice(0, -1), from: p.screen, transition: 'dissolve', duration: 200, seq: p.seq + 1, overlays: [] };
    this.emit('ui');
  }

  stopPresenting(): void {
    if (!this.presenting) return;
    const screen = this.presenting.screen;
    this.presenting = null;
    if (this.model.index.get(screen)) this.select([screen]);
    this.emit('ui');
  }

  // ── Ordem e visibilidade ───────────────────────────────────────────────────

  reorder(where: 'front' | 'back' | 'forward' | 'backward'): void {
    const ids = this.topLevel(this.selection);
    const ops: Op[] = [];
    for (const id of where === 'front' || where === 'forward' ? [...ids].reverse() : ids) {
      const parent = this.model.index.parentId(id)!;
      const list = this.model.index.siblings(parent)!;
      const i = list.findIndex((s) => s.id === id);
      const to = where === 'front' ? list.length - 1 : where === 'back' ? 0 : where === 'forward' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
      if (to !== i) ops.push({ op: 'move', id, parent, index: to });
    }
    this.run('Reordenar', ops);
  }

  toggle(key: 'visible' | 'locked', ids = this.selection): void {
    const nodes = ids.map((id) => this.model.index.get(id)).filter(Boolean) as SceneNode[];
    if (!nodes.length) return;
    const current = key === 'visible' ? nodes.every((n) => n.visible !== false) : nodes.every((n) => n.locked);
    const value = key === 'visible' ? (current ? false : undefined) : current ? undefined : true;
    this.run(key === 'visible' ? (current ? 'Ocultar' : 'Mostrar') : current ? 'Desbloquear' : 'Bloquear', nodes.map((n) => ({ op: 'set', id: n.id, key, value }) as Op));
    if (key === 'locked' && !current) this.select([]);
  }

  moveInto(id: string, parent: string, index: number): void {
    if (id === parent || this.model.index.isAncestor(id, parent)) return;
    const b = this.worldBounds(id);
    const n = this.model.index.get(id)!;
    const local = this.toLocal(parent, { x: b.x, y: b.y });
    const same = this.model.index.parentId(id) === parent;
    const ops: Op[] = [{ op: 'move', id, parent, index }];
    if (!same && !n.rotation) ops.push({ op: 'set', id, key: 'x', value: Math.round(local.x) }, { op: 'set', id, key: 'y', value: Math.round(local.y) });
    this.run('Mover camada', ops);
  }

  nudge(dx: number, dy: number): void {
    const ids = this.topLevel(this.selection).filter((id) => !this.model.index.get(id)?.locked);
    this.setEach(ids, (n) => ({ x: n.x + dx, y: n.y + dy }), 'Mover', 'nudge');
  }

  // ── Alinhamento ────────────────────────────────────────────────────────────

  align(where: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'): void {
    const ids = this.topLevel(this.selection);
    if (!ids.length) return;
    let target: Rect | null;
    if (ids.length === 1) {
      const parent = this.model.index.parentId(ids[0])!;
      if (parent === this.pageId) return this.toast('info', 'Selecione duas ou mais camadas, ou uma camada dentro de um frame.');
      target = this.worldBounds(parent);
    } else target = unionRects(ids.map((id) => this.worldBounds(id)));
    const ops: Op[] = [];
    for (const id of ids) {
      const b = this.worldBounds(id);
      let dx = 0, dy = 0;
      if (where === 'left') dx = target.x - b.x;
      if (where === 'hcenter') dx = target.x + target.width / 2 - (b.x + b.width / 2);
      if (where === 'right') dx = target.x + target.width - (b.x + b.width);
      if (where === 'top') dy = target.y - b.y;
      if (where === 'vcenter') dy = target.y + target.height / 2 - (b.y + b.height / 2);
      if (where === 'bottom') dy = target.y + target.height - (b.y + b.height);
      const n = this.model.index.get(id)!;
      if (dx) ops.push({ op: 'set', id, key: 'x', value: Math.round(n.x + dx) });
      if (dy) ops.push({ op: 'set', id, key: 'y', value: Math.round(n.y + dy) });
    }
    this.run('Alinhar', ops);
  }

  distribute(axis: 'h' | 'v'): void {
    const ids = this.topLevel(this.selection);
    if (ids.length < 3) return this.toast('info', 'Selecione três ou mais camadas para distribuir.');
    const items = ids.map((id) => ({ id, b: this.worldBounds(id) })).sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = items[0].b, last = items[items.length - 1].b;
    const total = items.reduce((s, i) => s + (axis === 'h' ? i.b.width : i.b.height), 0);
    const span = axis === 'h' ? last.x + last.width - first.x : last.y + last.height - first.y;
    const gap = (span - total) / (items.length - 1);
    let cursor = axis === 'h' ? first.x : first.y;
    const ops: Op[] = [];
    for (const it of items) {
      const n = this.model.index.get(it.id)!;
      const d = cursor - (axis === 'h' ? it.b.x : it.b.y);
      if (Math.abs(d) > 0.01) ops.push({ op: 'set', id: it.id, key: axis === 'h' ? 'x' : 'y', value: Math.round((axis === 'h' ? n.x : n.y) + d) });
      cursor += (axis === 'h' ? it.b.width : it.b.height) + gap;
    }
    this.run('Distribuir', ops);
  }

  // ── Auto layout ────────────────────────────────────────────────────────────

  addAutoLayout(): void {
    const sel = this.selectedNodes();
    const n = sel[0];
    if (!n) return;
    // um grupo vira um frame com auto layout (em vez de ganhar um frame em volta)
    if (sel.length === 1 && n.type === 'group' && !this.isInner(n.id)) {
      const kids = [...n.children];
      const xs = kids.map((k) => k.x), ys = kids.map((k) => k.y);
      const horizontal = kids.length > 1 && Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys);
      kids.sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
      const frame = {
        ...clone(n),
        id: uid(),
        type: 'frame' as const,
        children: clone(kids),
        fills: [],
        clip: false,
        layout: { direction: horizontal ? 'horizontal' : 'vertical', gap: 10, padding: [0, 0, 0, 0], justify: 'start', align: 'start' },
        sizing: { horizontal: 'hug', vertical: 'hug' },
      } as ContainerNode;
      const parent = this.model.index.parentId(n.id)!;
      const index = this.model.index.siblings(parent)!.findIndex((s) => s.id === n.id);
      this.run('Adicionar auto layout', [{ op: 'remove', id: n.id }, { op: 'insert', parent, index, node: frame }], { select: [frame.id] });
      return;
    }
    // um frame sem auto layout ganha o auto layout; qualquer outra coisa (ou várias camadas) vai para dentro de um frame novo
    if (sel.length === 1 && (n.type === 'frame' || n.type === 'component') && !n.layout) {
      const kids = n.children;
      const horizontal = kids.length > 1 && (() => {
        const xs = kids.map((k) => k.x), ys = kids.map((k) => k.y);
        return Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys);
      })();
      this.run('Adicionar auto layout', [
        { op: 'set', id: n.id, key: 'layout', value: { direction: horizontal ? 'horizontal' : 'vertical', gap: 10, padding: [16, 16, 16, 16], justify: 'start', align: 'start' } },
        { op: 'set', id: n.id, key: 'sizing', value: { horizontal: 'hug', vertical: 'hug' } },
      ]);
      return;
    }
    // envolve a seleção num frame com auto layout
    this.wrap('frame');
    const f = this.selectedNodes()[0];
    if (f) {
      const kids = (f as ContainerNode).children ?? [];
      const xs = kids.map((k) => k.x), ys = kids.map((k) => k.y);
      const horizontal = kids.length > 1 && Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys);
      const sorted = [...kids].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
      const ops: Op[] = sorted.map((k, i) => ({ op: 'move', id: k.id, parent: f.id, index: i }) as Op);
      ops.push(
        { op: 'set', id: f.id, key: 'layout', value: { direction: horizontal ? 'horizontal' : 'vertical', gap: 10, padding: [0, 0, 0, 0], justify: 'start', align: 'start' } },
        { op: 'set', id: f.id, key: 'sizing', value: { horizontal: 'hug', vertical: 'hug' } },
      );
      this.run('Adicionar auto layout', ops);
    }
  }

  /** Tira o auto layout: os filhos ficam onde estão, e o frame mantém o tamanho atual. */
  removeAutoLayout(): void {
    const ops: Op[] = [];
    for (const n of this.selectedNodes()) {
      if (!('layout' in n) || !n.layout) continue;
      ops.push({ op: 'set', id: n.id, key: 'layout', value: undefined }, { op: 'set', id: n.id, key: 'sizing', value: undefined });
      for (const c of n.children) if (c.sizing) ops.push({ op: 'set', id: c.id, key: 'sizing', value: undefined });
    }
    if (ops.length) this.run('Remover auto layout', ops);
  }

  // ── Seleção pelo menu ──────────────────────────────────────────────────────

  selectParent(): void {
    const parent = this.selection[0] && this.model.index.parentId(this.selection[0]);
    if (parent && parent !== this.pageId && this.model.index.get(parent)) this.select([parent]);
  }

  selectChildren(): void {
    const kids = this.selectedNodes().flatMap((n) => ('children' in n && n.type !== 'boolean' ? n.children.map((k) => k.id) : []));
    if (kids.length) this.select(kids);
  }

  /** Abre o nome da camada para edição no painel de camadas. */
  renameLayer(): void {
    const id = this.selection.find((x) => this.model.index.get(x));
    if (!id) return;
    this.leftTab = 'layers';
    this.emit('ui');
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('zaliel:rename-layer', { detail: id })));
  }

  /** Copia a camada como imagem PNG (2×) ou como código SVG, para colar em outros programas. */
  async copyAs(format: 'png' | 'svg'): Promise<void> {
    const n = this.selectedNodes()[0];
    if (!n || !this.host) return;
    try {
      if (format === 'svg') {
        await navigator.clipboard.writeText(exportSvg(this.doc, n, this.resolve));
      } else {
        const bytes = await this.host.encodeImage(n, 2, 'png');
        if (!bytes) throw new Error('falha ao desenhar a imagem');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes as BlobPart], { type: 'image/png' }) })]);
      }
      this.toast('info', `“${n.name}” copiado como ${format.toUpperCase()}.`);
    } catch (e) {
      this.toast('error', `Não foi possível copiar como ${format.toUpperCase()}.`, { detail: String((e as Error)?.message ?? e) });
    }
  }

  // ── Imagens ────────────────────────────────────────────────────────────────

  async importImages(): Promise<void> {
    const imgs = await this.platform.pickImages();
    if (imgs.length) await this.insertImages(imgs);
  }

  /** Guarda uma imagem nos assets do arquivo (sem criar camada). Devolve a chave. */
  async addImageAsset(img: { name: string; mime: string; data: string }): Promise<string | null> {
    const key = hashText(img.data.slice(0, 20000) + img.data.length);
    const size = await imageSize(img.mime, img.data);
    if (!size) {
      this.toast('error', `“${img.name}” não é uma imagem que dá para abrir.`);
      return null;
    }
    if (!this.doc.assets[key]) this.run('Adicionar imagem', [{ op: 'asset', key, value: { mime: img.mime, data: img.data, width: size.width, height: size.height } }]);
    return key;
  }

  async insertImages(imgs: { name: string; mime: string; data: string }[], at?: Point): Promise<void> {
    const ops: Op[] = [];
    const ids: string[] = [];
    let c = at ?? this.viewCenter();
    for (const img of imgs) {
      const key = hashText(img.data.slice(0, 20000) + img.data.length);
      const size = await imageSize(img.mime, img.data);
      if (!size) {
        this.toast('error', `“${img.name}” não é uma imagem que dá para abrir.`);
        continue;
      }
      if (!this.doc.assets[key]) ops.push({ op: 'asset', key, value: { mime: img.mime, data: img.data, width: size.width, height: size.height } });
      const scale = Math.min(1, 1200 / Math.max(size.width, size.height));
      const w = Math.round(size.width * scale), h = Math.round(size.height * scale);
      const parent = this.containerAt(c);
      const local = this.toLocal(parent, { x: c.x - (at ? 0 : w / 2), y: c.y - (at ? 0 : h / 2) });
      const node = createNode('rect', { x: Math.round(local.x), y: Math.round(local.y), width: w, height: h }, {
        name: img.name.replace(/\.[a-z0-9]+$/i, ''),
        fills: [{ type: 'image', asset: key, scaleMode: 'fill' }],
      });
      ops.push({ op: 'insert', parent, index: (this.model.index.siblings(parent) ?? []).length + ids.length, node });
      ids.push(node.id);
      c = { x: c.x + 24, y: c.y + 24 };
    }
    if (ops.length) this.run(ids.length > 1 ? 'Inserir imagens' : 'Inserir imagem', ops, { select: ids });
  }

  // ── Páginas ────────────────────────────────────────────────────────────────

  addPage(): void {
    const page = createPage(`Página ${this.doc.pages.length + 1}`);
    page.background = this.page.background;
    if (this.run('Nova página', [{ op: 'insert', parent: ROOT, index: this.doc.pages.length, node: page }])) this.setPage(page.id);
  }

  renamePage(id: string, name: string): void {
    if (name.trim()) this.run('Renomear página', [{ op: 'set', id, key: 'name', value: name.trim() }]);
  }

  deletePage(id: string): void {
    if (this.doc.pages.length <= 1) return this.toast('info', 'O arquivo precisa de pelo menos uma página.');
    const p = this.model.index.page(id);
    if (p && p.children.length && !window.confirm(`Excluir a página “${p.name}” e tudo o que está nela?`)) return;
    this.run('Excluir página', [{ op: 'remove', id }]);
  }

  duplicatePage(id: string): void {
    const p = this.model.index.page(id);
    if (!p) return;
    const copy: Page = { ...clone(p), id: uid(), name: `${p.name} (cópia)`, children: p.children.map((c) => reidentify(c)) };
    const index = this.doc.pages.findIndex((x) => x.id === id) + 1;
    if (this.run('Duplicar página', [{ op: 'insert', parent: ROOT, index, node: copy }])) this.setPage(copy.id);
  }

  // ── Bibliotecas ────────────────────────────────────────────────────────────

  async addLibrary(): Promise<void> {
    const res = await this.platform.pickLibrary();
    if (!res) return;
    try {
      const src = parse(res.text);
      if (src.id === this.doc.id) return this.toast('warn', 'Este é o próprio arquivo aberto. Os componentes dele já aparecem em “Neste arquivo”.');
      const lib = buildLibrary(src, res.path);
      if (!lib.components.length && !(lib.variables ?? []).length) return this.toast('warn', `“${src.name}” não tem componentes nem variáveis para usar como biblioteca.`);
      const others = this.doc.libraries.filter((l) => l.id !== lib.id);
      this.run('Adicionar biblioteca', [{ op: 'doc', key: 'libraries', value: [...others, lib] }]);
      this.toast('success', `Biblioteca “${lib.name}” adicionada.`, { detail: `${lib.components.length} componente(s). Ela fica guardada dentro deste arquivo e funciona offline.` });
    } catch (e) {
      this.toast('error', 'Não foi possível usar este arquivo como biblioteca.', { detail: (e as Error).message });
    }
  }

  libraryUpdate(id: string): string | undefined {
    return this.libraryChanges.get(id);
  }

  /** Confere se os arquivos das bibliotecas mudaram desde a última vez. */
  async checkLibraries(): Promise<void> {
    for (const lib of this.doc.libraries) {
      try {
        const src = parse(await this.platform.readFile(lib.path));
        const fresh = buildLibrary(src, lib.path);
        if (fresh.hash !== lib.hash) this.libraryChanges.set(lib.id, fresh.hash);
        else this.libraryChanges.delete(lib.id);
      } catch {
        /* arquivo da biblioteca indisponível: continua usando a cópia guardada */
      }
    }
    if (this.libraryChanges.size) {
      this.emit('ui');
      this.toast('info', 'Há atualizações nas bibliotecas deste arquivo.', { action: { label: 'Atualizar todas', run: () => this.updateLibraries() } });
    }
  }

  async updateLibraries(only?: string): Promise<void> {
    const libs = clone(this.doc.libraries);
    let n = 0;
    for (const [i, lib] of libs.entries()) {
      if (only && lib.id !== only) continue;
      try {
        libs[i] = buildLibrary(parse(await this.platform.readFile(lib.path)), lib.path);
        this.libraryChanges.delete(lib.id);
        n++;
      } catch (e) {
        this.toast('error', `Não foi possível ler a biblioteca “${lib.name}”.`, { detail: friendlyFsError(e) });
      }
    }
    if (n) {
      this.run('Atualizar bibliotecas', [{ op: 'doc', key: 'libraries', value: libs }]);
      this.toast('success', n === 1 ? 'Biblioteca atualizada.' : `${n} bibliotecas atualizadas.`);
    }
  }

  removeLibrary(id: string): void {
    const used = JSON.stringify(this.doc.pages).includes(`"library":"${id}"`);
    if (used && !window.confirm('Há instâncias desta biblioteca no arquivo. Elas vão aparecer como “componente ausente”. Remover mesmo assim?')) return;
    this.run('Remover biblioteca', [{ op: 'doc', key: 'libraries', value: this.doc.libraries.filter((l) => l.id !== id) }]);
  }

  // ── Variáveis ──────────────────────────────────────────────────────────────

  setVariables(collections: VariableCollection[], merge?: string): void {
    this.run('Editar variáveis', [{ op: 'doc', key: 'variables', value: collections }], { merge });
  }

  setMode(collectionId: string, modeId: string): void {
    const settings = { ...this.doc.settings, modes: { ...(this.doc.settings?.modes ?? {}), [collectionId]: modeId } };
    this.run('Trocar modo', [{ op: 'doc', key: 'settings', value: settings }]);
  }

  // ── Exportação ─────────────────────────────────────────────────────────────

  async exportSelection(format: 'png' | 'jpg' | 'webp' | 'svg' | 'pdf', scale = 1): Promise<void> {
    const nodes = this.selectedNodes();
    const targets = nodes.length ? nodes : [];
    if (!targets.length) return this.toast('info', 'Selecione o que quer exportar.');
    if (format === 'pdf') return this.exportPdf(targets, scale);
    for (const n of targets) {
      const name = `${n.name}${scale !== 1 && format !== 'svg' ? `@${scale}x` : ''}.${format}`;
      try {
        let data: Uint8Array | string | null;
        if (format === 'svg') data = exportSvg(this.doc, n, this.resolve);
        else data = this.host?.exportImage(n, scale, format) ?? null;
        if (!data) throw new Error('falha ao desenhar a imagem');
        const path = await this.platform.exportFile(data, name, format);
        if (path) this.toast('success', `Exportado: ${name}`, { action: { label: 'Mostrar na pasta', run: () => this.platform.revealFile(path) } });
      } catch (e) {
        this.toast('error', `Não foi possível exportar “${n.name}”.`, { detail: friendlyFsError(e) });
      }
    }
  }

  /** Camadas que entram numa exportação em lote (telas em ordem de leitura). */
  batchItems(scope: BatchExport['scope']): BatchItem[] {
    const screensOf = (list: SceneNode[]) =>
      list.filter((n) => n.visible !== false && (n.type === 'frame' || n.type === 'component' || n.type === 'component-set')).sort((a, b) => a.y - b.y || a.x - b.x);
    if (scope === 'selection') {
      return this.selectedNodes()
        .filter((n) => !this.isInner(n.id))
        .map((node, i) => ({ node, pageId: this.pageId, pageName: this.page.name, index: i + 1 }));
    }
    const pages = scope === 'page' ? [this.page] : this.doc.pages;
    return pages.flatMap((p) => screensOf(p.children).map((node, i) => ({ node, pageId: p.id, pageName: p.name, index: i + 1 })));
  }

  /** Nomes finais dos arquivos (com pastas, extensão e sem repetir). */
  batchNames(items: BatchItem[], o: BatchExport): string[] {
    const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'sem nome';
    const pad = String(Math.max(...items.map((x) => x.index), 1)).length;
    const scales = o.format === 'svg' ? [1] : o.scales.length ? o.scales : [1];
    const seen = new Map<string, number>();
    const out: string[] = [];
    for (const it of items) {
      for (const s of scales) {
        let name = (o.pattern.trim() || '{nome}')
          .replace(/\{pagina\}/g, clean(it.pageName))
          .replace(/\{nome\}/g, clean(it.node.name))
          .replace(/\{n\}/g, String(it.index).padStart(Math.max(2, pad), '0'))
          .replace(/\{escala\}/g, `${s}x`)
          .replace(/\{arquivo\}/g, clean(this.doc.name));
        name = name.split('/').map((p) => p.trim()).filter(Boolean).join('/') || clean(it.node.name);
        // várias escalas sem {escala} no padrão: "@2x" no fim, para não sobrescrever
        if (scales.length > 1 && !o.pattern.includes('{escala}')) name += `@${s}x`;
        const key = name.toLowerCase();
        const k = (seen.get(key) ?? 0) + 1;
        seen.set(key, k);
        out.push(`${name}${k > 1 ? ` (${k})` : ''}.${o.format}`);
      }
    }
    return out;
  }

  /** Exporta várias telas de uma vez para uma pasta. */
  async exportBatch(o: BatchExport): Promise<boolean> {
    const host = this.host;
    if (!host || this.home) return false;
    const items = this.batchItems(o.scope);
    if (!items.length) {
      this.toast('info', o.scope === 'selection' ? 'Selecione o que quer exportar.' : 'Não há frames para exportar.');
      return false;
    }
    const names = this.batchNames(items, o);
    const scales = o.format === 'svg' ? [1] : o.scales.length ? o.scales : [1];
    const files: { name: string; data: Uint8Array | string }[] = [];
    const t0 = performance.now();
    try {
      let k = 0;
      for (const it of items) {
        this.layoutPage(it.pageId);
        for (const s of scales) {
          const name = names[k++];
          let data: Uint8Array | string | null;
          if (o.format === 'svg') data = exportSvg(this.doc, it.node, this.resolve);
          else if (o.format === 'pdf') {
            const sc = Math.min(s, 8000 / Math.max(it.node.width, it.node.height, 1));
            const px = host.pixels(it.node, sc);
            if (!px) throw new Error(`falha ao desenhar “${it.node.name}”`);
            const { rgb, alpha } = splitRgba(px.rgba, px.width, px.height);
            data = buildPdf([{ width: it.node.width, height: it.node.height, image: { width: px.width, height: px.height, rgb: await deflate(rgb), alpha: alpha && (await deflate(alpha)), deflated: true } }], { title: it.node.name, producer: `Zaliel ${this.platform.version}` });
          } else data = await host.encodeImage(it.node, s, o.format);
          if (!data) throw new Error(`falha ao desenhar “${it.node.name}”`);
          files.push({ name, data });
          // deixa a janela respirar em lotes grandes
          if (files.length % 8 === 0) await new Promise((r) => setTimeout(r, 0));
        }
      }
    } catch (e) {
      this.toast('error', 'Não foi possível exportar.', { detail: friendlyFsError(e) });
      return false;
    }
    const res = await this.platform.exportBatch(files);
    if (!res) return false;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    this.toast('success', `${res.count} arquivo${res.count === 1 ? '' : 's'} exportado${res.count === 1 ? '' : 's'} (${secs} s).`, { detail: res.folder, action: { label: 'Mostrar a pasta', run: () => this.platform.revealFile(res.folder) } });
    return true;
  }

  /**
   * PDF com uma página por camada (frames, normalmente), no tamanho de cada uma.
   * Sem `nodes`, vão as telas da página atual na ordem de leitura (de cima para baixo, da esquerda para a direita).
   */
  async exportPdf(nodes?: SceneNode[], scale = 2): Promise<void> {
    const host = this.host;
    if (!host || this.home) return;
    const frames = this.page.children.filter((n) => n.visible !== false && n.type === 'frame');
    const targets = nodes ?? (frames.length ? frames : this.page.children.filter((n) => n.visible !== false && n.type === 'component')).sort((a, b) => a.y - b.y || a.x - b.x);
    if (!targets.length) return this.toast('info', 'Não há frames nesta página para exportar.');
    try {
      const pages = [];
      for (const n of targets) {
        // limita o tamanho da imagem de cada página (PDF leve e memória sob controle)
        const s = Math.min(scale, 8000 / Math.max(n.width, n.height, 1));
        const px = host.pixels(n, s);
        if (!px) throw new Error(`falha ao desenhar “${n.name}”`);
        const { rgb, alpha } = splitRgba(px.rgba, px.width, px.height);
        pages.push({ width: n.width, height: n.height, image: { width: px.width, height: px.height, rgb: await deflate(rgb), alpha: alpha && (await deflate(alpha)), deflated: true } });
      }
      const bytes = buildPdf(pages, { title: this.doc.name, producer: `Zaliel ${this.platform.version}` });
      const name = `${targets.length === 1 ? targets[0].name : this.doc.name}.pdf`;
      const path = await this.platform.exportFile(bytes, name, 'pdf');
      if (path) this.toast('success', `PDF exportado: ${pages.length === 1 ? '1 página' : `${pages.length} páginas`}.`, { detail: name, action: { label: 'Mostrar na pasta', run: () => this.platform.revealFile(path) } });
    } catch (e) {
      this.toast('error', 'Não foi possível exportar o PDF.', { detail: friendlyFsError(e) });
    }
  }

  // ── Fills rápidos ──────────────────────────────────────────────────────────

  /** Muda preenchimentos/contornos. Mexer à mão solta o estilo de cor ligado. */
  setPaints(ids: string[], key: 'fills' | 'strokes', fn: (list: unknown[]) => unknown[], merge?: string): void {
    const slot: StyleSlot = key === 'fills' ? 'fill' : 'stroke';
    this.setEach(ids, (n) => ({ [key]: fn(clone((n[key] as unknown[]) ?? [])), ...(n.styles?.[slot] ? detachPatch(n, slot) : {}) }), 'Editar aparência', merge);
  }

  addFill(ids = this.selection): void {
    this.setPaints(ids, 'fills', (l) => [...l, { type: 'solid', color: '#d9d4ca' } satisfies Paint]);
  }
}

let internalClipboard = '';

function centerOrigin(size?: { width: number; height: number }) {
  return { x: (size?.width ?? 1000) / 2 - 200, y: (size?.height ?? 700) / 2 - 200 };
}

/** Operação booleana vista como o caminho resultante (para desenhar, clicar e exportar SVG). */
function booleanAsPath(n: ContainerNode, d: string, fillRule: PathNode['fillRule']): PathNode {
  const { children: _c, booleanOp: _b, layout: _l, clip: _k, grids: _g, ...rest } = n;
  return { ...rest, type: 'path', d, fillRule } as PathNode;
}

function missingComponent(n: InstanceNode): ContainerNode {
  return {
    ...n,
    type: 'frame',
    fills: [{ type: 'solid', color: '#f3dede' }],
    strokes: [{ paint: { type: 'solid', color: '#c0392b' }, width: 1, align: 'inside', dash: [4, 3] }],
    children: [],
  } as ContainerNode;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function imageSize(mime: string, data: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 100, height: img.naturalHeight || 100 });
    img.onerror = () => resolve(null);
    img.src = `data:${mime};base64,${data}`;
  });
}
