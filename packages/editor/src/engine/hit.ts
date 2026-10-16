// Descobrir o que está embaixo do cursor (respeitando rotação, clip e instâncias).
import { apply, invert, multiply, nodeMatrix, rectsIntersect, IDENTITY, type Mat, type Point, type Rect, type SceneNode } from '@zaliel/core';
import type { Editor } from '../editor';

/** Caminho de ids do nó mais externo até o mais interno que contém o ponto. */
export function hitPath(editor: Editor, p: Point, tolerance: number): string[] {
  const visit = (list: SceneNode[], parentM: Mat): string[] | null => {
    for (let i = list.length - 1; i >= 0; i--) {
      const raw = list[i];
      if (raw.visible === false || raw.locked) continue;
      if (editor.editingText === raw.id) continue;
      const n = editor.resolve(raw);
      const m = multiply(parentM, nodeMatrix(n));
      const local = apply(invert(m), p);
      const inside = local.x >= -tolerance && local.y >= -tolerance && local.x <= n.width + tolerance && local.y <= n.height + tolerance;
      // operação booleana aparece como um caminho só, mas as formas de dentro continuam clicáveis
      const kids = raw.type === 'boolean' ? raw.children : 'children' in n ? n.children : [];
      if (kids.length) {
        const clips = 'children' in n && n.type !== 'group' && n.clip;
        if (!clips || inside) {
          const sub = visit(kids, m);
          if (sub) return [n.id, ...sub];
        }
      }
      if (n.type === 'group') continue;
      if (!inside) continue;
      if (n.type === 'ellipse') {
        const rx = n.width / 2, ry = n.height / 2;
        const dx = (local.x - rx) / (rx + tolerance), dy = (local.y - ry) / (ry + tolerance);
        if (dx * dx + dy * dy > 1) continue;
      }
      if (n.type === 'line') {
        // distância ao segmento (0,0)-(w,h)
        const len2 = n.width * n.width + n.height * n.height || 1;
        const t = Math.max(0, Math.min(1, (local.x * n.width + local.y * n.height) / len2));
        const d = Math.hypot(local.x - t * n.width, local.y - t * n.height);
        if (d > tolerance + 3 / editor.viewport.zoom) continue;
      }
      return [n.id];
    }
    return null;
  };
  return visit(editor.page.children, IDENTITY) ?? [];
}

/**
 * Escolhe o que um clique seleciona:
 * filhos diretos de frames do topo; grupos e instâncias inteiros; mantém o nível da seleção atual.
 */
export function pickTarget(editor: Editor, p: Point, deep: boolean): string | null {
  const tol = 2 / editor.viewport.zoom;
  let path = hitPath(editor, p, tol);
  if (!path.length) return null;
  // nós de dentro de instâncias não são selecionáveis por clique (edite pelo painel ou duplo clique)
  const firstInner = path.findIndex((id) => editor.isInner(id));
  if (firstInner > 0) path = path.slice(0, firstInner);
  if (deep) return path[path.length - 1];

  const idx = editor.model.index;
  // contexto atual: o pai da seleção (ou o grupo aberto com duplo clique)
  const contexts = [editor.scope, ...editor.selection.map((id) => idx.parentId(id))].filter(Boolean) as string[];
  for (const ctx of contexts) {
    const i = path.indexOf(ctx);
    if (i >= 0 && i + 1 < path.length) return path[i + 1];
  }
  const top = idx.get(path[0]);
  const target = top && (top.type === 'frame' || top.type === 'component' || top.type === 'component-set') && path.length > 1 ? path[1] : path[0];
  // um nó já selecionado mais fundo que o alvo continua clicável (para arrastar)
  const ti = path.indexOf(target);
  for (const id of editor.selection) if (path.indexOf(id) > ti) return id;
  return target;
}

/** Ao dar duplo clique: o próximo nível dentro do selecionado. */
export function pickInside(editor: Editor, p: Point, containerId: string): string | null {
  const path = hitPath(editor, p, 2 / editor.viewport.zoom);
  const i = path.indexOf(containerId);
  return i >= 0 && i + 1 < path.length ? path[i + 1] : null;
}

/** Seleção por retângulo: nós do nível de `parentId` que encostam no retângulo. */
export function marqueeSelect(editor: Editor, r: Rect, parentId: string): string[] {
  const list = (editor.model.index.siblings(parentId) ?? []) as SceneNode[];
  return list.filter((n) => n.visible !== false && !n.locked && rectsIntersect(editor.worldBounds(n.id), r)).map((n) => n.id);
}
