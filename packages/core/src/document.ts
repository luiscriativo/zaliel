import {
  FORMAT_VERSION,
  type ContainerNode,
  type Page,
  type SceneNode,
  type TextNode,
  type ZalDocument,
  type NodeType,
  type ShapeNode,
  type InstanceNode,
  type PathNode,
} from './types';
import { IDENTITY, multiply, nodeMatrix, uid, type Mat } from './util';

export const ROOT = '__root__';

export function createPage(name = 'Página 1'): Page {
  return { id: uid(), name, background: '#f4f2ee', children: [] };
}

export function createDocument(name = 'Sem título'): ZalDocument {
  const page = createPage();
  return {
    format: 'zaliel',
    version: FORMAT_VERSION,
    id: uid(16),
    name,
    pages: [page],
    variables: [],
    libraries: [],
    assets: {},
    settings: { currentPage: page.id },
  };
}

export const DEFAULT_FONT = 'Inter';

const NAMES: Record<NodeType, string> = {
  frame: 'Frame',
  group: 'Grupo',
  rect: 'Retângulo',
  ellipse: 'Elipse',
  line: 'Linha',
  polygon: 'Polígono',
  star: 'Estrela',
  path: 'Vetor',
  text: 'Texto',
  component: 'Componente',
  instance: 'Instância',
};

export function defaultName(type: NodeType): string {
  return NAMES[type];
}

type Geometry = { x: number; y: number; width: number; height: number };

export function createNode(type: 'frame' | 'group' | 'component', g: Geometry, extra?: Partial<ContainerNode>): ContainerNode;
export function createNode(type: 'rect' | 'ellipse' | 'line' | 'polygon' | 'star', g: Geometry, extra?: Partial<ShapeNode>): ShapeNode;
export function createNode(type: 'text', g: Geometry, extra?: Partial<TextNode>): TextNode;
export function createNode(type: 'path', g: Geometry, extra?: Partial<PathNode>): PathNode;
export function createNode(type: 'instance', g: Geometry, extra: Partial<InstanceNode> & { componentId: string }): InstanceNode;
export function createNode(type: NodeType, g: Geometry, extra: Record<string, unknown> = {}): SceneNode {
  const base = { id: uid(), type, name: defaultName(type), ...g };
  switch (type) {
    case 'frame':
    case 'component':
      return { ...base, type, fills: [{ type: 'solid', color: '#ffffff' }], clip: true, children: [], ...extra } as ContainerNode;
    case 'group':
      return { ...base, type, children: [], ...extra } as ContainerNode;
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'star':
      return {
        ...base,
        type,
        fills: [{ type: 'solid', color: '#d9d4ca' }],
        ...(type === 'polygon' ? { points: 3 } : {}),
        ...(type === 'star' ? { points: 5, innerRadius: 0.38 } : {}),
        ...extra,
      } as ShapeNode;
    case 'line':
      return { ...base, type, height: 0, strokes: [{ paint: { type: 'solid', color: '#1d1c1a' }, width: 1, align: 'center' }], ...extra } as ShapeNode;
    case 'path':
      return { ...base, type, d: '', strokes: [{ paint: { type: 'solid', color: '#1d1c1a' }, width: 1, align: 'center' }], ...extra } as PathNode;
    case 'text':
      return {
        ...base,
        type,
        text: 'Texto',
        autoResize: 'width',
        fills: [{ type: 'solid', color: '#1d1c1a' }],
        style: { family: DEFAULT_FONT, weight: 400, size: 16, lineHeight: 'auto', letterSpacing: 0, align: 'left' },
        ...extra,
      } as TextNode;
    case 'instance':
      return { ...base, type, ...extra } as InstanceNode;
  }
}

export function isContainer(n: SceneNode | Page | undefined): n is ContainerNode {
  return !!n && 'children' in n && (n as SceneNode).type !== undefined;
}

export function childrenOf(n: SceneNode | Page | undefined): SceneNode[] | undefined {
  return n && 'children' in n ? n.children : undefined;
}

// ── Índice: id → nó, id → pai ────────────────────────────────────────────────

export interface IndexEntry {
  node: SceneNode | Page;
  parent: string; // id do pai (ROOT para páginas)
  page: string; // id da página
}

export class DocIndex {
  map = new Map<string, IndexEntry>();
  constructor(public doc: ZalDocument) {
    this.rebuild();
  }

  rebuild(): void {
    this.map.clear();
    for (const page of this.doc.pages) {
      this.map.set(page.id, { node: page, parent: ROOT, page: page.id });
      this.addTree(page.children, page.id, page.id);
    }
  }

  addTree(nodes: SceneNode[], parent: string, page: string): void {
    for (const n of nodes) {
      this.map.set(n.id, { node: n, parent, page });
      if ('children' in n) this.addTree(n.children, n.id, page);
    }
  }

  removeTree(n: SceneNode): void {
    this.map.delete(n.id);
    if ('children' in n) for (const c of n.children) this.removeTree(c);
  }

  get(id: string): SceneNode | undefined {
    const e = this.map.get(id);
    return e && 'type' in e.node ? (e.node as SceneNode) : undefined;
  }

  page(id: string): Page | undefined {
    const e = this.map.get(id);
    return e && e.parent === ROOT ? (e.node as Page) : undefined;
  }

  any(id: string): SceneNode | Page | undefined {
    return this.map.get(id)?.node;
  }

  parentId(id: string): string | undefined {
    return this.map.get(id)?.parent;
  }

  pageOf(id: string): string | undefined {
    return this.map.get(id)?.page;
  }

  /** Lista de filhos do pai (ou as páginas, para ROOT). */
  siblings(parentId: string): (SceneNode | Page)[] | undefined {
    if (parentId === ROOT) return this.doc.pages;
    return childrenOf(this.any(parentId));
  }

  /** Cadeia de ancestrais (mais próximo primeiro), sem a página. */
  ancestors(id: string): SceneNode[] {
    const out: SceneNode[] = [];
    let p = this.parentId(id);
    while (p && p !== ROOT) {
      const n = this.get(p);
      if (!n) break;
      out.push(n);
      p = this.parentId(p);
    }
    return out;
  }

  isAncestor(ancestor: string, id: string): boolean {
    let p = this.parentId(id);
    while (p && p !== ROOT) {
      if (p === ancestor) return true;
      p = this.parentId(p);
    }
    return false;
  }

  /** Matriz do espaço local do nó para o espaço da página. */
  worldMatrix(id: string): Mat {
    const chain = [this.get(id), ...this.ancestors(id)].filter(Boolean) as SceneNode[];
    let m: Mat = IDENTITY;
    for (let i = chain.length - 1; i >= 0; i--) m = multiply(m, nodeMatrix(chain[i]));
    return m;
  }

  /** Matriz do espaço do pai para o espaço da página. */
  parentMatrix(id: string): Mat {
    const p = this.parentId(id);
    return p && this.get(p) ? this.worldMatrix(p) : IDENTITY;
  }

  /** Componentes do próprio arquivo (em qualquer página). */
  components(): ContainerNode[] {
    const out: ContainerNode[] = [];
    for (const e of this.map.values()) if ('type' in e.node && e.node.type === 'component') out.push(e.node as ContainerNode);
    return out;
  }
}

export function walk(nodes: SceneNode[], fn: (n: SceneNode, parent: SceneNode | null) => void | false, parent: SceneNode | null = null): void {
  for (const n of nodes) {
    if (fn(n, parent) === false) continue;
    if ('children' in n) walk(n.children, fn, n);
  }
}

/** Copia uma árvore trocando todos os ids (para duplicar/colar). Devolve o mapa antigo→novo. */
export function reidentify<T extends SceneNode>(node: T, map = new Map<string, string>()): T {
  const copy = JSON.parse(JSON.stringify(node)) as T;
  const visit = (n: SceneNode) => {
    const id = uid();
    map.set(n.id, id);
    n.id = id;
    if ('children' in n) n.children.forEach(visit);
  };
  visit(copy);
  return copy;
}
