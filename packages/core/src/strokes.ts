// Contornos com espessura por lado (como border-top/right/bottom/left do CSS).
// A geometria fica aqui para o renderizador e a exportação SVG desenharem igual.
import type { SceneNode, Stroke, StrokeSides } from './types';

/** Tipos de nó que aceitam espessura por lado (os que têm caixa retangular). */
const BOXES = new Set(['frame', 'rect', 'component', 'component-set', 'instance']);

export function acceptsStrokeSides(n: Pick<SceneNode, 'type'>): boolean {
  return BOXES.has(n.type);
}

/** Lados do contorno, ou null quando ele é uniforme (sem `sides` ou com os 4 lados iguais à espessura). */
export function strokeSides(s: Stroke): StrokeSides | null {
  const d = s.sides;
  if (!d) return null;
  if (d.top === s.width && d.right === s.width && d.bottom === s.width && d.left === s.width) return null;
  return d;
}

/** Espessura máxima do contorno (para folgas de desenho e seleção). */
export function strokeWeight(s: Stroke): number {
  const d = s.sides;
  return d ? Math.max(d.top, d.right, d.bottom, d.left) : s.width;
}

/** Lados normalizados: números finitos e não negativos; o que faltar vale 0. */
export function normalizeSides(v: unknown): StrokeSides | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const f = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, x) : 0);
  return { top: f(o.top), right: f(o.right), bottom: f(o.bottom), left: f(o.left) };
}

type Corner = [number, number]; // raio horizontal, vertical

const fx = (v: number) => String(Math.round(v * 1000) / 1000);

/** Retângulo (x0,y0)-(x1,y1) com cantos elípticos [sup-esq, sup-dir, inf-dir, inf-esq], no sentido horário. */
function boxPath(x0: number, y0: number, x1: number, y1: number, [tl, tr, br, bl]: Corner[]): string {
  // canto reto: o ponto final já é o próprio canto, não precisa de nada
  const arc = (c: Corner, x: number, y: number) => (c[0] > 0 && c[1] > 0 ? `A${fx(c[0])} ${fx(c[1])} 0 0 1 ${fx(x)} ${fx(y)}` : c[0] > 0 || c[1] > 0 ? `L${fx(x)} ${fx(y)}` : '');
  return (
    `M${fx(x0 + tl[0])} ${fx(y0)}` +
    `L${fx(x1 - tr[0])} ${fx(y0)}${arc(tr, x1, y0 + tr[1])}` +
    `L${fx(x1)} ${fx(y1 - br[1])}${arc(br, x1 - br[0], y1)}` +
    `L${fx(x0 + bl[0])} ${fx(y1)}${arc(bl, x0, y1 - bl[1])}` +
    `L${fx(x0)} ${fx(y0 + tl[1])}${arc(tl, x0 + tl[0], y0)}Z`
  );
}

/** Raios cabem na caixa: reduz por igual quando a soma de dois cantos passa do lado (como o CSS). */
function fitCorners(w: number, h: number, c: Corner[]): Corner[] {
  if (w <= 0 || h <= 0) return c.map(() => [0, 0] as Corner);
  const k = Math.min(1, w / (c[0][0] + c[1][0] || 1), w / (c[3][0] + c[2][0] || 1), h / (c[0][1] + c[3][1] || 1), h / (c[1][1] + c[2][1] || 1));
  return c.map(([x, y]) => [Math.max(0, x * k), Math.max(0, y * k)] as Corner);
}

/**
 * Caixa deslocada por lado: `k` positivo cresce para fora (k × espessura de cada lado),
 * negativo entra. Os cantos acompanham (raio + deslocamento, sem ficar negativo).
 */
function offsetBox(w: number, h: number, r: [number, number, number, number], d: StrokeSides, k: number) {
  const x0 = -d.left * k, y0 = -d.top * k, x1 = w + d.right * k, y1 = h + d.bottom * k;
  const c = (rad: number, sx: number, sy: number): Corner => (rad > 0 ? [Math.max(0, rad + sx * k), Math.max(0, rad + sy * k)] : [0, 0]);
  const corners = [c(r[0], d.left, d.top), c(r[1], d.right, d.top), c(r[2], d.right, d.bottom), c(r[3], d.left, d.bottom)];
  return { x0, y0, x1, y1, corners: fitCorners(Math.max(0, x1 - x0), Math.max(0, y1 - y0), corners) };
}

export interface SideStrokeGeometry {
  /** Faixa do contorno: borda externa + interna (pintar com regra par-ímpar). */
  ring: string;
  /** Linha central da faixa, para contornos tracejados. */
  center: string;
  /** Uma região por lado com espessura (para recortar o tracejado de cada lado). */
  wedges: { side: keyof StrokeSides; width: number; clip: string }[];
}

/** Geometria de um contorno por lado numa caixa w×h com os raios dados. */
export function sideStrokeGeometry(w: number, h: number, r: [number, number, number, number], d: StrokeSides, align: Stroke['align']): SideStrokeGeometry {
  const ko = align === 'inside' ? 0 : align === 'center' ? 0.5 : 1;
  const ki = 1 - ko;
  const out = offsetBox(w, h, r, d, ko);
  const inn = offsetBox(w, h, r, d, -ki);
  // borda interna invertida não existe: some quando a caixa é menor que as espessuras
  const innerOk = inn.x1 > inn.x0 && inn.y1 > inn.y0;
  const ring = boxPath(out.x0, out.y0, out.x1, out.y1, out.corners) + (innerOk ? boxPath(inn.x0, inn.y0, inn.x1, inn.y1, inn.corners) : '');
  const mid = offsetBox(w, h, r, d, (ko - ki) / 2);
  const center = boxPath(mid.x0, mid.y0, mid.x1, mid.y1, mid.corners);
  // cunhas: do canto externo ao canto interno de cada lado (com folga de 1 px para o antisserrilhado)
  const o = { x0: out.x0 - 1, y0: out.y0 - 1, x1: out.x1 + 1, y1: out.y1 + 1 };
  const i = innerOk ? { x0: inn.x0 + 1, y0: inn.y0 + 1, x1: inn.x1 - 1, y1: inn.y1 - 1 } : { x0: (out.x0 + out.x1) / 2, y0: (out.y0 + out.y1) / 2, x1: (out.x0 + out.x1) / 2, y1: (out.y0 + out.y1) / 2 };
  const poly = (...p: number[]) => `M${fx(p[0])} ${fx(p[1])}L${fx(p[2])} ${fx(p[3])}L${fx(p[4])} ${fx(p[5])}L${fx(p[6])} ${fx(p[7])}Z`;
  const all: SideStrokeGeometry['wedges'] = [
    { side: 'top', width: d.top, clip: poly(o.x0, o.y0, o.x1, o.y0, i.x1, i.y0, i.x0, i.y0) },
    { side: 'right', width: d.right, clip: poly(o.x1, o.y0, o.x1, o.y1, i.x1, i.y1, i.x1, i.y0) },
    { side: 'bottom', width: d.bottom, clip: poly(o.x1, o.y1, o.x0, o.y1, i.x0, i.y1, i.x1, i.y1) },
    { side: 'left', width: d.left, clip: poly(o.x0, o.y1, o.x0, o.y0, i.x0, i.y0, i.x0, i.y1) },
  ];
  return { ring, center, wedges: all.filter((x) => x.width > 0) };
}
