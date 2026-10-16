// Utilitários puros: ids, cores, matrizes 2D e retângulos.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function uid(len = 10): string {
  let s = '';
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function round(v: number, step = 0.01): number {
  return Math.round(v / step) * step;
}

// ── Cores ────────────────────────────────────────────────────────────────────

export interface RGBA {
  r: number; // 0..255
  g: number;
  b: number;
  a: number; // 0..1
}

export function parseHex(hex: string): RGBA {
  let h = (hex || '').trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return { r: 0, g: 0, b: 0, a: 1 };
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

export function toHex({ r, g, b, a }: RGBA): string {
  const p = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}${a < 1 ? p(a * 255) : ''}`;
}

/** Normaliza o que o usuário digitou ("fff", "#FF00AA", "ff00aa80") ou devolve null. */
export function normalizeHex(input: string): string | null {
  const h = input.trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) return null;
  return toHex(parseHex(h));
}

export function rgbToHsv({ r, g, b }: RGBA): { h: number; s: number; v: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb(h: number, s: number, v: number, a = 1): RGBA {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a };
}

// ── Geometria ────────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Matriz afim 2D [a, b, c, d, e, f] — x' = a·x + c·y + e ; y' = b·x + d·y + f. */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function apply(m: Mat, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y];
}

export function rotate(deg: number): Mat {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

/** Transformação local de um nó: posição + rotação em torno do centro. */
export function nodeMatrix(n: { x: number; y: number; width: number; height: number; rotation?: number; flipX?: boolean; flipY?: boolean }): Mat {
  if (!n.rotation && !n.flipX && !n.flipY) return translate(n.x, n.y);
  const cx = n.width / 2, cy = n.height / 2;
  // espelhar em torno do centro: a caixa continua no mesmo lugar
  const flip: Mat = [n.flipX ? -1 : 1, 0, 0, n.flipY ? -1 : 1, 0, 0];
  return multiply(translate(n.x + cx, n.y + cy), multiply(rotate(n.rotation ?? 0), multiply(flip, translate(-cx, -cy))));
}

export function rectCorners(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

export function boundsOf(points: Point[]): Rect {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function unionRects(rects: Rect[]): Rect {
  return boundsOf(rects.flatMap(rectCorners));
}

export function transformRect(m: Mat, r: Rect): Rect {
  return boundsOf(rectCorners(r).map((p) => apply(m, p)));
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
