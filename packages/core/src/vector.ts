// Edição de pontos de vetores: o caminho SVG (`d`) vira uma lista de pontos com
// alças, que o editor mexe e depois grava de volta como `d`.
import type { PathNode } from './types';
import { apply, boundsOf, nodeMatrix, type Point, type Rect } from './util';

export interface VectorPoint {
  x: number;
  y: number;
  /** Alça de entrada (absoluta, no espaço do nó). */
  in?: Point;
  /** Alça de saída (absoluta, no espaço do nó). */
  out?: Point;
}

export interface Subpath {
  points: VectorPoint[];
  closed: boolean;
}

const INCOMPLETE = new Error('caminho incompleto');

const near = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/**
 * Lê um caminho SVG. Aceita M, L, H, V, C, S, Q, T, A e Z (maiúsculas e minúsculas).
 * Curvas quadráticas e arcos viram cúbicas.
 */
export function parsePath(d: string): Subpath[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: Subpath[] = [];
  let sub: Subpath | null = null;
  let cur = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let lastCtrl: Point | null = null; // para S/T
  let lastCmd = '';
  let i = 0;
  const num = () => {
    const t = tokens[i++];
    if (t === undefined || /^[a-zA-Z]$/.test(t)) throw INCOMPLETE;
    return parseFloat(t);
  };
  const begin = (p: Point) => {
    sub = { points: [{ x: p.x, y: p.y }], closed: false };
    out.push(sub);
  };
  const lineTo = (p: Point) => {
    if (!sub) begin(cur);
    sub!.points.push({ x: p.x, y: p.y });
    cur = p;
  };
  const cubicTo = (c1: Point, c2: Point, p: Point) => {
    if (!sub) begin(cur);
    const pts = sub!.points;
    pts[pts.length - 1].out = c1;
    pts.push({ x: p.x, y: p.y, in: c2 });
    cur = p;
  };

  try {
    while (i < tokens.length) {
      let cmd = tokens[i];
      if (/^[a-zA-Z]$/.test(cmd)) i++;
      else if (lastCmd) cmd = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd; // repetição implícita
      else break;
      const rel = cmd === cmd.toLowerCase();
      const R = (p: Point) => (rel ? { x: cur.x + p.x, y: cur.y + p.y } : p);
      switch (cmd.toUpperCase()) {
        case 'M': {
          const p = R({ x: num(), y: num() });
          begin(p);
          cur = start = p;
          lastCtrl = null;
          break;
        }
        case 'L':
          lineTo(R({ x: num(), y: num() }));
          lastCtrl = null;
          break;
        case 'H':
          lineTo({ x: rel ? cur.x + num() : num(), y: cur.y });
          lastCtrl = null;
          break;
        case 'V':
          lineTo({ x: cur.x, y: rel ? cur.y + num() : num() });
          lastCtrl = null;
          break;
        case 'C': {
          const c1 = R({ x: num(), y: num() }), c2 = R({ x: num(), y: num() }), p = R({ x: num(), y: num() });
          cubicTo(c1, c2, p);
          lastCtrl = c2;
          break;
        }
        case 'S': {
          const c1 = lastCtrl && /[CcSs]/.test(lastCmd) ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
          const c2 = R({ x: num(), y: num() }), p = R({ x: num(), y: num() });
          cubicTo(c1, c2, p);
          lastCtrl = c2;
          break;
        }
        case 'Q':
        case 'T': {
          const q: Point = cmd.toUpperCase() === 'Q' ? R({ x: num(), y: num() }) : lastCtrl && /[QqTt]/.test(lastCmd) ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
          const p = R({ x: num(), y: num() });
          const from = cur;
          cubicTo({ x: from.x + (2 / 3) * (q.x - from.x), y: from.y + (2 / 3) * (q.y - from.y) }, { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p);
          lastCtrl = q;
          break;
        }
        case 'A': {
          const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
          const p = R({ x: num(), y: num() });
          for (const [c1, c2, e] of arcToCubics(cur, p, rx, ry, rot, !!large, !!sweep)) cubicTo(c1, c2, e);
          if (!near(cur, p)) lineTo(p);
          lastCtrl = null;
          break;
        }
        case 'Z':
          if (sub) {
            const s = sub as Subpath;
            s.closed = true;
            // ponto final repetido em cima do inicial: junta os dois
            const pts = s.points;
            if (pts.length > 1 && near(pts[pts.length - 1], pts[0])) {
              const last = pts.pop()!;
              if (last.in) pts[0].in = last.in;
            }
          }
          cur = start;
          sub = null;
          lastCtrl = null;
          break;
        default:
          return out; // comando desconhecido: para por aqui
      }
      lastCmd = cmd;
      if (cmd.toUpperCase() === 'Z') lastCmd = '';
    }
  } catch (e) {
    if (e !== INCOMPLETE) throw e; // caminho cortado no meio de um comando: fica o que já foi lido
  }
  return out.filter((s) => s.points.length > 0);
}

/** Arco elíptico (parâmetros SVG) em cúbicas: [controle1, controle2, fim][]. */
function arcToCubics(p0: Point, p1: Point, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean): [Point, Point, Point][] {
  if (near(p0, p1)) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return [[p0, p1, p1]];
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) k = -k;
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p1.x) / 2, cy = sin * cx1 + cos * cy1 + (p0.y + p1.y) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const out: [Point, Point, Point][] = [];
  const pt = (t: number) => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  const der = (t: number) => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
  for (let s = 0; s < segs; s++) {
    const a = t1 + (dt * s) / segs, b = t1 + (dt * (s + 1)) / segs;
    const alpha = (4 / 3) * Math.tan((b - a) / 4);
    const pa = pt(a), pb = pt(b), da = der(a), db = der(b);
    out.push([{ x: pa.x + alpha * da.x, y: pa.y + alpha * da.y }, { x: pb.x - alpha * db.x, y: pb.y - alpha * db.y }, s === segs - 1 ? p1 : pb]);
  }
  return out;
}

const r = (v: number) => String(Math.round(v * 100) / 100);
const f = (p: Point) => `${r(p.x)} ${r(p.y)}`;

/** Grava os pontos de volta como caminho SVG. */
export function serializePath(subpaths: Subpath[]): string {
  const parts: string[] = [];
  for (const s of subpaths) {
    const pts = s.points;
    if (!pts.length) continue;
    let d = `M${f(pts[0])}`;
    const seg = (a: VectorPoint, b: VectorPoint) => (a.out || b.in ? ` C${f(a.out ?? a)} ${f(b.in ?? b)} ${f(b)}` : ` L${f(b)}`);
    for (let i = 1; i < pts.length; i++) d += seg(pts[i - 1], pts[i]);
    if (s.closed && pts.length > 1) {
      const last = pts[pts.length - 1], first = pts[0];
      if (last.out || first.in) d += seg(last, first);
      d += ' Z';
    }
    parts.push(d);
  }
  return parts.join(' ');
}

/** Caixa de todos os pontos e alças. */
export function pathBounds(subpaths: Subpath[]): Rect {
  return boundsOf(subpaths.flatMap((s) => s.points.flatMap((p) => [p, ...(p.in ? [p.in] : []), ...(p.out ? [p.out] : [])])));
}

export function mapPoints(subpaths: Subpath[], fn: (p: Point) => Point): Subpath[] {
  return subpaths.map((s) => ({
    closed: s.closed,
    points: s.points.map((p) => ({ ...fn(p), ...(p.in ? { in: fn(p.in) } : {}), ...(p.out ? { out: fn(p.out) } : {}) })),
  }));
}

/** Escala o caminho (ao redimensionar a camada pelas alças). */
export function scalePath(d: string, sx: number, sy: number): string {
  return serializePath(mapPoints(parsePath(d), (p) => ({ x: p.x * sx, y: p.y * sy })));
}

/**
 * Depois de editar os pontos (no espaço do nó original), devolve o novo `d` já começando em 0,0
 * e a posição/tamanho que mantêm o desenho no mesmo lugar — inclusive com rotação.
 */
export function refitPath(node: Pick<PathNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>, subpaths: Subpath[]): { d: string; x: number; y: number; width: number; height: number } {
  const b = pathBounds(subpaths);
  const width = Math.max(0.01, b.width), height = Math.max(0.01, b.height);
  const shifted = mapPoints(subpaths, (p) => ({ x: p.x - b.x, y: p.y - b.y }));
  // o centro da caixa nova, no espaço do pai, tem que continuar no mesmo lugar
  const center = apply(nodeMatrix(node), { x: b.x + width / 2, y: b.y + height / 2 });
  const round = (v: number) => Math.round(v * 100) / 100;
  return { d: serializePath(shifted), x: round(center.x - width / 2), y: round(center.y - height / 2), width: round(width), height: round(height) };
}

// ── Edição de pontos ─────────────────────────────────────────────────────────

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Os quatro pontos de controle do segmento que sai do ponto `i` (o último fecha no primeiro). */
export function segmentPoints(s: Subpath, i: number): [Point, Point, Point, Point] | null {
  const a = s.points[i];
  const b = s.points[(i + 1) % s.points.length];
  if (!a || !b || (i === s.points.length - 1 && !s.closed)) return null;
  return [a, a.out ?? a, b.in ?? b, b];
}

/** Ponto da curva cúbica em t (0..1). */
export function cubicAt([p0, p1, p2, p3]: [Point, Point, Point, Point], t: number): Point {
  const q0 = lerp(p0, p1, t), q1 = lerp(p1, p2, t), q2 = lerp(p2, p3, t);
  return lerp(lerp(q0, q1, t), lerp(q1, q2, t), t);
}

/** Ponto mais perto de `p` num segmento (por amostragem): parâmetro t e distância. */
export function nearestOnSegment(seg: [Point, Point, Point, Point], p: Point, steps = 32): { t: number; dist: number } {
  let best = { t: 0, dist: Infinity };
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const q = cubicAt(seg, t);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best.dist) best = { t, dist: d };
  }
  return best;
}

/** Divide o segmento que sai do ponto `i` em t, criando um ponto novo (que fica em i + 1). */
export function splitSegment(subpaths: Subpath[], sub: number, i: number, t: number): Subpath[] {
  const out = subpaths.map((s) => ({ closed: s.closed, points: s.points.map((p) => ({ ...p })) }));
  const s = out[sub];
  const seg = segmentPoints(s, i);
  if (!seg) return out;
  const a = s.points[i];
  const j = (i + 1) % s.points.length;
  const b = s.points[j];
  const curved = !!(a.out || b.in);
  const [p0, p1, p2, p3] = seg;
  const q0 = lerp(p0, p1, t), q1 = lerp(p1, p2, t), q2 = lerp(p2, p3, t);
  const r0 = lerp(q0, q1, t), r1 = lerp(q1, q2, t), m = lerp(r0, r1, t);
  const point: VectorPoint = curved ? { x: m.x, y: m.y, in: r0, out: r1 } : { x: m.x, y: m.y };
  if (curved) {
    a.out = q0;
    b.in = q2;
  }
  s.points.splice(i + 1, 0, point);
  return out;
}

/** Alterna um ponto entre canto (sem alças) e suave (alças alinhadas). */
export function toggleSmooth(subpaths: Subpath[], sub: number, i: number): Subpath[] {
  const out = subpaths.map((s) => ({ closed: s.closed, points: s.points.map((p) => ({ ...p })) }));
  const s = out[sub];
  const p = s.points[i];
  if (!p) return out;
  if (p.in || p.out) {
    delete p.in;
    delete p.out;
    return out;
  }
  const n = s.points.length;
  const prev = i > 0 ? s.points[i - 1] : s.closed ? s.points[n - 1] : null;
  const next = i < n - 1 ? s.points[i + 1] : s.closed ? s.points[0] : null;
  const a = prev ?? p, b = next ?? p;
  let dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const lp = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) / 3 : 0;
  const ln = next ? Math.hypot(next.x - p.x, next.y - p.y) / 3 : 0;
  if (prev) p.in = { x: p.x - dx * lp, y: p.y - dy * lp };
  if (next) p.out = { x: p.x + dx * ln, y: p.y + dy * ln };
  return out;
}

/** Apaga pontos (por subcaminho e índice). Subcaminhos que ficam com menos de dois pontos somem. */
export function deletePoints(subpaths: Subpath[], sel: { sub: number; index: number }[]): Subpath[] {
  return subpaths
    .map((s, si) => ({ closed: s.closed, points: s.points.filter((_, i) => !sel.some((x) => x.sub === si && x.index === i)) }))
    .filter((s) => s.points.length > 1);
}
