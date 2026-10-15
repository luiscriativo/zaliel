// Operações: a única forma de mudar um documento. Cada uma, ao ser aplicada,
// devolve a sua inversa — é isso que dá desfazer/refazer e que outras
// ferramentas podem usar para editar o arquivo.
import type { Asset, Page, SceneNode, ZalDocument } from './types';
import { DocIndex, ROOT } from './document';
import { clone } from './util';

export type Op =
  | { op: 'set'; id: string; key: string; value: unknown }
  | { op: 'insert'; parent: string; index: number; node: SceneNode | Page }
  | { op: 'remove'; id: string }
  | { op: 'move'; id: string; parent: string; index: number }
  | { op: 'doc'; key: 'name' | 'variables' | 'libraries' | 'settings' | 'meta'; value: unknown }
  | { op: 'asset'; key: string; value: Asset | undefined };

function getPath(obj: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}

export class OpError extends Error {}

/** Aplica a operação no documento (mutável) e devolve a inversa. */
export function applyOp(doc: ZalDocument, index: DocIndex, op: Op): Op {
  switch (op.op) {
    case 'set': {
      const node = index.any(op.id) as unknown as Record<string, unknown> | undefined;
      if (!node) throw new OpError(`Nó ${op.id} não existe`);
      if (op.key === 'id' || op.key === 'children' || op.key === 'type') throw new OpError(`Não é permitido alterar ${op.key}`);
      const path = op.key.split('.');
      const old = clone(getPath(node, path));
      setPath(node, path, clone(op.value));
      return { op: 'set', id: op.id, key: op.key, value: old };
    }
    case 'insert': {
      const list = index.siblings(op.parent);
      if (!list) throw new OpError(`Destino ${op.parent} não aceita filhos`);
      if (index.map.has(op.node.id)) throw new OpError(`Id duplicado ${op.node.id}`);
      const node = clone(op.node);
      const i = Math.max(0, Math.min(op.index, list.length));
      (list as unknown[]).splice(i, 0, node);
      if (op.parent === ROOT) {
        const page = node as Page;
        index.map.set(page.id, { node: page, parent: ROOT, page: page.id });
        index.addTree(page.children, page.id, page.id);
      } else {
        const page = index.pageOf(op.parent)!;
        index.addTree([node as SceneNode], op.parent, page);
      }
      return { op: 'remove', id: node.id };
    }
    case 'remove': {
      const parent = index.parentId(op.id);
      if (parent === undefined) throw new OpError(`Nó ${op.id} não existe`);
      const list = index.siblings(parent)!;
      const i = list.findIndex((n) => n.id === op.id);
      const [node] = (list as unknown[]).splice(i, 1) as (SceneNode | Page)[];
      if (parent === ROOT) {
        if (doc.pages.length === 0) {
          (list as unknown[]).splice(i, 0, node);
          throw new OpError('O documento precisa de pelo menos uma página');
        }
        index.map.delete(node.id);
        for (const c of (node as Page).children) index.removeTree(c);
      } else index.removeTree(node as SceneNode);
      return { op: 'insert', parent, index: i, node: clone(node) };
    }
    case 'move': {
      const from = index.parentId(op.id);
      if (from === undefined || (from === ROOT) !== (op.parent === ROOT)) throw new OpError(`Não dá para mover ${op.id}`);
      if (op.parent !== ROOT && (op.parent === op.id || index.isAncestor(op.id, op.parent))) throw new OpError('Não dá para mover um nó para dentro dele mesmo');
      const src = index.siblings(from)!;
      const dst = index.siblings(op.parent);
      if (!dst) throw new OpError(`Destino ${op.parent} não aceita filhos`);
      const i = src.findIndex((n) => n.id === op.id);
      const [node] = (src as unknown[]).splice(i, 1) as SceneNode[];
      const j = Math.max(0, Math.min(op.index, dst.length));
      (dst as unknown[]).splice(j, 0, node);
      if (op.parent !== ROOT) {
        index.removeTree(node);
        index.addTree([node], op.parent, index.pageOf(op.parent)!);
      }
      return { op: 'move', id: op.id, parent: from, index: i };
    }
    case 'doc': {
      const d = doc as unknown as Record<string, unknown>;
      const old = clone(d[op.key]);
      if (op.value === undefined) delete d[op.key];
      else d[op.key] = clone(op.value);
      return { op: 'doc', key: op.key, value: old };
    }
    case 'asset': {
      const old = doc.assets[op.key];
      if (op.value === undefined) delete doc.assets[op.key];
      else doc.assets[op.key] = op.value;
      return { op: 'asset', key: op.key, value: old };
    }
  }
}
