// Auto layout (flexbox simplificado), ajuste de grupos,
// medida de textos e constraints. Tudo puro: recebe nós e devolve as mudanças.
import type { ContainerNode, InstanceNode, SceneNode, TextNode } from './types';
import { boundsOf, nodeMatrix, apply, rectCorners } from './util';

export interface Change {
  id: string;
  key: string;
  old: unknown;
  value: unknown;
}

/** Mede um texto: largura máxima (Infinity = sem quebra) → tamanho final. */
export type MeasureText = (node: TextNode, maxWidth: number) => { width: number; height: number };

export interface LayoutContext {
  measureText?: MeasureText;
  /** Tamanho de uma instância que abraça o conteúdo (null = vale o tamanho gravado). */
  measureInstance?: (n: InstanceNode) => { width: number; height: number } | null;
  changes: Change[];
}

const EPS = 0.001;

function set(ctx: LayoutContext, node: SceneNode, key: 'x' | 'y' | 'width' | 'height' | 'rotation', value: number) {
  const v = Math.round(value * 100) / 100;
  if (Math.abs((node[key] ?? 0) - v) < EPS) return;
  ctx.changes.push({ id: node.id, key, old: node[key], value: v });
  node[key] = v;
}

/** Texto cuja largura passou a ser definida pelo layout deixa de crescer na horizontal. */
function fixTextWidth(ctx: LayoutContext, t: TextNode) {
  if (t.autoResize !== 'width') return;
  ctx.changes.push({ id: t.id, key: 'autoResize', old: 'width', value: 'height' });
  t.autoResize = 'height';
}

export function measureTextNode(n: TextNode, ctx: LayoutContext): void {
  if (!ctx.measureText || n.autoResize === 'none') return;
  if (n.autoResize === 'width') {
    const s = ctx.measureText(n, Infinity);
    set(ctx, n, 'width', s.width);
    set(ctx, n, 'height', s.height);
  } else {
    const s = ctx.measureText(n, n.width);
    set(ctx, n, 'height', s.height);
  }
}

function isFlow(c: SceneNode) {
  return c.visible !== false && !c.absolute;
}

function sizingOf(c: SceneNode, horiz: boolean) {
  return (horiz ? c.sizing?.horizontal : c.sizing?.vertical) ?? 'fixed';
}

/**
 * Faz o layout de um nó e de toda a subárvore.
 * `lockW`/`lockH`: o pai já decidiu este eixo (fill), então "hug" não vale nele.
 */
export function layoutNode(n: SceneNode, ctx: LayoutContext, lockW = false, lockH = false): void {
  if (n.type === 'text') {
    measureTextNode(n, ctx);
    return;
  }
  if (n.type === 'instance') {
    const s = ctx.measureInstance?.(n);
    if (s) {
      if (!lockW) set(ctx, n, 'width', s.width);
      if (!lockH) set(ctx, n, 'height', s.height);
    }
    return;
  }
  if (!('children' in n)) return;
  for (const c of n.children) layoutNode(c, ctx);
  if (n.type === 'group' || n.type === 'boolean') {
    fitGroup(n, ctx);
    return;
  }
  if (!n.layout) return;
  arrange(n, ctx, lockW, lockH);
}

function arrange(n: ContainerNode, ctx: LayoutContext, lockW: boolean, lockH: boolean): void {
  const L = n.layout!;
  const horiz = L.direction === 'horizontal';
  const [pt, pr, pb, pl] = L.padding;
  const padMain = horiz ? pl + pr : pt + pb;
  const padCross = horiz ? pt + pb : pl + pr;
  const kids = n.children.filter(isFlow);
  const M = horiz ? 'width' : 'height';
  const C = horiz ? 'height' : 'width';
  const P = horiz ? 'x' : 'y';
  const Q = horiz ? 'y' : 'x';
  const selfMain = sizingOf(n, horiz);
  const selfCross = sizingOf(n, !horiz);
  const mainLocked = horiz ? lockW : lockH;
  const crossLocked = horiz ? lockH : lockW;
  const hugMain = selfMain === 'hug' && !mainLocked;
  const hugCross = selfCross === 'hug' && !crossLocked;

  const resized = new Set<SceneNode>();
  const resize = (c: SceneNode, key: 'width' | 'height', v: number) => {
    const before = c[key];
    set(ctx, c, key, Math.max(0, v));
    if (Math.abs(before - c[key]) > EPS) resized.add(c);
  };

  // Linhas (com wrap, só no eixo horizontal faz sentido; sem wrap é uma linha só)
  const lines: SceneNode[][] = [];
  if (L.wrap && horiz && !hugMain) {
    const limit = n[M] - padMain;
    let line: SceneNode[] = [];
    let used = 0;
    for (const c of kids) {
      const w = c[M];
      if (line.length && used + L.gap + w > limit + EPS) {
        lines.push(line);
        line = [];
        used = 0;
      }
      used += (line.length ? L.gap : 0) + w;
      line.push(c);
    }
    if (line.length) lines.push(line);
  } else lines.push(kids);

  // Eixo principal: tamanho dos "fill" e do próprio container quando "hug"
  if (hugMain) {
    const total = kids.reduce((s, c) => s + c[M], 0) + L.gap * Math.max(0, kids.length - 1);
    set(ctx, n, M, total + padMain);
  } else {
    for (const line of lines) {
      const fills = line.filter((c) => sizingOf(c, horiz) === 'fill');
      if (!fills.length) continue;
      const fixed = line.filter((c) => sizingOf(c, horiz) !== 'fill').reduce((s, c) => s + c[M], 0);
      const free = n[M] - padMain - fixed - L.gap * Math.max(0, line.length - 1);
      for (const c of fills) resize(c, M, free / fills.length);
    }
  }

  // Textos com largura definida pelo pai precisam medir a altura de novo
  for (const c of resized) if (c.type === 'text' && c.autoResize !== 'none' && M === 'width') {
    fixTextWidth(ctx, c);
    measureTextNode(c, ctx);
  }

  // Eixo cruzado
  // linhas só com filhos que esticam não definem tamanho: mantêm o tamanho atual do container
  const current = n[C] - padCross;
  const measureLines = () => lines.map((line) => {
    const sized = line.filter((c) => sizingOf(c, !horiz) !== 'fill' && L.align !== 'stretch');
    return sized.length ? Math.max(0, ...sized.map((c) => c[C])) : lines.length === 1 ? Math.max(0, current) : Math.max(0, ...line.map((c) => c[C]));
  });
  let lineCross = measureLines();
  const hugCrossSize = () => {
    const crossGap = L.crossGap ?? L.gap;
    const content = lineCross.reduce((s, v) => s + v, 0) + crossGap * Math.max(0, lines.length - 1);
    set(ctx, n, C, content + padCross);
  };
  if (hugCross) hugCrossSize();
  const crossSpace = n[C] - padCross;
  for (const [li, line] of lines.entries()) {
    const lineSize = lines.length > 1 ? lineCross[li] : crossSpace;
    for (const c of line) {
      if (sizingOf(c, !horiz) === 'fill' || L.align === 'stretch') resize(c, C, lineSize);
    }
  }
  for (const c of resized) if (c.type === 'text' && C === 'width' && c.autoResize !== 'none') {
    fixTextWidth(ctx, c);
    measureTextNode(c, ctx);
  }

  // Filhos que mudaram de tamanho refazem o próprio layout com o eixo travado
  for (const c of resized) if ('children' in c && (c.layout || c.type === 'group' || c.type === 'boolean')) {
    const fillW = sizingOf(c, true) === 'fill' || (!horiz && L.align === 'stretch');
    const fillH = sizingOf(c, false) === 'fill' || (horiz && L.align === 'stretch');
    layoutNode(c, ctx, fillW, fillH);
  }

  // Quem refez o layout pode ter mudado no outro eixo (um texto ou um wrap que quebra diferente na
  // largura nova): o tamanho que abraça o conteúdo é medido de novo
  if (resized.size) {
    if (hugMain) set(ctx, n, M, kids.reduce((s, c) => s + c[M], 0) + L.gap * Math.max(0, kids.length - 1) + padMain);
    if (hugCross) {
      lineCross = measureLines();
      hugCrossSize();
    }
  }

  // Posições
  const crossGap = L.crossGap ?? L.gap;
  let crossCursor = horiz ? pt : pl;
  for (const [li, line] of lines.entries()) {
    const total = line.reduce((s, c) => s + c[M], 0);
    const space = n[M] - padMain;
    let gap = L.gap;
    let cursor = horiz ? pl : pt;
    if (L.justify === 'space-between' && line.length > 1) gap = Math.max(0, (space - total) / (line.length - 1));
    else {
      const used = total + L.gap * Math.max(0, line.length - 1);
      if (L.justify === 'center') cursor += (space - used) / 2;
      else if (L.justify === 'end') cursor += space - used;
    }
    const lineSize = lines.length > 1 ? lineCross[li] : n[C] - padCross;
    for (const c of line) {
      set(ctx, c, P, cursor);
      let q = crossCursor;
      if (L.align === 'center') q += (lineSize - c[C]) / 2;
      else if (L.align === 'end') q += lineSize - c[C];
      set(ctx, c, Q, q);
      if (c.rotation) set(ctx, c, 'rotation', 0);
      cursor += c[M] + gap;
    }
    crossCursor += lineSize + crossGap;
  }
}

/** Grupo (e operação booleana): a caixa sempre envolve os filhos. Move o grupo e compensa os filhos. */
export function fitGroup(g: ContainerNode, ctx: LayoutContext): void {
  const visible = g.children;
  if (!visible.length) return;
  const b = boundsOf(visible.flatMap((c) => rectCorners({ x: 0, y: 0, width: c.width, height: c.height }).map((p) => apply(nodeMatrix(c), p))));
  if (Math.abs(b.x) < EPS && Math.abs(b.y) < EPS && Math.abs(b.width - g.width) < EPS && Math.abs(b.height - g.height) < EPS) return;
  for (const c of g.children) {
    set(ctx, c, 'x', c.x - b.x);
    set(ctx, c, 'y', c.y - b.y);
  }
  set(ctx, g, 'x', g.x + b.x);
  set(ctx, g, 'y', g.y + b.y);
  set(ctx, g, 'width', b.width);
  set(ctx, g, 'height', b.height);
}

/** Constraints: reposiciona os filhos de um frame (sem auto layout) que mudou de tamanho. */
export function applyConstraints(frame: ContainerNode, oldW: number, oldH: number, ctx: LayoutContext): void {
  const dw = frame.width - oldW;
  const dh = frame.height - oldH;
  if (!dw && !dh) return;
  for (const c of frame.children) {
    if (frame.layout && !c.absolute) continue; // em auto layout só os absolutos seguem constraints
    const h = c.constraints?.horizontal ?? 'left';
    const v = c.constraints?.vertical ?? 'top';
    if (h === 'right') set(ctx, c, 'x', c.x + dw);
    else if (h === 'center') set(ctx, c, 'x', c.x + dw / 2);
    else if (h === 'left-right') set(ctx, c, 'width', c.width + dw);
    else if (h === 'scale' && oldW) {
      const k = frame.width / oldW;
      set(ctx, c, 'x', c.x * k);
      set(ctx, c, 'width', c.width * k);
    }
    if (v === 'bottom') set(ctx, c, 'y', c.y + dh);
    else if (v === 'center') set(ctx, c, 'y', c.y + dh / 2);
    else if (v === 'top-bottom') set(ctx, c, 'height', c.height + dh);
    else if (v === 'scale' && oldH) {
      const k = frame.height / oldH;
      set(ctx, c, 'y', c.y * k);
      set(ctx, c, 'height', c.height * k);
    }
  }
}
