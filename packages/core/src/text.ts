// Trechos de estilo dentro de um texto (negrito, cor… num pedaço só).
// Os trechos gravados ficam sempre normalizados: ordenados, sem sobreposição,
// sem trechos vazios e só com o que difere do estilo do texto.
import type { Hex, TextRun, TextStyle } from './types';

/** O que um trecho pode mudar. */
export type RunAttrs = Omit<TextRun, 'start' | 'end'>;

export const RUN_ATTRS = ['family', 'weight', 'italic', 'size', 'letterSpacing', 'decoration', 'color'] as const satisfies readonly (keyof RunAttrs)[];

/** Pedaço contínuo do texto com o estilo final já calculado. */
export interface TextSegment {
  start: number;
  end: number;
  style: TextStyle;
  /** Cor própria do trecho (sem ela, vale o preenchimento do texto). */
  color?: Hex;
  /** O pedaço tem algum estilo próprio. */
  styled: boolean;
}

/** Trecho em formato de texto: o pedaço e o que muda nele (usado pela automação). */
export interface TextSpan extends RunAttrs {
  text: string;
}

function attrsOf(r: Partial<TextRun>): RunAttrs {
  const out: RunAttrs = {};
  for (const k of RUN_ATTRS) if (r[k] !== undefined) (out as Record<string, unknown>)[k] = r[k];
  return out;
}

/** Valor do estilo do texto para o atributo (a cor não faz parte do estilo). */
function baseValue(base: TextStyle | undefined, k: keyof RunAttrs): unknown {
  if (!base || k === 'color') return undefined;
  if (k === 'italic') return !!base.italic;
  if (k === 'decoration') return base.decoration ?? 'none';
  if (k === 'letterSpacing') return base.letterSpacing ?? 0;
  return base[k];
}

/** Tira o que é igual ao estilo do texto. */
function stripBase(a: RunAttrs, base?: TextStyle): RunAttrs {
  const out: RunAttrs = {};
  for (const k of RUN_ATTRS) {
    let v = a[k];
    if (v === undefined) continue;
    if (k === 'color' && typeof v === 'string') v = v.toLowerCase();
    if (base && v === baseValue(base, k)) continue;
    if (!base && ((k === 'italic' && v === false) || (k === 'decoration' && v === 'none'))) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

const sameAttrs = (a: RunAttrs, b: RunAttrs) => RUN_ATTRS.every((k) => a[k] === b[k]);
const isEmpty = (a: RunAttrs) => RUN_ATTRS.every((k) => a[k] === undefined);

/** Pontos onde o estilo pode mudar, dentro de [0, len]. */
function boundaries(runs: readonly TextRun[], len: number, extra: number[] = []): number[] {
  const set = new Set<number>([0, len]);
  for (const r of runs) {
    set.add(clamp(r.start, len));
    set.add(clamp(r.end, len));
  }
  for (const p of extra) set.add(clamp(p, len));
  return [...set].sort((a, b) => a - b);
}

const clamp = (v: number, len: number) => Math.max(0, Math.min(len, Math.round(Number.isFinite(v) ? v : 0)));

/** Atributos que valem num pedaço [s, e): os trechos que o cobrem, o último ganha. */
function attrsAt(runs: readonly TextRun[], s: number, e: number): RunAttrs {
  let a: RunAttrs = {};
  for (const r of runs) if (r.start <= s && r.end >= e && r.end > r.start) a = { ...a, ...attrsOf(r) };
  return a;
}

/**
 * Deixa os trechos no formato gravado: dentro do texto, ordenados, sem sobreposição
 * (o último da lista ganha), sem atributos iguais ao estilo do texto e com vizinhos iguais unidos.
 */
export function normalizeRuns(runs: readonly TextRun[] | undefined, len: number, base?: TextStyle): TextRun[] {
  if (!runs?.length || len <= 0) return [];
  const pts = boundaries(runs, len);
  const out: TextRun[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1];
    if (e <= s) continue;
    const a = stripBase(attrsAt(runs, s, e), base);
    if (isEmpty(a)) continue;
    const last = out[out.length - 1];
    if (last && last.end === s && sameAttrs(attrsOf(last), a)) last.end = e;
    else out.push({ start: s, end: e, ...a });
  }
  return out;
}

/** O texto inteiro em pedaços com o estilo final de cada um (sem trechos: um pedaço só). */
export function textSegments(text: string, style: TextStyle, runs?: readonly TextRun[]): TextSegment[] {
  const len = text.length;
  if (!runs?.length || !len) return [{ start: 0, end: len, style, styled: false }];
  const pts = boundaries(runs, len);
  const out: TextSegment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1];
    if (e <= s) continue;
    const a = attrsAt(runs, s, e);
    const { color, ...rest } = a;
    const seg: TextSegment = { start: s, end: e, style: { ...style, ...rest }, styled: !isEmpty(a) };
    if (color) seg.color = color;
    out.push(seg);
  }
  return out;
}

/**
 * Ajusta os trechos a uma edição do texto: em `at`, `removed` caracteres saem e `inserted` entram.
 * O que é digitado herda o estilo da letra anterior (no começo, o da letra seguinte).
 */
export function spliceRuns(runs: readonly TextRun[] | undefined, at: number, removed: number, inserted: number, newLength: number): TextRun[] {
  if (!runs?.length) return [];
  const cut = at + removed;
  const del = (p: number) => (p <= at ? p : p >= cut ? p - removed : at);
  const out: TextRun[] = [];
  for (const r of runs) {
    let s = del(r.start), e = del(r.end);
    if (inserted) {
      if (s < at && e >= at) e += inserted;
      else if (at === 0 && s === 0 && e > 0) e += inserted;
      else if (s >= at) {
        s += inserted;
        e += inserted;
      }
    }
    if (e > s) out.push({ ...r, start: s, end: e });
  }
  return normalizeRuns(out, newLength);
}

/** Onde duas versões de um texto diferem: posição, quantos saíram e quantos entraram. */
export function textDiff(before: string, after: string): { at: number; removed: number; inserted: number } {
  let a = 0;
  const max = Math.min(before.length, after.length);
  while (a < max && before[a] === after[a]) a++;
  let b = 0;
  while (b < max - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
  return { at: a, removed: before.length - a - b, inserted: after.length - a - b };
}

/** Trechos depois de trocar o texto de `before` para `after` (edição livre, como num campo de texto). */
export function runsAfterEdit(runs: readonly TextRun[] | undefined, before: string, after: string): TextRun[] {
  if (!runs?.length) return [];
  const d = textDiff(before, after);
  return spliceRuns(runs, d.at, d.removed, d.inserted, after.length);
}

/**
 * Aplica atributos ao pedaço [start, end). Atributo `undefined` volta ao estilo do texto.
 * Devolve os trechos já normalizados.
 */
export function applyRunStyle(runs: readonly TextRun[] | undefined, len: number, start: number, end: number, patch: Partial<RunAttrs>, base: TextStyle): TextRun[] {
  const s0 = clamp(Math.min(start, end), len), e0 = clamp(Math.max(start, end), len);
  const list = runs ?? [];
  if (e0 <= s0) return normalizeRuns(list, len, base);
  const pts = boundaries(list, len, [s0, e0]);
  const out: TextRun[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1];
    if (e <= s) continue;
    let a = attrsAt(list, s, e);
    if (s >= s0 && e <= e0) {
      a = { ...a };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete (a as Record<string, unknown>)[k];
        else (a as Record<string, unknown>)[k] = v;
      }
    }
    out.push({ start: s, end: e, ...a });
  }
  return normalizeRuns(out, len, base);
}

/** Tira um atributo de todos os trechos (ex.: o texto inteiro passou a ter outro peso). */
export function clearRunAttr(runs: readonly TextRun[] | undefined, len: number, keys: (keyof RunAttrs)[], base?: TextStyle): TextRun[] {
  if (!runs?.length) return [];
  const out = runs.map((r) => {
    const c = { ...r };
    for (const k of keys) delete c[k];
    return c;
  });
  return normalizeRuns(out, len, base);
}

/** Pedaços que tocam [start, end) (com seleção vazia, o pedaço onde está o cursor). */
export function segmentsIn(text: string, style: TextStyle, runs: readonly TextRun[] | undefined, start: number, end: number): TextSegment[] {
  const segs = textSegments(text, style, runs);
  const s = Math.min(start, end), e = Math.max(start, end);
  if (s === e) {
    const p = Math.max(0, s - 1);
    return segs.filter((g) => g.start <= p && (g.end > p || g.end === text.length)).slice(0, 1);
  }
  return segs.filter((g) => g.end > s && g.start < e);
}

/** Trechos → lista de pedaços de texto com o que muda em cada um. */
export function runsToSpans(text: string, runs: readonly TextRun[] | undefined): TextSpan[] {
  const out: TextSpan[] = [];
  const len = text.length;
  const pts = boundaries(runs ?? [], len);
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i], e = pts[i + 1];
    if (e <= s) continue;
    out.push({ text: text.slice(s, e), ...attrsAt(runs ?? [], s, e) });
  }
  return out;
}

/** Pedaços de texto → texto inteiro e trechos normalizados. */
export function spansToRuns(spans: readonly TextSpan[], base?: TextStyle): { text: string; runs: TextRun[] } {
  let text = '';
  const runs: TextRun[] = [];
  for (const sp of spans) {
    const t = String(sp.text ?? '');
    const a = attrsOf(sp);
    if (t && !isEmpty(a)) runs.push({ start: text.length, end: text.length + t.length, ...a });
    text += t;
  }
  return { text, runs: normalizeRuns(runs, text.length, base) };
}
