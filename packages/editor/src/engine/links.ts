// Ligações do protótipo no canvas: a curva de cada ligação, a alça de onde se puxa uma nova e o
// alvo sob o cursor. O desenho (overlay) e o mouse (interaction) usam as mesmas contas.
import { prototypeLinks, screens, screenOf, type Interaction, type Point, type Rect } from '@zaliel/core';
import type { Editor } from '../editor';

export interface LinkCurve {
  from: string;
  to: string;
  interaction: Interaction;
  a: Point;
  e: Point;
  c1: Point;
  c2: Point;
  /** A seta aponta para a direita (destino à direita da origem). */
  forward: boolean;
}

/** Raio (px de tela) para pegar a alça, a ponta da seta ou a curva. */
export const LINK_HIT = 9;

/** Caixa de um nó em px de tela. */
export function screenRect(ed: Editor, id: string): Rect | null {
  if (!ed.model.index.get(id)) return null;
  const b = ed.worldBounds(id);
  const a = ed.worldToScreen({ x: b.x, y: b.y });
  return { x: a.x, y: a.y, width: b.width * ed.viewport.zoom, height: b.height * ed.viewport.zoom };
}

/** Onde fica a alça de ligação de uma camada: no meio da borda direita. */
export function handlePoint(ed: Editor, id: string): Point | null {
  const r = screenRect(ed, id);
  return r ? { x: r.x + r.width, y: r.y + r.height / 2 } : null;
}

/** Curva da origem até uma tela de destino (ou até um ponto solto, enquanto arrasta). */
export function curve(fromB: Rect, to: Rect | Point): Omit<LinkCurve, 'from' | 'to' | 'interaction'> {
  const isRect = 'width' in to;
  const cx = isRect ? to.x + to.width / 2 : to.x;
  const forward = cx >= fromB.x + fromB.width / 2;
  const a = { x: forward ? fromB.x + fromB.width : fromB.x, y: fromB.y + fromB.height / 2 };
  const e = isRect ? { x: forward ? to.x : to.x + to.width, y: to.y + Math.min(to.height / 2, 60) } : { x: to.x, y: to.y };
  const dx = Math.max(40, Math.abs(e.x - a.x) / 2) * (forward ? 1 : -1);
  return { a, e, c1: { x: a.x + dx, y: a.y }, c2: { x: e.x - dx, y: e.y }, forward };
}

/** Todas as ligações da página, em px de tela. */
export function linkCurves(ed: Editor): LinkCurve[] {
  const out: LinkCurve[] = [];
  for (const link of prototypeLinks(ed.page)) {
    const fromB = screenRect(ed, link.from), toB = screenRect(ed, link.to);
    if (!fromB || !toB) continue;
    out.push({ from: link.from, to: link.to, interaction: link.interaction, ...curve(fromB, toB) });
  }
  return out;
}

function bezier(c: Pick<LinkCurve, 'a' | 'c1' | 'c2' | 'e'>, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * c.a.x + 3 * u * u * t * c.c1.x + 3 * u * t * t * c.c2.x + t * t * t * c.e.x,
    y: u * u * u * c.a.y + 3 * u * u * t * c.c1.y + 3 * u * t * t * c.c2.y + t * t * t * c.e.y,
  };
}

/** Distância (px de tela) de um ponto até a curva. */
export function distanceToCurve(c: Pick<LinkCurve, 'a' | 'c1' | 'c2' | 'e'>, p: Point): number {
  let best = Infinity;
  let prev = c.a;
  for (let i = 1; i <= 40; i++) {
    const q = bezier(c, i / 40);
    const dx = q.x - prev.x, dy = q.y - prev.y;
    const len = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - prev.x) * dx + (p.y - prev.y) * dy) / len));
    best = Math.min(best, Math.hypot(p.x - (prev.x + t * dx), p.y - (prev.y + t * dy)));
    prev = q;
  }
  return best;
}

/** Tela (frame do topo) sob um ponto da página que pode receber a ligação (não a tela da própria origem). */
export function linkTargetAt(ed: Editor, w: Point, from: string): string | null {
  const own = screenOf(ed.page, from, (id) => ed.model.index.parentId(id))?.id;
  const list = screens(ed.page);
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (s.id === own || s.id === from) continue;
    const b = ed.worldBounds(s.id);
    if (w.x >= b.x && w.x <= b.x + b.width && w.y >= b.y && w.y <= b.y + b.height) return s.id;
  }
  return null;
}
