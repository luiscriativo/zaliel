// Grades de layout de frames: colunas, linhas e grade quadrada.
import type { LayoutGrid } from './types';
import type { Rect } from './util';

export function defaultGrid(type: LayoutGrid['type']): LayoutGrid {
  if (type === 'grid') return { type, count: 0, size: 8, gutter: 0, margin: 0, alignment: 'stretch', color: '#d9583b1a' };
  return { type, count: type === 'columns' ? 12 : 4, size: 64, gutter: 20, margin: type === 'columns' ? 24 : 0, alignment: 'stretch', color: type === 'columns' ? '#d9583b1a' : '#3b7bd91a' };
}

/** Faixas (colunas ou linhas) de uma grade, em coordenadas do frame. */
export function gridBands(g: LayoutGrid, width: number, height: number): Rect[] {
  if (g.type === 'grid' || g.count < 1) return [];
  const horiz = g.type === 'columns';
  const span = horiz ? width : height;
  const n = Math.max(1, Math.round(g.count));
  let size: number, start: number;
  if (g.alignment === 'stretch') {
    size = (span - 2 * g.margin - (n - 1) * g.gutter) / n;
    start = g.margin;
  } else {
    size = g.size;
    const total = n * size + (n - 1) * g.gutter;
    start = g.alignment === 'start' ? g.margin : g.alignment === 'end' ? span - g.margin - total : (span - total) / 2;
  }
  if (size <= 0) return [];
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const at = start + i * (size + g.gutter);
    out.push(horiz ? { x: at, y: 0, width: size, height } : { x: 0, y: at, width, height: size });
  }
  return out;
}

/** Linhas de uma grade quadrada (posições em x e em y, sem as bordas). */
export function gridLines(g: LayoutGrid, width: number, height: number): { xs: number[]; ys: number[] } {
  if (g.type !== 'grid' || g.size < 1) return { xs: [], ys: [] };
  const xs: number[] = [], ys: number[] = [];
  for (let x = g.size; x < width; x += g.size) xs.push(x);
  for (let y = g.size; y < height; y += g.size) ys.push(y);
  return { xs, ys };
}

/** Bordas das faixas/linhas visíveis: servem de referência para o encaixe. */
export function gridSnapEdges(grids: LayoutGrid[] | undefined, width: number, height: number): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = [];
  for (const g of grids ?? []) {
    if (g.visible === false) continue;
    if (g.type === 'grid') {
      const l = gridLines(g, width, height);
      xs.push(...l.xs);
      ys.push(...l.ys);
      continue;
    }
    for (const b of gridBands(g, width, height)) {
      if (g.type === 'columns') xs.push(b.x, b.x + b.width);
      else ys.push(b.y, b.y + b.height);
    }
  }
  return { xs, ys };
}
