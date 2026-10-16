// Partes comuns da importação de arquivos de outros programas.
import type { Asset, Page, SceneNode, ZalDocument } from '../types';
import { FORMAT_VERSION } from '../types';
import { mapPoints, parsePath, pathBounds, serializePath } from '../vector';
import { apply, clamp, toHex, uid, type Mat } from '../util';

export interface ImportReport {
  /** Avisos para mostrar ao usuário (o que não veio igual). */
  warnings: string[];
  /** Fontes usadas no arquivo (para avisar das que não estão instaladas). */
  fonts: string[];
  /** Contagem de camadas por tipo de origem. */
  counts: Record<string, number>;
}

export interface ImportResult {
  doc: ZalDocument;
  report: ImportReport;
}

/** Acumula avisos sem repetir a mesma frase. */
export class Warnings {
  private seen = new Map<string, number>();
  add(text: string): void {
    this.seen.set(text, (this.seen.get(text) ?? 0) + 1);
  }
  list(): string[] {
    return [...this.seen].map(([t, n]) => (n > 1 ? `${t} (${n}×)` : t));
  }
}

export function newDocument(name: string, pages: Page[]): ZalDocument {
  return {
    format: 'zaliel',
    version: FORMAT_VERSION,
    id: uid(16),
    name,
    pages,
    variables: [],
    libraries: [],
    assets: {},
    settings: { currentPage: pages[0]?.id },
  };
}

/** Cor 0..1 → #rrggbb(aa). */
export function rgbaHex(c: { r?: number; g?: number; b?: number; a?: number } | undefined, alpha = 1): string {
  if (!c) return '#000000';
  return toHex({ r: (c.r ?? 0) * 255, g: (c.g ?? 0) * 255, b: (c.b ?? 0) * 255, a: clamp((c.a ?? 1) * alpha, 0, 1) });
}

/** Normaliza "#RGB", "#RRGGBB" e "#RRGGBBAA" (maiúsculas ou não). Devolve null se não for cor. */
export function cssHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const h = v.trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) return null;
  const full = h.length <= 4 ? h.split('').map((c) => c + c).join('') : h;
  const lower = full.toLowerCase();
  return `#${lower.length === 8 && lower.endsWith('ff') ? lower.slice(0, 6) : lower}`;
}

const WEIGHTS: [RegExp, number][] = [
  [/hairline|thin/i, 100],
  [/extra\s*-?light|ultra\s*-?light/i, 200],
  [/semi\s*-?light|demi\s*-?light/i, 350],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi\s*-?bold|demi\s*-?bold/i, 600],
  [/extra\s*-?bold|ultra\s*-?bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
];

/** Peso a partir do nome do estilo da fonte ("Semi Bold Italic" → 600). */
export function weightFromStyle(style: string | undefined): number {
  if (!style) return 400;
  for (const [re, w] of WEIGHTS) if (re.test(style)) return w;
  return 400;
}

/** Tipo de imagem pelos primeiros bytes. */
export function imageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return 'image/webp';
  if (bytes[0] === 0x3c) return 'image/svg+xml';
  return null;
}

/** Largura e altura de PNG/JPEG/GIF/WebP lendo o cabeçalho (sem decodificar a imagem). */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return { width: v.getUint32(16), height: v.getUint32(20) };
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return { width: v.getUint16(6, true), height: v.getUint16(8, true) };
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        const len = v.getUint16(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: v.getUint16(i + 7), height: v.getUint16(i + 5) };
        i += 2 + len;
      }
    }
    if (bytes[0] === 0x52 && bytes[8] === 0x57) {
      const kind = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
      if (kind === 'VP8X') return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
      if (kind === 'VP8 ') return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
      if (kind === 'VP8L') {
        const b = v.getUint32(21, true);
        return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
      }
    }
  } catch {
    /* cabeçalho incompleto */
  }
  return null;
}

export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function makeAsset(bytes: Uint8Array): Asset | null {
  const mime = imageMime(bytes);
  if (!mime) return null;
  const size = imageSize(bytes);
  return { mime, data: base64(bytes), ...(size ? size : {}) };
}

/**
 * Passa um caminho pela matriz (posição + rotação + espelhamento) e devolve
 * o caminho já no espaço do pai, começando em 0,0, com a caixa resultante.
 */
export function bakePath(d: string, m: Mat): { d: string; x: number; y: number; width: number; height: number } {
  const moved = mapPoints(parsePath(d), (p) => apply(m, p));
  const b = pathBounds(moved);
  const local = mapPoints(moved, (p) => ({ x: p.x - b.x, y: p.y - b.y }));
  return { d: serializePath(local), x: r2(b.x), y: r2(b.y), width: Math.max(0.01, r2(b.width)), height: Math.max(0.01, r2(b.height)) };
}

export const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Posição (x, y) e rotação no formato do Zaliel (rotação em torno do centro) a partir de uma
 * matriz que gira em torno do canto superior esquerdo. Espelhamentos não entram (devolve `flipped`).
 */
export function placement(m: Mat, w: number, h: number): { x: number; y: number; rotation?: number; flipped: boolean } {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  const len = Math.hypot(a, b) || 1;
  const cos = a / len, sin = b / len;
  const deg = (Math.atan2(sin, cos) * 180) / Math.PI;
  const rot = Math.abs(deg) < 0.01 ? 0 : deg;
  if (!rot) return { x: r2(e), y: r2(f), flipped: det < 0 };
  // o canto (0,0) tem que cair em (e, f) girando em torno do centro
  const x = e - w / 2 + (cos * w) / 2 - (sin * h) / 2;
  const y = f - h / 2 + (sin * w) / 2 + (cos * h) / 2;
  return { x: r2(x), y: r2(y), rotation: r2(rot), flipped: det < 0 };
}

/** Conta camadas de uma árvore (para o relatório). */
export function countNodes(nodes: SceneNode[]): number {
  let n = 0;
  const visit = (list: SceneNode[]) => list.forEach((c) => {
    n++;
    if ('children' in c) visit(c.children);
  });
  visit(nodes);
  return n;
}

/** Lê um ZIP (método "guardado" ou "deflate"). `inflateRaw` é fornecido por quem chama. */
export function readZip(bytes: Uint8Array, inflateRaw: (b: Uint8Array) => Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('arquivo compactado inválido');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const text = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('arquivo compactado inválido');
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), elen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const loff = v.getUint32(p + 42, true);
    const name = text.decode(bytes.subarray(p + 46, p + 46 + nlen));
    const start = loff + 30 + v.getUint16(loff + 26, true) + v.getUint16(loff + 28, true);
    const data = bytes.subarray(start, start + csize);
    if (!name.endsWith('/')) out.set(name, method === 8 ? inflateRaw(data) : data);
    p += 46 + nlen + elen + clen;
  }
  return out;
}

/** Um elemento SVG simples (path, circle, ellipse, rect, line, polyline, polygon) como caminho. */
export function svgShapeToPath(tag: string, a: Record<string, string>): string {
  const n = (k: string, d = 0) => {
    const v = parseFloat(a[k]);
    return Number.isFinite(v) ? v : d;
  };
  const f = (v: number) => String(Math.round(v * 1000) / 1000);
  switch (tag) {
    case 'path':
      return a.d ?? '';
    case 'circle':
    case 'ellipse': {
      const cx = n('cx'), cy = n('cy');
      const rx = tag === 'circle' ? n('r') : n('rx'), ry = tag === 'circle' ? n('r') : n('ry');
      if (!rx || !ry) return '';
      return `M${f(cx - rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)} Z`;
    }
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height');
      let rx = n('rx', NaN), ry = n('ry', NaN);
      if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
      if (Number.isNaN(ry)) ry = rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${f(x)} ${f(y)} H${f(x + w)} V${f(y + h)} H${f(x)} Z`;
      return `M${f(x + rx)} ${f(y)} H${f(x + w - rx)} A${f(rx)} ${f(ry)} 0 0 1 ${f(x + w)} ${f(y + ry)} V${f(y + h - ry)} A${f(rx)} ${f(ry)} 0 0 1 ${f(x + w - rx)} ${f(y + h)} H${f(x + rx)} A${f(rx)} ${f(ry)} 0 0 1 ${f(x)} ${f(y + h - ry)} V${f(y + ry)} A${f(rx)} ${f(ry)} 0 0 1 ${f(x + rx)} ${f(y)} Z`;
    }
    case 'line':
      return `M${f(n('x1'))} ${f(n('y1'))} L${f(n('x2'))} ${f(n('y2'))}`;
    case 'polyline':
    case 'polygon': {
      const pts = (a.points ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
      if (pts.length < 4) return '';
      let d = `M${f(pts[0])} ${f(pts[1])}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += ` L${f(pts[i])} ${f(pts[i + 1])}`;
      return tag === 'polygon' ? `${d} Z` : d;
    }
    default:
      return '';
  }
}
