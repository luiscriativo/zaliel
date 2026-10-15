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
  type ContainerNode,
  type InstanceNode,
  type Op,
  type Page,
  type Rect,
  type SceneNode,
  type ZalDocument,
  type Point,
  type Paint,
  type VariableCollection,
  type Asset,
} from '@zaliel/core';
import type { Platform, Settings } from './platform';
import { DEFAULT_SETTINGS } from './platform';
import type { CanvasHost } from './engine/host';

export type Tool = 'move' | 'hand' | 'frame' | 'rect' | 'ellipse' | 'line' | 'polygon' | 'star' | 'text' | 'pen';
export type Channel = 'doc' | 'selection' | 'view' | 'ui' | 'tool';
export type Dialog = null | 'settings' | 'shortcuts' | 'about' | 'variables' | 'updates';

export interface Toast {
  id: number;
  kind: 'success' | 'info' | 'warn' | 'error';
  text: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

export interface Viewport {
  zoom: number;
  x: number;
  y: number;
}

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
  private listeners = new Map<Channel, Set<() => void>>();
  private versions: Record<Channel, number> = { doc: 0, selection: 0, view: 0, ui: 0, tool: 0 };
  private resolved = new Map<string, SceneNode>();
  private resolvedRev = -1;
  private toastSeq = 0;
  private libraryChanges = new Map<string, string>(); // libId → hash novo disponível
  private unsubscribeModel: (() => void) | null = null;

  constructor(public platform: Platform) {
    this.model = new Model(createDocument());
    this.pageId = this.model.doc.pages[0].id;
    this.attachModel();
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
    this.unsubscribeModel = this.model.subscribe(() => {
      // remove da seleção o que deixou de existir
      const alive = this.selection.filter((id) => this.model.index.get(id) || this.isInner(id));
      if (alive.length !== this.selection.length) {
        this.selection = alive;
        this.emit('selection');
      }
      if (!this.model.index.page(this.pageId)) this.pageId = this.model.doc.pages[0].id;
      this.emit('doc');
      this.syncWindow();
    });
    if (this.host) this.model.measureText = this.host.measureText;
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
    this.platform.setWindowState({ title: name, dirty: !this.home && this.model.dirty, theme: this.theme, path: this.filePath });
  }

  // ── Avisos ─────────────────────────────────────────────────────────────────

  toast(kind: Toast['kind'], text: string, opts: { detail?: string; action?: Toast['action'] } = {}): void {
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

  findComponent = (id: string, library?: string): ContainerNode | undefined =>
    componentFinder(this.doc, () => this.model.index.components())(id, library);

  /** Árvore exibida de um nó (instâncias viram o conteúdo do componente). Em cache por revisão. */
  resolve = (n: SceneNode): SceneNode => {
    if (n.type !== 'instance') return n;
    if (this.resolvedRev !== this.model.revision) {
      this.resolved.clear();
      this.resolvedRev = this.model.revision;
    }
    const key = `${n.id}:${n.width}x${n.height}`;
    let r = this.resolved.get(key);
    if (!r) {
      r = resolveInstance(n, this.findComponent, this.host?.measureText) ?? missingComponent(n);
      this.resolved.set(key, r);
    }
    return r;
  };

  /** Id de um nó dentro de uma instância ("instancia/interno"). */
  isInner(id: string): boolean {
    return id.includes('/');
  }

  // ── Documento ──────────────────────────────────────────────────────────────

  private loadDocument(doc: ZalDocument, path: string | null) {
    this.model = new Model(doc);
    this.filePath = path;
    this.pageId = doc.settings?.currentPage && doc.pages.some((p) => p.id === doc.settings!.currentPage) ? doc.settings.currentPage : doc.pages[0].id;
    this.selection = [];
    this.scope = null;
    this.editingText = null;
    this.home = false;
    this.resolved.clear();
    this.libraryChanges.clear();
    this.host?.resetDocument();
    this.attachModel();
    this.model.refreshLayout();
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
    if (!(await this.confirmDiscard())) return;
    const res = await this.platform.openDialog();
    if (res) {
      if (this.openText(res.text, res.path)) this.toast('success', `“${this.doc.name}” aberto.`);
    }
  }

  /** Pergunta antes de perder alterações. true = pode seguir. */
  async confirmDiscard(): Promise<boolean> {
    if (this.home || !this.model.dirty) return true;
    const ok = window.confirm(`“${this.doc.name}” tem alterações não salvas.\n\nOK para salvar antes de continuar, Cancelar para voltar.`);
    if (!ok) return false;
    return this.save();
  }

  async save(as = false): Promise<boolean> {
    if (this.home) return false;
    try {
      const doc = this.doc;
      doc.settings = { ...doc.settings, currentPage: this.pageId };
      const text = serialize(doc);
      const path = await this.platform.saveFile(as ? null : this.filePath, text, `${doc.name}.zal`);
      if (!path) return false;
      const fileName = path.split(/[\\/]/).pop()!.replace(/\.zal$/i, '');
      if (!this.filePath || as) {
        // o nome do documento acompanha o nome do arquivo
        if (fileName && fileName !== doc.name) doc.name = fileName;
      }
      this.filePath = path;
      this.model.markSaved();
      await this.platform.addRecent(path, doc.name);
      await this.platform.clearRecovery(doc.id);
      this.emit('doc', 'ui');
      this.syncWindow();
      this.toast('success', 'Arquivo salvo.', { detail: path });
      return true;
    } catch (e) {
      this.toast('error', 'Não foi possível salvar.', { detail: friendlyFsError(e), action: { label: 'Salvar como…', run: () => this.save(true) } });
      return false;
    }
  }

  async closeDocument(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    await this.platform.clearRecovery(this.doc.id);
    this.home = true;
    this.model = new Model(createDocument());
    this.attachModel();
    this.filePath = null;
    this.selection = [];
    this.emit('doc', 'selection', 'ui');
    this.syncWindow();
  }

  /** Cópia de segurança periódica (recuperação após falha). */
  async writeRecovery(): Promise<void> {
    if (this.home || !this.model.dirty) return;
    await this.platform.writeRecovery({ id: this.doc.id, name: this.doc.name, path: this.filePath, savedAt: Date.now() }, serialize(this.doc));
  }

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

  setPage(id: string): void {
    if (id === this.pageId || !this.model.index.page(id)) return;
    this.pageId = id;
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
        if (n.type !== 'frame' && n.type !== 'component') continue;
        const local = apply(invert(this.model.index.worldMatrix(n.id)), p);
        if (local.x >= 0 && local.y >= 0 && local.x <= n.width && local.y <= n.height) return visit(n.children) ?? n.id;
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

  /** Embrulha a seleção num grupo/frame/componente. */
  wrap(kind: 'group' | 'frame' | 'component'): void {
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
    const container = createNode(kind === 'group' ? 'group' : kind, { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }, kind === 'group' ? {} : { fills: [], clip: kind === 'frame' ? false : true });
    if (kind === 'component') container.name = this.uniqueComponentName('Componente');
    const ops: Op[] = [{ op: 'insert', parent, index, node: container }];
    ids.forEach((id, i) => {
      const n = this.model.index.get(id)!;
      ops.push({ op: 'move', id, parent: container.id, index: i }, { op: 'set', id, key: 'x', value: n.x - container.x }, { op: 'set', id, key: 'y', value: n.y - container.y });
    });
    const label = kind === 'group' ? 'Agrupar' : kind === 'frame' ? 'Criar frame' : 'Criar componente';
    if (this.run(label, ops, { select: [container.id] }) && kind === 'component') this.toast('success', `Componente “${container.name}” criado.`);
  }

  uniqueComponentName(base: string): string {
    const names = new Set(this.model.index.components().map((c) => c.name));
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
      const frame = detachInstance(inst, this.findComponent, this.host?.measureText);
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
    this.run('Restaurar instância', ids.map((id) => ({ op: 'set', id, key: 'overrides', value: undefined }) as Op));
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
    const main = this.findComponent(componentId, library);
    if (!main) return;
    const c = at ?? this.viewCenter();
    const parent = this.containerAt(c);
    const local = this.toLocal(parent, { x: c.x - (at ? 0 : main.width / 2), y: c.y - (at ? 0 : main.height / 2) });
    const inst = createNode('instance', { x: Math.round(local.x), y: Math.round(local.y), width: main.width, height: main.height }, { componentId, library, name: main.name });
    this.insert(inst, parent, undefined, 'Inserir componente');
  }

  setOverride(instanceId: string, innerId: string, patch: Record<string, unknown>): void {
    const inst = this.model.index.get(instanceId) as InstanceNode | undefined;
    if (!inst || inst.type !== 'instance') return;
    const cur = inst.overrides?.[innerId] ?? {};
    this.run('Editar instância', [{ op: 'set', id: instanceId, key: `overrides.${innerId}`, value: { ...cur, ...patch } }], { merge: `ovr-${instanceId}-${innerId}` });
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
    const n = this.selectedNodes()[0];
    if (!n) return;
    if ((n.type === 'frame' || n.type === 'component') && !n.layout) {
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

  async exportSelection(format: 'png' | 'jpg' | 'webp' | 'svg', scale = 1): Promise<void> {
    const nodes = this.selectedNodes();
    const targets = nodes.length ? nodes : [];
    if (!targets.length) return this.toast('info', 'Selecione o que quer exportar.');
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

  // ── Fills rápidos ──────────────────────────────────────────────────────────

  setPaints(ids: string[], key: 'fills' | 'strokes', fn: (list: unknown[]) => unknown[], merge?: string): void {
    this.setEach(ids, (n) => ({ [key]: fn(clone((n[key] as unknown[]) ?? [])) }), 'Editar aparência', merge);
  }

  addFill(ids = this.selection): void {
    this.setPaints(ids, 'fills', (l) => [...l, { type: 'solid', color: '#d9d4ca' } satisfies Paint]);
  }
}

let internalClipboard = '';

function centerOrigin(size?: { width: number; height: number }) {
  return { x: (size?.width ?? 1000) / 2 - 200, y: (size?.height ?? 700) / 2 - 200 };
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
