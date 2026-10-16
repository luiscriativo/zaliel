// Descrição de camadas da automação (parecida com CSS) ⇄ nós do documento.
// O mesmo formato serve para criar, alterar e ler, então quem automatiza pode ler
// uma camada, mudar o que quiser e mandar de volta.
import {
  createNode,
  clone,
  uid,
  cssHex,
  findStyle,
  allStyles,
  stylePatch,
  propertyDefs,
  findVariant,
  variantName,
  allCollections,
  resolveVariable,
  type SceneNode,
  type ContainerNode,
  type InstanceNode,
  type TextNode,
  type PathNode,
  type Paint,
  type Stroke,
  type StrokeSides,
  normalizeSides,
  type Effect,
  type AutoLayout,
  type Sizing,
  type TextStyle,
  type TextRun,
  type TextSpan,
  spansToRuns,
  runsAfterEdit,
  clearRunAttr,
  type ComponentProperty,
  type Interaction,
  type LayoutGrid,
  type Op,
  type StyleSlot,
  type InstanceOverride,
  type Variable,
} from '@zaliel/core';
import type { Editor } from '../editor';
// montagem de SVG fica em outro arquivo (precisa do DOMParser e do Skia)
import { svgToNodes } from './svg';

/** Camada descrita para a automação (todos os campos são opcionais, menos `type`). */
export interface NodeSpec {
  type: string;
  ref?: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number | string;
  height?: number | string;
  minWidth?: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  blendMode?: string;
  fill?: unknown;
  color?: unknown;
  stroke?: unknown;
  /** Contorno de um lado só, como border-top/right/bottom/left do CSS ("1px solid #e5e7eb", número ou objeto). */
  strokeTop?: unknown;
  strokeRight?: unknown;
  strokeBottom?: unknown;
  strokeLeft?: unknown;
  radius?: number | number[];
  effects?: unknown;
  shadow?: unknown;
  clip?: boolean;
  layout?: unknown;
  absolute?: boolean;
  constraints?: { horizontal?: string; vertical?: string };
  grids?: unknown[];
  fillStyle?: string;
  strokeStyle?: string;
  effectStyle?: string;
  textStyle?: string;
  // texto
  text?: string;
  /** Texto com pedaços de estilo próprio (negrito, cor…); no lugar de `text`. */
  spans?: (string | SpanSpec)[];
  font?: string;
  size?: number;
  weight?: number | string;
  italic?: boolean;
  lineHeight?: number | string;
  letterSpacing?: number;
  align?: string;
  verticalAlign?: string;
  decoration?: string;
  case?: string;
  autoResize?: string;
  // formas
  points?: number;
  innerRadius?: number;
  d?: string;
  fillRule?: string;
  // ícone, imagem, svg
  icon?: string;
  strokeWidth?: number;
  src?: string;
  fit?: string;
  svg?: string;
  // componentes
  component?: string;
  variant?: Record<string, string>;
  props?: Record<string, string | boolean>;
  overrides?: Record<string, { text?: string; spans?: (string | SpanSpec)[]; fill?: unknown; color?: unknown; stroke?: unknown; visible?: boolean; component?: string; variant?: Record<string, string>; width?: number; height?: number; opacity?: number }>;
  description?: string;
  properties?: { name: string; type: string; default: string | boolean }[];
  bind?: { text?: string; visible?: string; component?: string };
  // protótipo
  link?: { to?: string; action?: string; transition?: string; duration?: number; position?: string; background?: string; closeOutside?: boolean };
  meta?: Record<string, unknown>;
  children?: NodeSpec[];
}

export class SpecError extends Error {}

const SIDE_KEYS = { top: 'strokeTop', right: 'strokeRight', bottom: 'strokeBottom', left: 'strokeLeft' } as const;

/** Ícone já desenhado (caixa de 24×24, desenhado com traço). */
export interface IconShape {
  d: string;
  size: number;
  stroke: boolean;
  strokeWidth?: number;
}

/** Contexto de um lote: referências criadas, avisos e recursos carregados antes de montar. */
export class BuildContext {
  refs = new Map<string, string>();
  warnings: string[] = [];
  icons = new Map<string, IconShape>();
  images = new Map<string, { key: string; width: number; height: number }>();
  /** Imagens que são SVG: viram vetores editáveis (o motor gráfico não abre SVG como bitmap). */
  svgImages = new Map<string, string>();
  /** Operações extras (imagens novas) que entram no mesmo passo. */
  assetOps: Op[] = [];
  /** Ligações do protótipo (o destino pode ser criado depois, no mesmo lote). */
  links: { id: string; link: NonNullable<NodeSpec['link']> }[] = [];
  constructor(public ed: Editor) {}

  warn(msg: string): void {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }

  /** Id real a partir de um id, de uma referência ("botao" ou "@botao") ou do nome único de uma camada. */
  id(ref: string | undefined, required = true): string | undefined {
    if (!ref) {
      if (required) throw new SpecError('faltou o id da camada');
      return undefined;
    }
    const key = ref.startsWith('@') ? ref.slice(1) : ref;
    if (this.refs.has(key)) return this.refs.get(key);
    const idx = this.ed.model.index;
    if (idx.get(ref) || idx.page(ref)) return ref;
    if (ref === 'page' || ref === 'pagina') return this.ed.pageId;
    // nome exato de camada (só se for único no arquivo)
    const found: string[] = [];
    for (const p of this.ed.doc.pages) {
      const visit = (list: SceneNode[]) => {
        for (const n of list) {
          if (n.name === key) found.push(n.id);
          if ('children' in n) visit(n.children);
        }
      };
      visit(p.children);
    }
    if (found.length === 1) return found[0];
    if (found.length > 1) {
      // nome repetido: uma tela do topo da página atual com esse nome é a escolha óbvia
      const top = found.filter((id) => idx.parentId(id) === this.ed.pageId);
      if (top.length === 1) return top[0];
      throw new SpecError(`há ${found.length} camadas chamadas “${key}”; use o id`);
    }
    if (required) throw new SpecError(`camada não encontrada: ${ref}`);
    return undefined;
  }
}

// ── Valores ──────────────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
  white: '#ffffff', black: '#000000', red: '#ef4444', green: '#22c55e', blue: '#3b82f6', yellow: '#eab308', orange: '#f97316',
  purple: '#a855f7', pink: '#ec4899', gray: '#6b7280', grey: '#6b7280', transparent: '#00000000',
};

/** Cor CSS (#hex, rgb(), rgba(), hsl(), nome) para #rrggbb[aa]. */
/** Clientes que não conhecem um parâmetro mandam listas e objetos como texto JSON: aceita os dois. */
export function jsonish(v: unknown): unknown {
  if (typeof v !== 'string' || !/^s*[[{]/.test(v)) return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export function parseColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  const hex = cssHex(s);
  if (hex) return hex;
  const to2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  const m = s.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const ch = (x: string) => (x.endsWith('%') ? (parseFloat(x) / 100) * 255 : parseFloat(x));
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return `#${to2(ch(m[1]))}${to2(ch(m[2]))}${to2(ch(m[3]))}${a < 1 ? to2(a * 255) : ''}`;
  }
  const h = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (h) {
    const H = parseFloat(h[1]) / 360, S = parseFloat(h[2]) / 100, L = parseFloat(h[3]) / 100;
    const q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q;
    const f = (t: number) => {
      t = (t + 1) % 1;
      return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    };
    const a = h[4] === undefined ? 1 : h[4].endsWith('%') ? parseFloat(h[4]) / 100 : parseFloat(h[4]);
    return `#${to2(f(H + 1 / 3) * 255)}${to2(f(H) * 255)}${to2(f(H - 1 / 3) * 255)}${a < 1 ? to2(a * 255) : ''}`;
  }
  return null;
}

/** Variável pelo nome ("cores/primária", "Tema/cores/primária" ou o id). */
export function findVariableByName(ed: Editor, name: string): { variable: Variable; collectionId: string } | null {
  const want = name.replace(/^\$|^var:/, '').trim().toLowerCase();
  for (const c of allCollections(ed.doc)) {
    for (const v of c.variables) {
      if (v.id === want || v.name.toLowerCase() === want || `${c.name}/${v.name}`.toLowerCase() === want) return { variable: v, collectionId: c.id };
    }
  }
  return null;
}

/** Pedaço de um texto com estilo próprio. */
export interface SpanSpec {
  text: string;
  weight?: number | string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number;
  font?: string;
  letterSpacing?: number;
  decoration?: string;
}

function weightOf(v: unknown): number {
  if (typeof v === 'number') return Math.max(100, Math.min(900, Math.round(v / 100) * 100));
  const s = String(v ?? '').toLowerCase().replace(/[\s_-]/g, '');
  const table: Record<string, number> = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };
  return table[s] ?? (parseInt(s, 10) || 400);
}

const SHADOWS: Record<string, Effect[]> = {
  xs: [{ type: 'drop-shadow', color: '#0000000d', x: 0, y: 1, blur: 2, spread: 0 }],
  sm: [{ type: 'drop-shadow', color: '#00000014', x: 0, y: 1, blur: 3, spread: 0 }, { type: 'drop-shadow', color: '#0000000f', x: 0, y: 1, blur: 2, spread: -1 }],
  md: [{ type: 'drop-shadow', color: '#00000017', x: 0, y: 4, blur: 12, spread: -2 }, { type: 'drop-shadow', color: '#0000000f', x: 0, y: 2, blur: 4, spread: -2 }],
  lg: [{ type: 'drop-shadow', color: '#0000001f', x: 0, y: 12, blur: 32, spread: -6 }, { type: 'drop-shadow', color: '#0000000f', x: 0, y: 4, blur: 8, spread: -4 }],
  xl: [{ type: 'drop-shadow', color: '#00000029', x: 0, y: 24, blur: 48, spread: -12 }],
};

export class Converter {
  constructor(public ctx: BuildContext) {}

  private get ed(): Editor {
    return this.ctx.ed;
  }

  // ── Pinturas ───────────────────────────────────────────────────────────────

  paint(v: unknown): Paint | null {
    if (v === null || v === undefined || v === 'none' || v === false) return null;
    if (typeof v === 'string') {
      const s = v.trim();
      if (s.startsWith('$') || s.startsWith('var:')) {
        const found = findVariableByName(this.ed, s);
        if (!found) throw new SpecError(`variável não encontrada: ${s}`);
        if (found.variable.type !== 'color') throw new SpecError(`a variável ${s} não é uma cor`);
        const value = resolveVariable(this.ed.doc, found.variable.id);
        return { type: 'solid', color: typeof value === 'string' ? value : '#000000', variable: found.variable.id };
      }
      if (/gradient\(/i.test(s)) return this.cssGradient(s);
      const c = parseColor(s);
      if (!c) throw new SpecError(`cor inválida: ${s}`);
      return { type: 'solid', color: c };
    }
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const t = String(o.type ?? (o.stops || o.colors ? 'linear' : o.src ? 'image' : 'solid'));
      if (t === 'solid') {
        const base = this.paint(o.color ?? o.value);
        if (!base) return null;
        return { ...base, ...(typeof o.opacity === 'number' ? { opacity: o.opacity } : {}) } as Paint;
      }
      if (t === 'image') {
        const img = this.ctx.images.get(String(o.src));
        if (!img) throw new SpecError(`imagem não carregada: ${o.src}`);
        const fit = String(o.fit ?? 'fill');
        return { type: 'image', asset: img.key, scaleMode: (['fill', 'fit', 'stretch', 'tile'].includes(fit) ? fit : fit === 'cover' ? 'fill' : fit === 'contain' ? 'fit' : 'fill') as 'fill' };
      }
      if (t === 'linear' || t === 'radial' || t === 'angular') {
        const raw = (o.stops ?? o.colors) as unknown[];
        if (!Array.isArray(raw) || raw.length < 2) throw new SpecError('gradiente precisa de pelo menos duas cores');
        const stops = raw.map((s, i) => {
          if (typeof s === 'string') return { offset: i / (raw.length - 1), color: parseColor(s) ?? '#000000' };
          const so = s as Record<string, unknown>;
          return { offset: Number(so.offset ?? so.position ?? i / (raw.length - 1)), color: parseColor(so.color) ?? '#000000' };
        });
        const angle = Number(o.angle ?? 180);
        const rad = (angle * Math.PI) / 180;
        const dx = Math.sin(rad) / 2, dy = -Math.cos(rad) / 2;
        const handles = t === 'linear' ? { from: { x: 0.5 - dx, y: 0.5 - dy }, to: { x: 0.5 + dx, y: 0.5 + dy } } : { from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 0.5 } };
        return { type: t, stops, handles, ...(typeof o.opacity === 'number' ? { opacity: o.opacity } : {}) };
      }
    }
    throw new SpecError(`pintura inválida: ${JSON.stringify(v)}`);
  }

  /** "linear-gradient(135deg, #a 0%, #b 100%)" e "radial-gradient(#a, #b)". */
  private cssGradient(s: string): Paint {
    const m = s.match(/^(linear|radial|conic)-gradient\((.*)\)$/i);
    if (!m) throw new SpecError(`gradiente inválido: ${s}`);
    const parts = m[2].split(/,(?![^(]*\))/).map((p) => p.trim());
    let angle = 180;
    if (/^(-?[\d.]+)deg$/.test(parts[0])) angle = parseFloat(parts.shift()!);
    else if (/^to /.test(parts[0])) {
      const dir = parts.shift()!.slice(3);
      angle = ({ top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135, 'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 } as Record<string, number>)[dir] ?? 180;
    }
    const stops = parts.map((p, i) => {
      const mm = p.match(/^(.*?)(?:\s+([\d.]+)%)?$/)!;
      return { offset: mm[2] !== undefined ? parseFloat(mm[2]) / 100 : i / Math.max(1, parts.length - 1), color: mm[1] };
    });
    return this.paint({ type: m[1].toLowerCase() === 'conic' ? 'angular' : m[1].toLowerCase(), angle, stops })!;
  }

  paints(v: unknown): Paint[] {
    v = jsonish(v);
    if (v === null || v === undefined || v === 'none') return [];
    return (Array.isArray(v) ? v : [v]).map((p) => this.paint(p)).filter(Boolean) as Paint[];
  }

  strokes(v: unknown, centered: boolean): Stroke[] {
    v = jsonish(v);
    if (v === null || v === undefined || v === 'none' || v === false) return [];
    return (Array.isArray(v) ? v : [v]).map((s) => {
      if (typeof s === 'string') {
        // "1px solid #ddd" também vale
        const css = s.match(/^([\d.]+)px\s+(solid|dashed|dotted)\s+(.+)$/i);
        if (css) {
          const paint = this.paint(css[3])!;
          const w = parseFloat(css[1]);
          return { paint, width: w, align: centered ? 'center' : 'inside', ...(css[2] === 'dashed' ? { dash: [w * 4, w * 3] } : css[2] === 'dotted' ? { dash: [w, w * 2], cap: 'round' as const } : {}) } as Stroke;
        }
        return { paint: this.paint(s)!, width: 1, align: centered ? 'center' : 'inside' } as Stroke;
      }
      const o = s as Record<string, unknown>;
      const paint = this.paint(o.color ?? o.paint ?? '#000000');
      if (!paint) throw new SpecError('contorno sem cor');
      const align = String(o.align ?? o.position ?? (centered ? 'center' : 'inside'));
      return {
        paint,
        width: Number(o.width ?? o.weight ?? 1),
        align: (['inside', 'center', 'outside'].includes(align) ? align : 'inside') as Stroke['align'],
        ...(o.sides !== undefined ? { sides: this.sides(o.sides, Number(o.width ?? o.weight ?? 1)) } : {}),
        ...(Array.isArray(o.dash) ? { dash: o.dash.map(Number) } : {}),
        ...(o.cap ? { cap: o.cap as Stroke['cap'] } : {}),
        ...(o.join ? { join: o.join as Stroke['join'] } : {}),
      };
    });
  }

  /**
   * Lados de um contorno: {bottom: 1} (o que faltar vale 0), ["bottom", "right"] (com a espessura do contorno),
   * [topo, direita, baixo, esquerda] em números (como no CSS) ou "bottom".
   */
  sides(v: unknown, width: number): StrokeSides {
    v = jsonish(v);
    const names = ['top', 'right', 'bottom', 'left'] as const;
    const out: StrokeSides = { top: 0, right: 0, bottom: 0, left: 0 };
    const list = typeof v === 'string' ? v.split(/[\s,]+/).filter(Boolean) : v;
    if (Array.isArray(list)) {
      if (list.every((x) => typeof x === 'number')) {
        const [t, r = t, b = t, l = r] = list as number[];
        return normalizeSides({ top: t, right: r, bottom: b, left: l })!;
      }
      for (const x of list) {
        const k = String(x).toLowerCase();
        if (k === 'all') names.forEach((nm) => (out[nm] = width));
        else if (k === 'x' || k === 'horizontal') out.left = out.right = width;
        else if (k === 'y' || k === 'vertical') out.top = out.bottom = width;
        else if ((names as readonly string[]).includes(k)) out[k as keyof StrokeSides] = width;
        else throw new SpecError(`lado desconhecido: ${String(x)} (use top, right, bottom ou left)`);
      }
      return out;
    }
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) if (!(names as readonly string[]).includes(k)) throw new SpecError(`lado desconhecido: ${k} (use top, right, bottom ou left)`);
      return normalizeSides(v)!;
    }
    throw new SpecError('"sides" deve ser um objeto como {"bottom": 1}, uma lista de lados ou [topo, direita, baixo, esquerda]');
  }

  /**
   * Atalhos strokeTop/Right/Bottom/Left (como border-bottom do CSS) aplicados sobre uma lista de contornos:
   * o lado informado sai dos outros contornos e entra no de mesma cor e estilo (ou num novo).
   */
  sideStrokes(base: Stroke[], spec: NodeSpec, centered: boolean): Stroke[] | null {
    const given = (['top', 'right', 'bottom', 'left'] as const).filter((k) => spec[SIDE_KEYS[k]] !== undefined);
    if (!given.length) return null;
    const full = (s: Stroke): Stroke => (s.sides ? s : { ...s, sides: { top: s.width, right: s.width, bottom: s.width, left: s.width } });
    let list = base.map((s) => full(clone(s)));
    for (const side of given) {
      const raw = jsonish(spec[SIDE_KEYS[side]]);
      for (const s of list) s.sides![side] = 0;
      if (raw === null || raw === 'none' || raw === false || raw === 0) continue;
      const parsed = typeof raw === 'number' ? (list[0] ? [{ ...list[0], width: raw }] : this.strokes({ width: raw, color: '#000000' }, centered)) : this.strokes(raw, centered);
      for (const p of parsed) {
        if (p.width <= 0) continue;
        const same = list.find((s) => JSON.stringify(s.paint) === JSON.stringify(p.paint) && s.align === p.align && JSON.stringify(s.dash ?? []) === JSON.stringify(p.dash ?? []));
        if (same) same.sides![side] = p.width;
        else list.push({ ...p, sides: { top: 0, right: 0, bottom: 0, left: 0, [side]: p.width } });
      }
    }
    list = list.filter((s) => s.sides!.top || s.sides!.right || s.sides!.bottom || s.sides!.left);
    // contorno que voltou a ser igual nos 4 lados não precisa de "sides"
    for (const s of list) {
      const d = s.sides!;
      if (d.top === d.right && d.right === d.bottom && d.bottom === d.left) {
        s.width = d.top;
        delete s.sides;
      } else if (!Object.values(d).includes(s.width)) s.width = Math.max(d.top, d.right, d.bottom, d.left);
    }
    return list;
  }

  effects(v: unknown): Effect[] {
    v = jsonish(v);
    if (v === null || v === undefined || v === 'none') return [];
    if (typeof v === 'string') {
      if (SHADOWS[v]) return clone(SHADOWS[v]);
      throw new SpecError(`sombra desconhecida: ${v} (use xs, sm, md, lg, xl ou uma lista de efeitos)`);
    }
    return (Array.isArray(v) ? v : [v]).flatMap((e): Effect[] => {
      if (typeof e === 'string') return this.effects(e);
      const o = e as Record<string, unknown>;
      const t = String(o.type ?? 'shadow');
      if (t === 'blur' || t === 'layer-blur') return [{ type: 'layer-blur', radius: Number(o.radius ?? o.blur ?? 8) }];
      if (t === 'background-blur' || t === 'backdrop-blur') return [{ type: 'background-blur', radius: Number(o.radius ?? o.blur ?? 16) }];
      return [{
        type: t === 'inner-shadow' || t === 'inset' ? 'inner-shadow' : 'drop-shadow',
        color: parseColor(o.color) ?? '#00000026',
        x: Number(o.x ?? o.offsetX ?? 0),
        y: Number(o.y ?? o.offsetY ?? 4),
        blur: Number(o.blur ?? 12),
        spread: Number(o.spread ?? 0),
      }];
    });
  }

  layout(v: unknown, current?: AutoLayout): AutoLayout | undefined {
    if (v === null || v === 'none' || v === false) return undefined;
    if (v === undefined) return current;
    const o = (typeof v === 'string' ? { direction: v } : v) as Record<string, unknown>;
    const dirRaw = String(o.direction ?? o.dir ?? o.flexDirection ?? current?.direction ?? 'vertical');
    const direction = /row|horiz/i.test(dirRaw) ? 'horizontal' : 'vertical';
    const pad = o.padding ?? o.pad;
    let padding = current?.padding ?? [0, 0, 0, 0];
    if (typeof pad === 'number') padding = [pad, pad, pad, pad];
    else if (Array.isArray(pad)) {
      const p = pad.map(Number);
      padding = p.length === 1 ? [p[0], p[0], p[0], p[0]] : p.length === 2 ? [p[0], p[1], p[0], p[1]] : p.length === 3 ? [p[0], p[1], p[2], p[1]] : [p[0], p[1], p[2], p[3]];
    } else if (pad && typeof pad === 'object') {
      const p = pad as Record<string, number>;
      padding = [p.top ?? p.y ?? 0, p.right ?? p.x ?? 0, p.bottom ?? p.y ?? 0, p.left ?? p.x ?? 0];
    }
    const norm = (s: unknown, fallback: string) => String(s ?? fallback).replace(/^flex-/, '').replace(/^space-around$|^space-evenly$/, 'space-between');
    const justify = norm(o.justify ?? o.justifyContent ?? o.main, current?.justify ?? 'start');
    const align = norm(o.align ?? o.alignItems ?? o.cross, current?.align ?? 'start');
    if (!['start', 'center', 'end', 'space-between'].includes(justify)) throw new SpecError(`justify inválido: ${justify}`);
    if (!['start', 'center', 'end', 'stretch', 'baseline'].includes(align)) throw new SpecError(`align inválido: ${align}`);
    return {
      direction,
      gap: Number(o.gap ?? o.spacing ?? current?.gap ?? 0),
      padding: padding as AutoLayout['padding'],
      justify: justify as AutoLayout['justify'],
      align: align as AutoLayout['align'],
      ...(o.wrap ?? current?.wrap ? { wrap: true } : {}),
      ...(o.crossGap !== undefined || o.rowGap !== undefined ? { crossGap: Number(o.crossGap ?? o.rowGap) } : current?.crossGap !== undefined ? { crossGap: current.crossGap } : {}),
    };
  }

  private sizeMode(v: unknown): 'fixed' | 'hug' | 'fill' | null {
    if (typeof v !== 'string') return null;
    if (/fill|stretch|100%|container/i.test(v)) return 'fill';
    if (/hug|auto|fit|content/i.test(v)) return 'hug';
    return null;
  }

  grids(v: unknown[]): LayoutGrid[] {
    return v.map((g) => {
      const o = g as Record<string, unknown>;
      const type = String(o.type ?? 'columns');
      return {
        type: (type === 'rows' ? 'rows' : type === 'grid' ? 'grid' : 'columns') as LayoutGrid['type'],
        count: Number(o.count ?? 12),
        size: Number(o.size ?? (type === 'grid' ? 8 : 64)),
        gutter: Number(o.gutter ?? 20),
        margin: Number(o.margin ?? 0),
        alignment: (String(o.alignment ?? 'stretch') as LayoutGrid['alignment']),
        color: parseColor(o.color) ?? (type === 'rows' ? '#3b82f61a' : '#d9583b1a'),
      };
    });
  }

  style(slot: StyleSlot, name: string): ReturnType<typeof findStyle> {
    const want = name.trim().toLowerCase();
    const s = allStyles(this.ed.doc).find((x) => x.id === name || x.name.toLowerCase() === want);
    if (!s) throw new SpecError(`estilo não encontrado: ${name}`);
    const okType = slot === 'text' ? 'text' : slot === 'effect' ? 'effect' : 'color';
    if (s.type !== okType) throw new SpecError(`o estilo ${name} não é de ${okType === 'color' ? 'cor' : okType === 'text' ? 'texto' : 'efeito'}`);
    return s;
  }

  // ── Componentes ────────────────────────────────────────────────────────────

  /** Componente (ou variante de um conjunto) pelo id ou nome. */
  findComponent(ref: string, variant?: Record<string, string>): { main: ContainerNode; library?: string } {
    const ed = this.ed;
    const id = this.ctx.refs.get(ref.replace(/^@/, '')) ?? ref;
    const want = ref.trim().toLowerCase();
    const pools: { list: ContainerNode[]; library?: string }[] = [
      { list: [...ed.model.index.components(), ...ed.model.index.componentSets()] },
      ...ed.doc.libraries.map((l) => ({ list: l.components.flatMap((c) => (c.type === 'component-set' ? [c, ...(c.children as ContainerNode[])] : [c])), library: l.id })),
    ];
    for (const pool of pools) {
      const hit = pool.list.find((c) => c.id === id) ?? pool.list.find((c) => c.name.toLowerCase() === want);
      if (!hit) continue;
      if (hit.type === 'component-set') {
        const v = variant ? findVariant(hit, variant) : (hit.children.find((c) => c.type === 'component') as ContainerNode | undefined);
        if (!v) throw new SpecError(`o conjunto ${hit.name} não tem variantes`);
        if (variant && Object.entries(variant).some(([k, val]) => v.variant?.[k] !== val)) this.ctx.warn(`variante exata não encontrada em “${hit.name}” (${variantName(variant)}); usei ${v.name}`);
        return { main: v, library: pool.library };
      }
      if (variant) {
        const set = ed.finder.setOf?.(hit.id, pool.library);
        if (set) {
          const v = findVariant(set, { ...(hit.variant ?? {}), ...variant });
          if (v) return { main: v, library: pool.library };
        }
      }
      return { main: hit, library: pool.library };
    }
    throw new SpecError(`componente não encontrado: ${ref} (veja list_components)`);
  }

  /** Chave de override a partir de um caminho de nomes ("Ícone > Rótulo") dentro do componente. */
  overrideKey(main: ContainerNode, path: string): { key: string; node: SceneNode } {
    const names = path.split(/\s*>\s*|\s*\/\/\s*/).map((s) => s.trim()).filter(Boolean);
    let list: SceneNode[] = main.children;
    // a chave só ganha um segmento ao entrar numa instância aninhada ("<instância>/<camada>");
    // dentro de frames comuns do componente, vale só o id da camada
    const prefix: string[] = [];
    let found: SceneNode | undefined;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      found = list.find((n) => n.name === name || n.id === name) ?? deepFind(list, name);
      if (!found) throw new SpecError(`camada “${name}” não existe dentro do componente ${main.name}`);
      if (found.type === 'instance' && i < names.length - 1) {
        prefix.push(found.id);
        const inner = this.ed.findComponent(found.componentId, found.library);
        if (!inner) throw new SpecError(`componente aninhado ausente em ${main.name}`);
        list = inner.children;
      } else list = 'children' in found ? found.children : [];
    }
    return { key: [...prefix, found!.id].join('/'), node: found! };
  }

  // ── Montagem ───────────────────────────────────────────────────────────────

  /**
   * Monta a camada (e as filhas). `parentLayout`: o pai tem auto layout.
   * `top`: fica direto na página (frames do topo ganham fundo branco e cortam o conteúdo).
   */
  build(spec: NodeSpec, parentLayout: boolean, top: boolean): SceneNode {
    if (!spec || typeof spec !== 'object' || !spec.type) throw new SpecError('cada camada precisa de "type"');
    const type = spec.type.toLowerCase().replace(/[_\s]/g, '-');
    let node: SceneNode;
    const geom = { x: num(spec.x, 0), y: num(spec.y, 0), width: typeof spec.width === 'number' ? spec.width : 100, height: typeof spec.height === 'number' ? spec.height : 100 };
    switch (type) {
      case 'frame':
      case 'component':
      case 'component-set':
      case 'group':
        node = this.container(type as 'frame', spec, geom, top);
        break;
      case 'text':
        node = this.text(spec, geom);
        break;
      case 'rect':
      case 'rectangle':
      case 'ellipse':
      case 'circle':
      case 'line':
      case 'polygon':
      case 'star':
        node = this.shape(type, spec, geom);
        break;
      case 'path':
      case 'vector':
        node = this.path(spec, geom);
        break;
      case 'icon':
        node = this.icon(spec, geom);
        break;
      case 'image': {
        const svg = typeof spec.src === 'string' ? this.ctx.svgImages.get(spec.src) : undefined;
        node = svg ? this.svgNode({ ...spec, type: 'svg', svg }, geom) : this.image(spec, geom);
        break;
      }
        break;
      case 'svg':
        node = this.svgNode(spec, geom);
        break;
      case 'instance':
        node = this.instance(spec, geom);
        break;
      default:
        throw new SpecError(`tipo desconhecido: ${spec.type}`);
    }
    if (spec.name) node.name = spec.name;
    this.common(node, spec, parentLayout);
    if (spec.ref) {
      const key = spec.ref.replace(/^@/, '');
      if (this.ctx.refs.has(key)) this.ctx.warn(`a referência “${key}” foi usada mais de uma vez; vale a última`);
      this.ctx.refs.set(key, node.id);
    }
    if (spec.link) this.ctx.links.push({ id: node.id, link: spec.link });
    return node;
  }

  private container(type: 'frame' | 'component' | 'component-set' | 'group', spec: NodeSpec, geom: { x: number; y: number; width: number; height: number }, top: boolean): ContainerNode {
    const isSet = type === 'component-set';
    const layout = this.layout(spec.layout ?? (isSet ? { direction: 'horizontal', gap: 20, padding: 20, wrap: true } : undefined));
    const n = createNode(type, geom, type === 'group' ? {} : { fills: top && !isSet ? [{ type: 'solid', color: '#ffffff' }] : [], clip: top && type !== 'component-set' });
    if (type === 'component-set') n.name = 'Componente';
    if (layout && type !== 'group') n.layout = layout;
    // propriedades de componente pelo nome (as filhas se ligam com "bind")
    const propIds = new Map<string, string>();
    if ((type === 'component' || isSet) && spec.properties?.length) {
      n.properties = spec.properties.map((p) => {
        const id = uid(8);
        propIds.set(p.name.toLowerCase(), id);
        const t = p.type === 'boolean' || p.type === 'swap' ? p.type : 'text';
        if (t === 'swap') return { id, name: p.name, type: 'swap', default: this.findComponent(String(p.default)).main.id } as ComponentProperty;
        return (t === 'boolean' ? { id, name: p.name, type: 'boolean', default: p.default !== false && p.default !== 'false' } : { id, name: p.name, type: 'text', default: String(p.default ?? '') }) as ComponentProperty;
      });
    }
    if (spec.description) n.description = spec.description;
    const kids = spec.children ?? [];
    n.children = kids.map((k) => {
      const child = this.build(k, !!n.layout, false);
      return child;
    });
    if (isSet) {
      n.children.forEach((c, i) => {
        if (c.type !== 'component') throw new SpecError('um conjunto de variantes só pode ter componentes dentro');
        const v = (kids[i].variant ?? parseVariantName(c.name)) as Record<string, string> | null;
        if (!v || !Object.keys(v).length) throw new SpecError(`a variante ${i + 1} precisa de "variant" (ex.: {"Tipo": "Primário"})`);
        c.variant = v;
        c.name = variantName(v);
      });
      if (!n.layout) this.ctx.warn('conjunto de variantes sem auto layout: as variantes ficam onde você posicionou');
    }
    // "bind" das filhas (em qualquer profundidade) para as propriedades pelo nome
    if (propIds.size) bindProps(n, kids, propIds, this.ctx);
    if (n.type === 'group') {
      // grupo: a caixa envolve as filhas (o layout recalcula), as filhas ficam relativas ao grupo
      n.fills = undefined;
    }
    return n;
  }

  textStyle(spec: NodeSpec, base?: TextStyle): TextStyle {
    const size = num(spec.size, base?.size ?? 16);
    let lineHeight: TextStyle['lineHeight'] = base?.lineHeight ?? 'auto';
    if (spec.lineHeight !== undefined) {
      if (spec.lineHeight === 'auto' || spec.lineHeight === 'normal') lineHeight = 'auto';
      else if (typeof spec.lineHeight === 'string' && spec.lineHeight.endsWith('%')) lineHeight = Math.round((size * parseFloat(spec.lineHeight)) / 100);
      else {
        const v = Number(spec.lineHeight);
        lineHeight = v > 0 && v < 4 ? Math.round(size * v * 10) / 10 : v; // 1.5 = multiplicador; 24 = px
      }
    }
    const family = spec.font ?? base?.family ?? 'Inter';
    if (spec.font && this.ed.host && !this.ed.host.fonts.has(spec.font)) this.ctx.warn(`a fonte “${spec.font}” não está instalada neste computador; o texto aparece com Inter (veja list_fonts)`);
    const align = spec.align ?? base?.align ?? 'left';
    return {
      family,
      weight: spec.weight !== undefined ? weightOf(spec.weight) : base?.weight ?? 400,
      ...(spec.italic ?? base?.italic ? { italic: true } : {}),
      size,
      lineHeight,
      letterSpacing: spec.letterSpacing ?? base?.letterSpacing ?? 0,
      align: (['left', 'center', 'right', 'justify'].includes(align) ? align : 'left') as TextStyle['align'],
      ...(spec.verticalAlign ?? base?.verticalAlign ? { verticalAlign: (spec.verticalAlign ?? base?.verticalAlign) as TextStyle['verticalAlign'] } : {}),
      ...(spec.decoration ?? base?.decoration ? { decoration: (spec.decoration ?? base?.decoration) as TextStyle['decoration'] } : {}),
      ...(spec.case ?? base?.case ? { case: (spec.case === 'uppercase' ? 'upper' : spec.case === 'lowercase' ? 'lower' : spec.case === 'capitalize' ? 'title' : spec.case ?? base?.case) as TextStyle['case'] } : {}),
    };
  }

  /** Pedaços com estilo próprio ("spans") → texto inteiro e trechos de estilo. */
  spans(list: unknown, base: TextStyle): { text: string; runs: TextRun[] } {
    if (!Array.isArray(list)) throw new SpecError('spans deve ser uma lista de { text, weight?, bold?, italic?, color?, size?, font?, letterSpacing?, decoration? }');
    const out: TextSpan[] = list.map((s, i) => {
      if (typeof s === 'string') return { text: s };
      if (!s || typeof s !== 'object' || typeof (s as SpanSpec).text !== 'string') throw new SpecError(`spans[${i}] precisa de "text"`);
      const sp = s as SpanSpec;
      const o: TextSpan = { text: sp.text };
      if (sp.bold !== undefined) o.weight = sp.bold ? Math.max(700, base.weight) : 400;
      if (sp.weight !== undefined) o.weight = weightOf(sp.weight);
      if (sp.italic !== undefined) o.italic = !!sp.italic;
      if (sp.size !== undefined) o.size = num(sp.size, base.size);
      if (sp.letterSpacing !== undefined) o.letterSpacing = Number(sp.letterSpacing) || 0;
      if (sp.font !== undefined) {
        o.family = String(sp.font);
        if (this.ed.host && !this.ed.host.fonts.has(o.family)) this.ctx.warn(`a fonte “${o.family}” não está instalada neste computador; o trecho aparece com Inter (veja list_fonts)`);
      }
      if (sp.decoration !== undefined) {
        const d = sp.decoration === 'line-through' ? 'strikethrough' : String(sp.decoration);
        if (!['none', 'underline', 'strikethrough'].includes(d)) throw new SpecError(`spans[${i}].decoration inválido: ${sp.decoration}`);
        o.decoration = d as TextStyle['decoration'];
      }
      if (sp.color !== undefined) {
        const p = this.paint(sp.color);
        if (!p || p.type !== 'solid') throw new SpecError(`spans[${i}].color precisa ser uma cor sólida`);
        if (p.variable) this.ctx.warn(`spans[${i}]: o trecho guarda a cor de ${sp.color}, sem ligação com a variável`);
        o.color = p.color;
      }
      return o;
    });
    return spansToRuns(out, base);
  }

  private text(spec: NodeSpec, geom: { x: number; y: number; width: number; height: number }): TextNode {
    const style = this.textStyle(spec);
    const fromSpans = spec.spans !== undefined ? this.spans(spec.spans, style) : null;
    const text = fromSpans ? fromSpans.text : String(spec.text ?? '');
    const auto = spec.autoResize === 'fixed' ? 'none' : (spec.autoResize as TextNode['autoResize'] | undefined);
    const widthMode = this.sizeMode(spec.width);
    const autoResize = auto ?? (typeof spec.width === 'number' || widthMode === 'fill' ? (typeof spec.height === 'number' ? 'none' : 'height') : 'width');
    const n = createNode('text', { ...geom, width: typeof spec.width === 'number' ? spec.width : 10, height: typeof spec.height === 'number' ? spec.height : Math.ceil(style.size * 1.3) }, {
      text,
      style,
      autoResize,
      name: text.replace(/\s+/g, ' ').slice(0, 40) || 'Texto',
      fills: this.paints(spec.color ?? spec.fill ?? '#1d1c1a'),
      ...(fromSpans?.runs.length ? { runs: fromSpans.runs } : {}),
    });
    return n;
  }

  private shape(type: string, spec: NodeSpec, geom: { x: number; y: number; width: number; height: number }): SceneNode {
    const t = (type === 'rectangle' ? 'rect' : type === 'circle' ? 'ellipse' : type) as 'rect' | 'ellipse' | 'line' | 'polygon' | 'star';
    if (t === 'line') {
      const n = createNode('line', { ...geom, height: 0 }, { name: 'Linha' });
      if (spec.stroke === undefined) n.strokes = this.strokes(spec.color ?? '#1d1c1a', true);
      return n;
    }
    const n = createNode(t, geom, {
      ...(t === 'polygon' ? { points: num(spec.points, 3) } : {}),
      ...(t === 'star' ? { points: num(spec.points, 5), innerRadius: num(spec.innerRadius, 0.38) } : {}),
    });
    if (spec.fill === undefined && spec.color !== undefined) n.fills = this.paints(spec.color);
    return n;
  }

  private path(spec: NodeSpec, geom: { x: number; y: number; width: number; height: number }): PathNode {
    if (!spec.d) throw new SpecError('caminho sem "d"');
    const host = this.ed.host;
    const norm = host?.normalizePath(spec.d, [1, 0, 0, 1, 0, 0], spec.fillRule === 'evenodd');
    if (!norm) throw new SpecError('caminho SVG inválido');
    // com largura/altura, o desenho é escalado para caber
    const sx = typeof spec.width === 'number' && norm.width ? spec.width / norm.width : 1;
    const sy = typeof spec.height === 'number' && norm.height ? spec.height / norm.height : sx;
    const fit = sx !== 1 || sy !== 1 ? host!.normalizePath(norm.d, [sx, 0, 0, sy, 0, 0], spec.fillRule === 'evenodd')! : norm;
    const n = createNode('path', { ...geom, width: Math.max(0.01, fit.width), height: Math.max(0.01, fit.height) }, {
      d: fit.d,
      name: 'Vetor',
      fills: this.paints(spec.fill ?? spec.color ?? '#1d1c1a'),
      strokes: [],
      ...(spec.fillRule === 'evenodd' ? { fillRule: 'evenodd' as const } : {}),
    });
    return n;
  }

  private icon(spec: NodeSpec, geom: { x: number; y: number; width: number; height: number }): PathNode {
    const name = String(spec.icon ?? spec.name ?? '');
    const shape = this.ctx.icons.get(name.toLowerCase());
    if (!shape) throw new SpecError(`ícone não encontrado: ${name} (use search_icons)`);
    const size = num(spec.size, typeof spec.width === 'number' ? spec.width : 24);
    const s = size / shape.size;
    const host = this.ed.host!;
    const norm = host.normalizePath(shape.d, [s, 0, 0, s, 0, 0], false, true);
    if (!norm) throw new SpecError(`não foi possível desenhar o ícone ${name}`);
    const color = spec.color ?? spec.fill ?? '#1d1c1a';
    const sw = num(spec.strokeWidth, shape.strokeWidth ?? 2) * s;
    const n = createNode('path', { ...geom, width: size, height: size }, {
      d: norm.d,
      name: spec.name ?? `Ícone/${name}`,
      fills: shape.stroke ? [] : this.paints(color),
      strokes: shape.stroke ? [{ paint: this.paint(color)!, width: Math.round(sw * 100) / 100, align: 'center', cap: 'round', join: 'round' }] : [],
      meta: { icon: name },
    });
    return n;
  }

  private image(spec: NodeSpec, geom: { x: number; y: number; width: number; height: number }): SceneNode {
    const img = this.ctx.images.get(String(spec.src));
    if (!img) throw new SpecError(`imagem não carregada: ${spec.src}`);
    let w = typeof spec.width === 'number' ? spec.width : img.width;
    let h = typeof spec.height === 'number' ? spec.height : typeof spec.width === 'number' ? Math.round((img.height * spec.width) / img.width) : img.height;
    if (typeof spec.width !== 'number' && typeof spec.height === 'number') w = Math.round((img.width * h) / img.height);
    const scale = Math.min(1, 1600 / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const fit = String(spec.fit ?? 'fill');
    return createNode('rect', { ...geom, width: w, height: h }, {
      name: 'Imagem',
      fills: [{ type: 'image', asset: img.key, scaleMode: (fit === 'contain' || fit === 'fit' ? 'fit' : fit === 'stretch' ? 'stretch' : fit === 'tile' ? 'tile' : 'fill') }],
    });
  }

  private svgNode(spec: NodeSpec, geom: { x: number; y: number; width: number; height: number }): ContainerNode {
    if (!spec.svg) throw new SpecError('svg vazio');
    // montado por automation/svg.ts (precisa do DOM e do Skia)
    const built = this.ctx.ed.host ? svgToNodes(this, spec, geom) : null;
    if (!built) throw new SpecError('não foi possível ler o SVG');
    return built;
  }

  private instance(spec: NodeSpec, geom: { x: number; y: number; width: number; height: number }): InstanceNode {
    if (!spec.component) throw new SpecError('instância sem "component"');
    const { main, library } = this.findComponent(spec.component, spec.variant);
    const n = createNode('instance', { ...geom, width: typeof spec.width === 'number' ? spec.width : main.width, height: typeof spec.height === 'number' ? spec.height : main.height }, {
      componentId: main.id,
      ...(library ? { library } : {}),
      name: main.name.includes('=') ? this.ed.finder.setOf?.(main.id, library)?.name ?? main.name : main.name,
    });
    this.instanceProps(n, main, library, spec);
    return n;
  }

  /** Props pelo nome e overrides por caminho de nomes. */
  instanceProps(n: InstanceNode, main: ContainerNode, library: string | undefined, spec: Pick<NodeSpec, 'props' | 'overrides'>): void {
    if (spec.props) {
      const defs = propertyDefs(main, this.ed.finder, library);
      const props: Record<string, string | boolean> = { ...(n.props ?? {}) };
      for (const [name, value] of Object.entries(spec.props)) {
        const d = defs.find((x) => x.name.toLowerCase() === name.toLowerCase() || x.id === name);
        if (!d) {
          throw new SpecError(`o componente ${main.name} não tem a propriedade “${name}” (tem: ${defs.map((x) => x.name).join(', ') || 'nenhuma'})`);
        }
        props[d.id] = d.type === 'boolean' ? value === true || value === 'true' : d.type === 'swap' ? this.findComponent(String(value)).main.id : String(value);
      }
      n.props = props;
    }
    if (spec.overrides) {
      const overrides: Record<string, InstanceOverride> = { ...(n.overrides ?? {}) };
      for (const [path, o] of Object.entries(spec.overrides)) {
        const { key, node } = this.overrideKey(main, path);
        const cur = { ...(overrides[key] ?? {}) };
        if (o.spans !== undefined) {
          if (node.type !== 'text') throw new SpecError(`“${path}” não é um texto`);
          const { text, runs } = this.spans(o.spans, node.style);
          cur.text = text;
          cur.runs = runs;
        } else if (o.text !== undefined) {
          if (node.type !== 'text') throw new SpecError(`“${path}” não é um texto`);
          cur.text = String(o.text);
          delete cur.runs;
        }
        if (o.fill !== undefined) cur.fills = this.paints(o.fill);
        if (o.stroke !== undefined) {
          const base = node.strokes ?? [];
          const list = this.strokes(o.stroke, node.type === 'path' || node.type === 'line');
          // parte do traço original (espessura, pontas, junções dos ícones) e troca só o que foi informado
          const onlyColor = typeof o.stroke === 'string' && !/\d\s*px|solid|dashed|dotted/i.test(o.stroke);
          const given = o.stroke && typeof o.stroke === 'object' && !Array.isArray(o.stroke) ? (o.stroke as Record<string, unknown>) : null;
          if (base.length && (onlyColor || given)) {
            cur.strokes = list.map((s, i) => ({
              ...base[Math.min(i, base.length - 1)],
              paint: s.paint,
              ...(given && (given.width ?? given.weight) !== undefined ? { width: s.width } : {}),
              ...(given && (given.align ?? given.position) !== undefined ? { align: s.align } : {}),
              ...(given?.dash !== undefined ? { dash: s.dash } : {}),
              ...(given?.sides !== undefined ? { sides: s.sides } : {}),
              ...(given?.cap !== undefined ? { cap: s.cap } : {}),
              ...(given?.join !== undefined ? { join: s.join } : {}),
            }));
          } else cur.strokes = list;
        }
        // "color": a cor que importa na camada (texto: letras; ícone de traço: o traço; resto: o preenchimento)
        if (o.color !== undefined) {
          if (node.type !== 'text' && node.strokes?.length && !node.fills?.length) cur.strokes = node.strokes.map((s) => ({ ...s, paint: this.paint(o.color)! }));
          else cur.fills = this.paints(o.color);
        }
        if (o.visible !== undefined) cur.visible = !!o.visible;
        if (o.opacity !== undefined) cur.opacity = Number(o.opacity);
        if (o.width !== undefined) cur.width = Number(o.width);
        if (o.height !== undefined) cur.height = Number(o.height);
        // instância aninhada: troca de componente ou de variante
        if (o.component !== undefined || o.variant !== undefined) {
          if (node.type !== 'instance') throw new SpecError(`“${path}” não é uma instância`);
          if (o.component !== undefined) cur.componentId = this.findComponent(o.component, o.variant).main.id;
          else {
            const nestedMain = this.ed.findComponent(node.componentId, node.library);
            const set = nestedMain && this.ed.finder.setOf?.(nestedMain.id, node.library);
            if (!set) throw new SpecError(`“${path}” não é instância de um conjunto de variantes`);
            const v = findVariant(set, { ...(nestedMain!.variant ?? {}), ...o.variant });
            if (!v) throw new SpecError(`variante não encontrada em ${set.name}`);
            cur.componentId = v.id;
          }
        }
        overrides[key] = cur;
      }
      n.overrides = overrides;
    }
  }

  /** O que vale para todo tipo: aparência, tamanho no auto layout, estilos, protótipo. */
  common(n: SceneNode, spec: NodeSpec, parentLayout: boolean): void {
    if (spec.fill !== undefined && n.type !== 'text' && n.type !== 'instance' && !(n.type === 'path' && spec.type === 'icon')) n.fills = this.paints(spec.fill);
    if (spec.fill !== undefined && n.type === 'instance') n.fills = this.paints(spec.fill);
    if (spec.stroke !== undefined) n.strokes = this.strokes(spec.stroke, n.type === 'line' || n.type === 'path');
    const bySide = this.sideStrokes(n.strokes ?? [], spec, n.type === 'line' || n.type === 'path');
    if (bySide) n.strokes = bySide;
    if (spec.radius !== undefined) n.cornerRadius = Array.isArray(spec.radius) ? (spec.radius.slice(0, 4).map(Number) as [number, number, number, number]) : Number(spec.radius);
    const fx = spec.effects ?? spec.shadow;
    if (fx !== undefined) n.effects = this.effects(fx);
    if (spec.opacity !== undefined) n.opacity = Math.max(0, Math.min(1, spec.opacity));
    if (spec.visible === false) n.visible = false;
    if (spec.locked) n.locked = true;
    if (spec.rotation) n.rotation = spec.rotation;
    if (spec.flipX) n.flipX = true;
    if (spec.flipY) n.flipY = true;
    if (spec.blendMode) n.blendMode = spec.blendMode as SceneNode['blendMode'];
    if ('children' in n && spec.clip !== undefined) n.clip = spec.clip;
    if (spec.absolute) n.absolute = true;
    if (spec.constraints) n.constraints = { horizontal: (spec.constraints.horizontal ?? 'left') as 'left', vertical: (spec.constraints.vertical ?? 'top') as 'top' };
    if (spec.grids && 'children' in n) n.grids = this.grids(spec.grids);
    if (spec.meta) n.meta = { ...(n.meta ?? {}), ...spec.meta };
    // tamanho: número = fixo; "fill" = preenche o pai com auto layout; "hug" = abraça o conteúdo
    const wm = this.sizeMode(spec.width), hm = this.sizeMode(spec.height);
    const hasLayout = 'layout' in n && !!n.layout;
    const sizing: Sizing = {
      horizontal: wm ?? (typeof spec.width === 'number' ? 'fixed' : hasLayout ? 'hug' : 'fixed'),
      vertical: hm ?? (typeof spec.height === 'number' ? 'fixed' : hasLayout ? 'hug' : 'fixed'),
    };
    if (n.type === 'text') {
      // texto: largura automática abraça; altura segue o modo de redimensionar
      sizing.horizontal = wm === 'fill' ? 'fill' : 'fixed';
      sizing.vertical = hm === 'fill' ? 'fill' : 'fixed';
    }
    if ((sizing.horizontal === 'fill' || sizing.vertical === 'fill') && !parentLayout && !spec.absolute) {
      this.ctx.warn(`“${n.name}” usa "fill", mas o pai não tem auto layout: o tamanho fica fixo`);
    }
    if (sizing.horizontal !== 'fixed' || sizing.vertical !== 'fixed') n.sizing = sizing;
    if (spec.minWidth && n.width < spec.minWidth) n.width = spec.minWidth;
    // estilos pelo nome (o valor também fica gravado no nó)
    const slots: [StyleSlot, string | undefined][] = [['fill', spec.fillStyle], ['stroke', spec.strokeStyle], ['effect', spec.effectStyle], ['text', spec.textStyle]];
    for (const [slot, name] of slots) {
      if (!name) continue;
      const st = this.style(slot, name)!;
      if (slot === 'text' && n.type !== 'text') throw new SpecError('textStyle só vale para textos');
      Object.assign(n, stylePatch(n, st, slot));
      // alinhamento e o que vier explícito continuam valendo por cima do estilo de texto
      if (slot === 'text' && n.type === 'text') n.style = { ...n.style, ...(spec.align ? { align: spec.align as TextStyle['align'] } : {}) };
    }
  }

  /** Mudanças (operações) para alterar uma camada que já existe. */
  patch(n: SceneNode, props: NodeSpec | Omit<NodeSpec, 'type'>): Op[] {
    const p = props as NodeSpec;
    const out: Record<string, unknown> = {};
    if (p.children) throw new SpecError('"update" não troca filhas; use create/delete/replace');
    const set = (k: string, v: unknown) => (out[k] = v);
    if (p.name !== undefined) set('name', p.name);
    if (p.x !== undefined) set('x', p.x);
    if (p.y !== undefined) set('y', p.y);
    if (typeof p.width === 'number') set('width', p.width);
    if (typeof p.height === 'number') set('height', p.height);
    const wm = this.sizeMode(p.width), hm = this.sizeMode(p.height);
    if (wm || hm || typeof p.width === 'number' || typeof p.height === 'number') {
      const cur = n.sizing ?? { horizontal: 'fixed', vertical: 'fixed' };
      const next = { horizontal: wm ?? (typeof p.width === 'number' ? 'fixed' : cur.horizontal), vertical: hm ?? (typeof p.height === 'number' ? 'fixed' : cur.vertical) } as Sizing;
      if (next.horizontal !== cur.horizontal || next.vertical !== cur.vertical) set('sizing', next.horizontal === 'fixed' && next.vertical === 'fixed' ? undefined : next);
      if (n.type === 'text' && (typeof p.width === 'number' || wm === 'fill') && !p.autoResize && n.autoResize === 'width') set('autoResize', 'height');
    }
    for (const k of ['rotation', 'opacity', 'visible', 'locked', 'flipX', 'flipY', 'blendMode', 'absolute', 'clip', 'description'] as const) if (p[k] !== undefined) set(k, p[k]);
    if (p.fill !== undefined && n.type !== 'text') set('fills', this.paints(p.fill));
    if (n.type === 'text' && (p.color !== undefined || p.fill !== undefined)) set('fills', this.paints(p.color ?? p.fill));
    if (p.stroke !== undefined) set('strokes', this.strokes(p.stroke, n.type === 'line' || n.type === 'path'));
    const bySide = this.sideStrokes(p.stroke !== undefined ? this.strokes(p.stroke, n.type === 'line' || n.type === 'path') : n.strokes ?? [], p, n.type === 'line' || n.type === 'path');
    if (bySide) set('strokes', bySide);
    if (p.radius !== undefined) set('cornerRadius', Array.isArray(p.radius) ? p.radius.slice(0, 4).map(Number) : Number(p.radius));
    if (p.effects !== undefined || p.shadow !== undefined) set('effects', this.effects(p.effects ?? p.shadow));
    if (p.layout !== undefined && 'children' in n) set('layout', this.layout(p.layout, n.layout));
    if (p.grids && 'children' in n) set('grids', this.grids(p.grids));
    if (p.constraints) set('constraints', { horizontal: p.constraints.horizontal ?? 'left', vertical: p.constraints.vertical ?? 'top' });
    if (p.meta) set('meta', { ...(n.meta ?? {}), ...p.meta });
    if (n.type === 'text') {
      const textKeys = ['font', 'size', 'weight', 'italic', 'lineHeight', 'letterSpacing', 'align', 'verticalAlign', 'decoration', 'case'] as const;
      const style = textKeys.some((k) => p[k] !== undefined) ? this.textStyle(p, n.style) : n.style;
      if (style !== n.style) set('style', style);
      if (p.spans !== undefined) {
        const { text, runs } = this.spans(p.spans, style);
        set('text', text);
        set('runs', runs.length ? runs : undefined);
      } else {
        // texto trocado: os trechos acompanham o que não mudou; o que vale para o texto inteiro sai dos trechos
        let runs = p.text !== undefined ? runsAfterEdit(n.runs, n.text, String(p.text)) : n.runs ?? [];
        const len = p.text !== undefined ? String(p.text).length : n.text.length;
        const cleared = ([['font', 'family'], ['size', 'size'], ['weight', 'weight'], ['italic', 'italic'], ['letterSpacing', 'letterSpacing'], ['decoration', 'decoration'], ['color', 'color'], ['fill', 'color']] as const).filter(([k]) => p[k] !== undefined).map(([, a]) => a);
        if (cleared.length) runs = clearRunAttr(runs, len, cleared, style);
        if (p.text !== undefined) set('text', String(p.text));
        if (n.runs?.length && JSON.stringify(runs) !== JSON.stringify(n.runs)) set('runs', runs.length ? runs : undefined);
      }
      if (p.autoResize) set('autoResize', p.autoResize === 'fixed' ? 'none' : p.autoResize);
    }
    if ((n.type === 'polygon' || n.type === 'star') && p.points !== undefined) set('points', p.points);
    if (n.type === 'star' && p.innerRadius !== undefined) set('innerRadius', p.innerRadius);
    if (n.type === 'path' && p.d) {
      const norm = this.ed.host?.normalizePath(p.d, [1, 0, 0, 1, 0, 0], (p.fillRule ?? (n as PathNode).fillRule) === 'evenodd');
      if (!norm) throw new SpecError('caminho SVG inválido');
      set('d', norm.d);
      set('width', norm.width);
      set('height', norm.height);
    }
    if (n.type === 'path' && p.icon) {
      // trocar o ícone mantém a cor atual (a não ser que venha outra)
      const keep = n.strokes?.[0]?.paint ?? n.fills?.[0];
      const color = p.color ?? p.fill ?? (keep?.type === 'solid' ? (keep.variable ? `$${findVariableNameById(this.ed, keep.variable) ?? ''}` : keep.color) : undefined);
      const tmp = this.icon({ ...p, type: 'icon', size: p.size ?? n.width, ...(color && color !== '$' ? { color } : {}) }, { x: n.x, y: n.y, width: n.width, height: n.height });
      for (const k of ['d', 'width', 'height', 'strokes', 'fills', 'meta'] as const) set(k, tmp[k]);
    }
    if (n.type === 'path' && n.meta?.icon && p.color !== undefined && !p.icon) {
      if (n.strokes?.length) set('strokes', n.strokes.map((s) => ({ ...s, paint: this.paint(p.color)! })));
      else set('fills', this.paints(p.color));
    }
    if (n.type === 'instance') {
      if (p.component || p.variant) {
        const main0 = this.ed.findComponent(n.componentId, n.library);
        const { main, library } = p.component ? this.findComponent(p.component, p.variant) : this.findComponent(n.componentId, { ...(main0?.variant ?? {}), ...p.variant });
        set('componentId', main.id);
        set('library', library);
      }
      if (p.props || p.overrides) {
        const tmp = clone(n);
        const main = this.ed.findComponent(String(out.componentId ?? n.componentId), (out.library as string | undefined) ?? n.library);
        if (!main) throw new SpecError('componente da instância não encontrado');
        this.instanceProps(tmp, main, n.library, p);
        if (p.props) set('props', tmp.props);
        if (p.overrides) set('overrides', tmp.overrides);
      }
    }
    if (n.type === 'component' && p.variant) {
      set('variant', p.variant);
      set('name', variantName(p.variant));
    }
    const ops: Op[] = Object.entries(out).map(([key, value]) => ({ op: 'set', id: n.id, key, value }) as Op);
    // estilos pelo nome
    const slots: [StyleSlot, string | undefined][] = [['fill', p.fillStyle], ['stroke', p.strokeStyle], ['effect', p.effectStyle], ['text', p.textStyle]];
    for (const [slot, name] of slots) {
      if (!name) continue;
      const patch = stylePatch(n, this.style(slot, name)!, slot);
      if (patch) for (const [key, value] of Object.entries(patch)) ops.push({ op: 'set', id: n.id, key, value });
    }
    if (p.link) this.ctx.links.push({ id: n.id, link: p.link });
    return ops;
  }

  /** Interação do protótipo a partir da descrição curta. */
  interaction(link: NonNullable<NodeSpec['link']>): Interaction {
    const action = (link.action ?? 'navigate') as Interaction['action'];
    if (!['navigate', 'overlay', 'back', 'close'].includes(action)) throw new SpecError(`ação de protótipo inválida: ${action}`);
    const target = action === 'navigate' || action === 'overlay' ? this.ctx.id(link.to) : undefined;
    return {
      trigger: 'click',
      action,
      ...(target ? { target } : {}),
      transition: (link.transition ?? (action === 'overlay' ? 'dissolve' : 'instant')) as Interaction['transition'],
      duration: link.duration ?? 250,
      ...(action === 'overlay' ? { overlay: { position: (link.position ?? 'center') as NonNullable<Interaction['overlay']>['position'], ...(link.background !== undefined ? { background: parseColor(link.background) ?? '' } : {}), closeOutside: link.closeOutside !== false } } : {}),
    };
  }
}


function findVariableNameById(ed: Editor, id: string): string | undefined {
  for (const c of allCollections(ed.doc)) for (const v of c.variables) if (v.id === id) return v.name;
  return undefined;
}

function num(v: unknown, d: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : d;
}

function deepFind(list: SceneNode[], name: string): SceneNode | undefined {
  for (const n of list) {
    if (n.name === name || n.id === name) return n;
    if ('children' in n) {
      const f = deepFind(n.children, name);
      if (f) return f;
    }
  }
  return undefined;
}

function parseVariantName(name: string): Record<string, string> | null {
  if (!name.includes('=')) return null;
  const out: Record<string, string> = {};
  for (const part of name.split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    if (k && v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Liga as camadas com "bind" às propriedades do componente (pelo nome da propriedade). */
function bindProps(root: ContainerNode, specs: NodeSpec[], propIds: Map<string, string>, ctx: BuildContext): void {
  const visit = (nodes: SceneNode[], sp: NodeSpec[]) => {
    nodes.forEach((n, i) => {
      const s = sp[i];
      if (!s) return;
      if (s.bind) {
        const refs: Record<string, string> = {};
        for (const [slot, prop] of Object.entries(s.bind)) {
          const id = propIds.get(String(prop).toLowerCase());
          if (!id) throw new SpecError(`propriedade “${prop}” não declarada em "properties" do componente ${root.name}`);
          if (slot === 'text' && n.type !== 'text') throw new SpecError(`bind.text só vale para textos (${n.name})`);
          if (slot === 'component' && n.type !== 'instance') throw new SpecError(`bind.component só vale para instâncias (${n.name})`);
          refs[slot] = id;
          // a camada ligada mostra o padrão da propriedade, como as instâncias novas
          const def = root.properties?.find((p) => p.id === id);
          if (slot === 'text' && def?.type === 'text' && n.type === 'text') n.text = def.default;
          if (slot === 'visible' && def?.type === 'boolean') n.visible = def.default;
        }
        n.propRefs = refs;
      }
      if ('children' in n && s.children && n.type !== 'component') visit(n.children, s.children);
      // conjunto: cada variante (componente) também pode ligar filhas às propriedades do conjunto
      if (n.type === 'component' && root.type === 'component-set' && s.children) visit(n.children, s.children);
    });
  };
  visit(root.children, specs);
  if (!ctx) return;
}
