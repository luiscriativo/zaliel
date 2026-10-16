// Importação de arquivos .fig (contêiner "fig-kiwi").
// O arquivo traz o próprio esquema; aqui os nós são convertidos para o modelo do Zaliel.
import type {
  AutoLayout,
  BlendMode,
  ComponentProperty,
  Constraints,
  ContainerNode,
  Effect,
  InstanceNode,
  InstanceOverride,
  Interaction,
  LayoutGrid,
  Page,
  Paint,
  PathNode,
  SceneNode,
  ShapeNode,
  Stroke,
  Style,
  TextNode,
  TextStyle,
  Transition,
  Variable,
  VariableCollection,
  VariableValue,
} from '../types';
import { decodeMessage, decodeSchema, type KiwiValue } from './kiwi';
import { bakePath, countNodes, imageMime, makeAsset, newDocument, placement, rgbaHex, r2, weightFromStyle, Warnings, type ImportResult } from './common';
import { invert } from '../util';
import { variantName } from '../components';
import { textStyleOf } from '../styles';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = Record<string, any>;

export interface FigContainer {
  /** Esquema Kiwi já descomprimido. */
  schema: Uint8Array;
  /** Mensagem Kiwi já descomprimida. */
  data: Uint8Array;
  /** Imagens do arquivo: hash (hex) → bytes. */
  images: Record<string, Uint8Array>;
  /** Fundo da tela, quando o arquivo informa. */
  background?: string;
}

export interface Decompressors {
  inflateRaw: (b: Uint8Array) => Uint8Array;
  zstd?: (b: Uint8Array) => Uint8Array;
}

const ZIP = 0x04034b50;

/** Separa o arquivo .fig (solto ou dentro do .zip) em esquema, dados e imagens. */
export function readFigContainer(bytes: Uint8Array, z: Decompressors, readZip: (b: Uint8Array, inflate: (b: Uint8Array) => Uint8Array) => Map<string, Uint8Array>): FigContainer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fig = bytes;
  const images: Record<string, Uint8Array> = {};
  let background: string | undefined;
  if (bytes.length > 4 && view.getUint32(0, true) === ZIP) {
    const files = readZip(bytes, z.inflateRaw);
    const canvas = files.get('canvas.fig');
    if (!canvas) throw new Error('o arquivo compactado não tem o desenho (canvas.fig)');
    fig = canvas;
    for (const [name, data] of files) if (name.startsWith('images/')) images[name.slice(7)] = data;
    const meta = files.get('meta.json');
    if (meta) {
      try {
        const m = JSON.parse(new TextDecoder().decode(meta));
        if (m?.client_meta?.background_color) background = rgbaHex(m.client_meta.background_color);
      } catch {
        /* meta opcional */
      }
    }
  }
  const head = new TextDecoder().decode(fig.subarray(0, 8));
  if (head !== 'fig-kiwi' && head !== 'fig-jam.') throw new Error('não é um arquivo .fig reconhecido');
  const fv = new DataView(fig.buffer, fig.byteOffset, fig.byteLength);
  const chunks: Uint8Array[] = [];
  let off = 12;
  while (off + 4 <= fig.length) {
    const len = fv.getUint32(off, true);
    chunks.push(fig.subarray(off + 4, off + 4 + len));
    off += 4 + len;
  }
  if (chunks.length < 2) throw new Error('arquivo .fig incompleto');
  const unpack = (c: Uint8Array) => {
    if (c[0] === 0x28 && c[1] === 0xb5 && c[2] === 0x2f && c[3] === 0xfd) {
      if (!z.zstd) throw new Error('este arquivo usa compressão zstd, que não está disponível aqui');
      return z.zstd(c);
    }
    return z.inflateRaw(c);
  };
  return { schema: unpack(chunks[0]), data: unpack(chunks[1]), images, background };
}

// ── Conversão ────────────────────────────────────────────────────────────────

const key = (g: any): string => (g ? `${g.sessionID}:${g.localID}` : '');
const BLEND: Record<string, BlendMode> = {
  NORMAL: 'normal', PASS_THROUGH: 'normal', MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay', DARKEN: 'darken', LIGHTEN: 'lighten',
  COLOR_DODGE: 'color-dodge', LINEAR_DODGE: 'color-dodge', COLOR_BURN: 'color-burn', LINEAR_BURN: 'color-burn', HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light',
  DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity',
};
const H_CONSTRAINT: Record<string, Constraints['horizontal']> = { MIN: 'left', MAX: 'right', CENTER: 'center', STRETCH: 'left-right', SCALE: 'scale' };
const V_CONSTRAINT: Record<string, Constraints['vertical']> = { MIN: 'top', MAX: 'bottom', CENTER: 'center', STRETCH: 'top-bottom', SCALE: 'scale' };
const TRANSITIONS: Record<string, Transition> = {
  INSTANT_TRANSITION: 'instant', DISSOLVE: 'dissolve', SMART_ANIMATE: 'dissolve', SCROLL_ANIMATE: 'dissolve',
  SLIDE_FROM_RIGHT: 'slide-left', SLIDE_FROM_LEFT: 'slide-right', SLIDE_FROM_BOTTOM: 'slide-up', SLIDE_FROM_TOP: 'slide-down',
  PUSH_FROM_RIGHT: 'slide-left', PUSH_FROM_LEFT: 'slide-right', PUSH_FROM_BOTTOM: 'slide-up', PUSH_FROM_TOP: 'slide-down',
  MOVE_FROM_RIGHT: 'slide-left', MOVE_FROM_LEFT: 'slide-right', MOVE_FROM_BOTTOM: 'slide-up', MOVE_FROM_TOP: 'slide-down',
};

/** Caminho SVG a partir de um blob de comandos de geometria (comando + floats LE). */
export function commandsToPath(blob: Uint8Array): string {
  const v = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const out: string[] = [];
  const f = (o: number) => String(Math.round(v.getFloat32(o, true) * 1000) / 1000);
  let i = 0;
  while (i < blob.length) {
    const cmd = blob[i++];
    if (cmd === 0) out.push('Z');
    else if (cmd === 1) { out.push(`M${f(i)} ${f(i + 4)}`); i += 8; }
    else if (cmd === 2) { out.push(`L${f(i)} ${f(i + 4)}`); i += 8; }
    else if (cmd === 3) { out.push(`Q${f(i)} ${f(i + 4)} ${f(i + 8)} ${f(i + 12)}`); i += 16; }
    else if (cmd === 4) { out.push(`C${f(i)} ${f(i + 4)} ${f(i + 8)} ${f(i + 12)} ${f(i + 16)} ${f(i + 20)}`); i += 24; }
    else break;
  }
  return out.join(' ');
}

/**
 * Caminho central de uma rede de vetores (vértices + segmentos com tangentes),
 * escalado para o tamanho da camada. Usado para traços abertos.
 */
export function vectorNetworkToPath(blob: Uint8Array, sx: number, sy: number): string {
  const v = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const nv = v.getUint32(0, true), ns = v.getUint32(4, true);
  if (12 + nv * 12 + ns * 28 > blob.length) return '';
  const vx: number[] = [], vy: number[] = [];
  let o = 12;
  for (let i = 0; i < nv; i++, o += 12) {
    vx.push(v.getFloat32(o + 4, true) * sx);
    vy.push(v.getFloat32(o + 8, true) * sy);
  }
  const r = (n: number) => String(Math.round(n * 1000) / 1000);
  const out: string[] = [];
  let last = -1, first = -1;
  for (let i = 0; i < ns; i++, o += 28) {
    const a = v.getUint32(o + 4, true), b = v.getUint32(o + 16, true);
    if (a >= nv || b >= nv) continue;
    const t1x = v.getFloat32(o + 8, true) * sx, t1y = v.getFloat32(o + 12, true) * sy;
    const t2x = v.getFloat32(o + 20, true) * sx, t2y = v.getFloat32(o + 24, true) * sy;
    if (a !== last) {
      out.push(`M${r(vx[a])} ${r(vy[a])}`);
      first = a;
    }
    if (t1x || t1y || t2x || t2y) out.push(`C${r(vx[a] + t1x)} ${r(vy[a] + t1y)} ${r(vx[b] + t2x)} ${r(vy[b] + t2y)} ${r(vx[b])} ${r(vy[b])}`);
    else out.push(`L${r(vx[b])} ${r(vy[b])}`);
    if (b === first) out.push('Z');
    last = b;
  }
  return out.join(' ');
}

/**
 * Campos que a conversão não usa: dados derivados (glifos, layout pré-calculado), histórico
 * e dados de plugins. Pulá-los na leitura deixa arquivos grandes várias vezes mais rápidos.
 */
export const FIG_SKIP = [
  'derivedTextData', 'derivedSymbolData', 'editInfo', 'pluginData', 'pluginRelaunchData', 'fontMetaData', 'glyphs', 'baselines',
  'decorations', 'minimalGlyphs', 'emojiImageSet', 'libraryMoveHistory', 'parameterConsumptionMap', 'fontVariations', 'layoutSize',
  'logicalIndexToCharacterOffsetMap', 'fallbackFonts', 'ancestorPathBeforeDeletion', 'sharedPluginData', 'annotations', 'measurements',
];

/** Converte um .fig já separado (veja `readFigContainer`) num documento do Zaliel. */
export function figToDocument(input: FigContainer, name: string): ImportResult {
  const schema = decodeSchema(input.schema);
  const msg = decodeMessage(schema, input.data, 'Message', FIG_SKIP) as N;
  return convertMessage(msg, input.images, name, input.background);
}

export function convertMessage(msg: N, images: Record<string, Uint8Array>, name: string, background?: string): ImportResult {
  const warn = new Warnings();
  const fonts = new Set<string>();
  const counts: Record<string, number> = {};
  const blobs: Uint8Array[] = ((msg.blobs ?? []) as N[]).map((b) => b.bytes as Uint8Array);
  const all = ((msg.nodeChanges ?? []) as N[]).filter((n) => n.phase !== 'REMOVED' && n.guid);
  const byId = new Map<string, N>();
  for (const n of all) byId.set(key(n.guid), n);
  const kids = new Map<string, N[]>();
  for (const n of all) {
    const p = key(n.parentIndex?.guid);
    if (!p) continue;
    let l = kids.get(p);
    if (!l) kids.set(p, (l = []));
    l.push(n);
  }
  for (const l of kids.values()) l.sort((a, b) => (a.parentIndex.position < b.parentIndex.position ? -1 : a.parentIndex.position > b.parentIndex.position ? 1 : 0));
  const childrenOf = (n: N) => kids.get(key(n.guid)) ?? [];
  // chaves de biblioteca (assetRef) → guid local
  const byAssetKey = new Map<string, string>();
  for (const n of all) if (typeof n.key === 'string') byAssetKey.set(n.key, key(n.guid));
  const refId = (r: any): string | undefined => (r?.guid ? key(r.guid) : r?.assetRef?.key ? byAssetKey.get(r.assetRef.key) : undefined);

  // ── Variáveis ──
  const collections = new Map<string, VariableCollection>();
  for (const n of all) {
    if (n.type !== 'VARIABLE_SET') continue;
    const modes = ((n.variableSetModes ?? []) as N[]).map((m) => ({ id: key(m.id), name: String(m.name ?? 'Modo') }));
    if (!modes.length) modes.push({ id: 'padrao', name: 'Padrão' });
    collections.set(key(n.guid), { id: key(n.guid), name: n.name || 'Variáveis', modes, defaultMode: modes[0].id, variables: [] });
  }
  const variableIds = new Set<string>();
  for (const n of all) {
    if (n.type !== 'VARIABLE') continue;
    const setId = refId(n.variableSetID);
    const col = setId ? collections.get(setId) : undefined;
    if (!col) continue;
    const type = n.variableResolvedType === 'COLOR' ? 'color' : n.variableResolvedType === 'FLOAT' ? 'number' : n.variableResolvedType === 'BOOLEAN' ? 'boolean' : 'string';
    const values: Record<string, VariableValue> = {};
    for (const e of (n.variableDataValues?.entries ?? []) as N[]) {
      const val = e.variableData?.value ?? {};
      let out: VariableValue | undefined;
      if (val.alias) {
        const a = refId(val.alias);
        if (a) out = { alias: a };
      } else if (val.colorValue) out = rgbaHex(val.colorValue);
      else if (typeof val.floatValue === 'number') out = r2(val.floatValue);
      else if (typeof val.boolValue === 'boolean') out = val.boolValue;
      else if (typeof val.textValue === 'string') out = val.textValue;
      if (out !== undefined) values[key(e.modeID)] = out;
    }
    if (!Object.keys(values).length) continue;
    // modo padrão sempre preenchido
    if (!(col.defaultMode in values)) values[col.defaultMode] = Object.values(values)[0];
    col.variables.push({ id: key(n.guid), name: n.name || 'variável', type, values } as Variable);
    variableIds.add(key(n.guid));
  }

  // ── Imagens ──
  const assets: Record<string, ReturnType<typeof makeAsset> & object> = {};
  const assetFor = (hash: unknown): string | null => {
    if (!(hash instanceof Uint8Array)) return null;
    const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
    if (assets[hex]) return hex;
    const bytes = images[hex];
    if (!bytes || !imageMime(bytes)) return null;
    const a = makeAsset(bytes);
    if (!a) return null;
    assets[hex] = a;
    return hex;
  };

  // ── Pinturas, contornos e efeitos ──
  const paint = (p: N, colorAlias = true): Paint | null => {
    const common: Partial<Paint> = {};
    if (p.visible === false) common.visible = false;
    if (typeof p.opacity === 'number' && p.opacity < 1) common.opacity = r2(p.opacity * 1000) / 1000;
    if (p.blendMode && BLEND[p.blendMode] && BLEND[p.blendMode] !== 'normal') common.blendMode = BLEND[p.blendMode];
    switch (p.type) {
      case 'SOLID': {
        const out: Paint = { type: 'solid', color: rgbaHex(p.color), ...common } as Paint;
        const v = colorAlias ? refId(p.colorVar?.value?.alias) : undefined;
        if (v && variableIds.has(v)) (out as Extract<Paint, { type: 'solid' }>).variable = v;
        return out;
      }
      case 'GRADIENT_LINEAR':
      case 'GRADIENT_RADIAL':
      case 'GRADIENT_ANGULAR':
      case 'GRADIENT_DIAMOND': {
        const t = p.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
        const inv = invert([t.m00, t.m10, t.m01, t.m11, t.m02, t.m12]);
        const at = (x: number, y: number) => ({ x: r2((inv[0] * x + inv[2] * y + inv[4]) * 1000) / 1000, y: r2((inv[1] * x + inv[3] * y + inv[5]) * 1000) / 1000 });
        const linear = p.type === 'GRADIENT_LINEAR';
        const handles = linear ? { from: at(0, 0.5), to: at(1, 0.5) } : { from: at(0.5, 0.5), to: at(1, 0.5) };
        const stops = ((p.stops ?? []) as N[]).map((s) => ({ offset: r2((s.position ?? 0) * 1000) / 1000, color: rgbaHex(s.color) }));
        if (p.type === 'GRADIENT_DIAMOND') warn.add('Gradientes em losango viraram radiais');
        return { type: linear ? 'linear' : p.type === 'GRADIENT_ANGULAR' ? 'angular' : 'radial', stops, handles, ...common } as Paint;
      }
      case 'IMAGE': {
        const asset = assetFor(p.image?.hash);
        if (!asset) {
          warn.add('Imagens que não estavam guardadas no arquivo ficaram de fora');
          return null;
        }
        const mode = p.imageScaleMode === 'FIT' ? 'fit' : p.imageScaleMode === 'TILE' ? 'tile' : p.imageScaleMode === 'STRETCH' ? 'stretch' : 'fill';
        return { type: 'image', asset, scaleMode: mode, ...common } as Paint;
      }
      default:
        if (p.type) warn.add(`Pinturas do tipo ${String(p.type).toLowerCase()} foram ignoradas`);
        return null;
    }
  };
  const paints = (list: unknown): Paint[] => ((list ?? []) as N[]).map((p) => paint(p)).filter(Boolean) as Paint[];
  const strokes = (n: N): Stroke[] | undefined => {
    const list = paints(n.strokePaints);
    if (!list.length || !n.strokeWeight) return undefined;
    const align = n.strokeAlign === 'INSIDE' ? 'inside' : n.strokeAlign === 'OUTSIDE' ? 'outside' : 'center';
    const cap = n.strokeCap === 'ROUND' ? 'round' : n.strokeCap === 'SQUARE' ? 'square' : undefined;
    const join = n.strokeJoin === 'ROUND' ? 'round' : n.strokeJoin === 'BEVEL' ? 'bevel' : undefined;
    const dash = Array.isArray(n.dashPattern) && n.dashPattern.length ? (n.dashPattern as number[]).map(r2) : undefined;
    return list.map((p) => ({ paint: p, width: r2(n.strokeWeight), align, ...(cap ? { cap } : {}), ...(join ? { join } : {}), ...(dash ? { dash } : {}) }) as Stroke);
  };
  const effects = (list: unknown): Effect[] | undefined => {
    const out: Effect[] = [];
    for (const e of (list ?? []) as N[]) {
      const visible = e.visible === false ? { visible: false as const } : {};
      if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
        out.push({ type: e.type === 'DROP_SHADOW' ? 'drop-shadow' : 'inner-shadow', color: rgbaHex(e.color), x: r2(e.offset?.x ?? 0), y: r2(e.offset?.y ?? 0), blur: r2(e.radius ?? 0), ...(e.spread ? { spread: r2(e.spread) } : {}), ...visible });
      } else if (e.type === 'FOREGROUND_BLUR' || e.type === 'BACKGROUND_BLUR') {
        out.push({ type: e.type === 'FOREGROUND_BLUR' ? 'layer-blur' : 'background-blur', radius: r2(e.radius ?? 0), ...visible });
      }
    }
    return out.length ? out : undefined;
  };

  // ── Estilos ──
  const styles: Style[] = [];
  for (const n of all) {
    if (!n.styleType) continue;
    const id = key(n.guid);
    const nameS = n.name || 'Estilo';
    if (n.styleType === 'FILL') {
      const list = paints(n.fillPaints);
      if (list.length) styles.push({ id, name: nameS, type: 'color', paints: list });
    } else if (n.styleType === 'TEXT') styles.push({ id, name: nameS, type: 'text', text: textStyleOf(textStyle(n)) });
    else if (n.styleType === 'EFFECT') {
      const fx = effects(n.effects);
      if (fx) styles.push({ id, name: nameS, type: 'effect', effects: fx });
    }
  }
  const styleRef = (r: any) => {
    const id = refId(r);
    return id && styles.some((s) => s.id === id) ? id : undefined;
  };

  function textStyle(n: N): TextStyle {
    const size = n.fontSize ?? 12;
    const st: TextStyle = { family: n.fontName?.family || 'Inter', weight: weightFromStyle(n.fontName?.style), size: r2(size) };
    if (/italic|oblique/i.test(n.fontName?.style ?? '')) st.italic = true;
    const lh = n.lineHeight;
    if (lh && lh.units === 'PIXELS' && lh.value) st.lineHeight = r2(lh.value);
    else if (lh && lh.units === 'PERCENT' && lh.value && lh.value !== 100) st.lineHeight = r2((size * lh.value) / 100);
    else if (lh && lh.units === 'RAW' && lh.value) st.lineHeight = r2(size * lh.value);
    else st.lineHeight = 'auto';
    const ls = n.letterSpacing;
    if (ls?.value) st.letterSpacing = r2(ls.units === 'PERCENT' ? (size * ls.value) / 100 : ls.value);
    const align = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' }[n.textAlignHorizontal as string];
    if (align && align !== 'left') st.align = align as TextStyle['align'];
    const valign = { TOP: 'top', CENTER: 'middle', BOTTOM: 'bottom' }[n.textAlignVertical as string];
    if (valign && valign !== 'top') st.verticalAlign = valign as TextStyle['verticalAlign'];
    if (n.textDecoration === 'UNDERLINE') st.decoration = 'underline';
    if (n.textDecoration === 'STRIKETHROUGH') st.decoration = 'strikethrough';
    const kase = { UPPER: 'upper', LOWER: 'lower', TITLE: 'title' }[n.textCase as string];
    if (kase) st.case = kase as TextStyle['case'];
    return st;
  }

  // ── Propriedades de componente (ids de definições filhas apontam para a do conjunto) ──
  const propAlias = new Map<string, string>();
  for (const n of all) for (const d of (n.componentPropDefs ?? []) as N[]) if (d.parentPropDefId) propAlias.set(key(d.id), key(d.parentPropDefId));
  const propId = (g: any) => {
    let k = key(g);
    for (let i = 0; i < 8 && propAlias.has(k); i++) k = propAlias.get(k)!;
    return k;
  };
  const propDefs = (n: N): ComponentProperty[] | undefined => {
    const out: ComponentProperty[] = [];
    for (const d of (n.componentPropDefs ?? []) as N[]) {
      if (d.parentPropDefId || !d.name) continue;
      const id = key(d.id);
      const iv = d.initialValue ?? {};
      if (d.type === 'BOOL') out.push({ id, name: d.name, type: 'boolean', default: iv.boolValue !== false });
      else if (d.type === 'TEXT') out.push({ id, name: d.name, type: 'text', default: iv.textValue?.characters ?? '' });
      else if (d.type === 'INSTANCE_SWAP' && iv.guidValue) out.push({ id, name: d.name, type: 'swap', default: key(iv.guidValue) });
    }
    return out.length ? out : undefined;
  };

  // overrideKey → guid, por componente (para levar os overrides das instâncias)
  const overrideMaps = new Map<string, Map<string, string>>();
  const overrideMap = (symbolId: string) => {
    let m = overrideMaps.get(symbolId);
    if (m) return m;
    m = new Map();
    const sym = byId.get(symbolId);
    const visit = (n: N) => childrenOf(n).forEach((c) => {
      m!.set(key(c.overrideKey ?? c.guid), key(c.guid));
      m!.set(key(c.guid), key(c.guid));
      visit(c);
    });
    if (sym) visit(sym);
    overrideMaps.set(symbolId, m);
    return m;
  };
  const overridePath = (symbolId: string, guids: N[]): string | null => {
    const ids: string[] = [];
    let cur = symbolId;
    for (let i = 0; i < guids.length; i++) {
      const id = overrideMap(cur).get(key(guids[i]));
      if (!id) return null;
      ids.push(id);
      const n = byId.get(id);
      if (i < guids.length - 1) {
        if (n?.type !== 'INSTANCE') return null;
        cur = key(n.symbolData?.symbolID);
      }
    }
    return ids.join('/');
  };

  // ── Nós ──
  const screens = new Set<string>(); // frames do topo das páginas (destinos do protótipo)

  const base = (n: N, w: number, h: number, parentLayout: boolean): Partial<SceneNode> & { x: number; y: number; width: number; height: number } => {
    const t = n.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    const pl = placement([t.m00, t.m10, t.m01, t.m11, t.m02, t.m12], w, h);
    if (pl.flipped && n.type !== 'VECTOR' && n.type !== 'BOOLEAN_OPERATION') warn.add('Camadas espelhadas aparecem sem o espelhamento');
    const out: Partial<SceneNode> & { x: number; y: number; width: number; height: number } = { x: pl.x, y: pl.y, width: r2(w), height: r2(h) };
    if (pl.rotation) out.rotation = pl.rotation;
    if (n.visible === false) out.visible = false;
    if (n.locked) out.locked = true;
    if (typeof n.opacity === 'number' && n.opacity < 1) out.opacity = r2(n.opacity * 1000) / 1000;
    const blend = BLEND[n.blendMode as string];
    if (blend && blend !== 'normal') out.blendMode = blend;
    const fx = effects(n.effects);
    if (fx) out.effects = fx;
    if (parentLayout && n.stackPositioning === 'ABSOLUTE') out.absolute = true;
    const hc = H_CONSTRAINT[n.horizontalConstraint as string], vc = V_CONSTRAINT[n.verticalConstraint as string];
    if ((hc && hc !== 'left') || (vc && vc !== 'top')) out.constraints = { horizontal: hc ?? 'left', vertical: vc ?? 'top' };
    const fill = styleRef(n.styleIdForFill), stroke = styleRef(n.styleIdForStrokeFill), text = styleRef(n.styleIdForText), effect = styleRef(n.styleIdForEffect);
    if (fill || stroke || text || effect) out.styles = { ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}), ...(text ? { text } : {}), ...(effect ? { effect } : {}) };
    const refs: Record<string, string> = {};
    for (const r of (n.componentPropRefs ?? []) as N[]) {
      if (r.isDeleted) continue;
      const slot = r.componentPropNodeField === 'VISIBLE' ? 'visible' : r.componentPropNodeField === 'TEXT_DATA' ? 'text' : r.componentPropNodeField === 'OVERRIDDEN_SYMBOL_ID' ? 'component' : null;
      if (slot) refs[slot] = propId(r.defID);
    }
    if (Object.keys(refs).length) out.propRefs = refs;
    return out;
  };

  const radius = (n: N): number | [number, number, number, number] | undefined => {
    if (n.rectangleCornerRadiiIndependent) {
      const r: [number, number, number, number] = [n.rectangleTopLeftCornerRadius ?? 0, n.rectangleTopRightCornerRadius ?? 0, n.rectangleBottomRightCornerRadius ?? 0, n.rectangleBottomLeftCornerRadius ?? 0].map(r2) as [number, number, number, number];
      return r.every((v) => v === r[0]) ? r[0] || undefined : r;
    }
    return n.cornerRadius ? r2(n.cornerRadius) : undefined;
  };

  const geometryPath = (list: unknown): { d: string; evenodd: boolean } | null => {
    const parts: string[] = [];
    let evenodd = false;
    for (const g of (list ?? []) as N[]) {
      const b = blobs[g.commandsBlob];
      if (!b) continue;
      const d = commandsToPath(b);
      if (d) parts.push(d);
      if (g.windingRule === 'ODD' || g.windingRule === 'EVENODD') evenodd = true;
    }
    return parts.length ? { d: parts.join(' '), evenodd } : null;
  };

  const layoutOf = (n: N): AutoLayout | undefined => {
    if (n.stackMode !== 'HORIZONTAL' && n.stackMode !== 'VERTICAL') return undefined;
    const left = n.stackHorizontalPadding ?? 0, top = n.stackVerticalPadding ?? 0;
    const L: AutoLayout = {
      direction: n.stackMode === 'HORIZONTAL' ? 'horizontal' : 'vertical',
      gap: r2(n.stackSpacing ?? 0),
      padding: [r2(top), r2(n.stackPaddingRight ?? left), r2(n.stackPaddingBottom ?? top), r2(left)],
      justify: n.stackPrimaryAlignItems === 'CENTER' ? 'center' : n.stackPrimaryAlignItems === 'MAX' ? 'end' : n.stackPrimaryAlignItems === 'SPACE_BETWEEN' || n.stackPrimaryAlignItems === 'SPACE_EVENLY' ? 'space-between' : 'start',
      align: n.stackCounterAlignItems === 'CENTER' ? 'center' : n.stackCounterAlignItems === 'MAX' ? 'end' : n.stackCounterAlignItems === 'BASELINE' ? 'baseline' : 'start',
    };
    if (n.stackWrap === 'WRAP') {
      L.wrap = true;
      if (typeof n.stackCounterSpacing === 'number') L.crossGap = r2(n.stackCounterSpacing);
    }
    return L;
  };

  /** Tamanho dentro do auto layout (do próprio nó e como filho). */
  const sizingOf = (n: N, parent: N | null, own: AutoLayout | undefined): SceneNode['sizing'] => {
    const pl = parent ? layoutOf(parent) : undefined;
    let horizontal: 'fixed' | 'hug' | 'fill' = 'fixed', vertical: 'fixed' | 'hug' | 'fill' = 'fixed';
    if (own) {
      const hugPrimary = n.stackPrimarySizing === 'RESIZE_TO_FIT' || n.stackPrimarySizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';
      const hugCounter = n.stackCounterSizing === 'RESIZE_TO_FIT' || n.stackCounterSizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';
      if (own.direction === 'horizontal') {
        if (hugPrimary) horizontal = 'hug';
        if (hugCounter) vertical = 'hug';
      } else {
        if (hugPrimary) vertical = 'hug';
        if (hugCounter) horizontal = 'hug';
      }
    }
    if (pl && n.stackPositioning !== 'ABSOLUTE') {
      const grow = (n.stackChildPrimaryGrow ?? 0) > 0;
      const stretch = n.stackChildAlignSelf === 'STRETCH';
      if (pl.direction === 'horizontal') {
        if (grow) horizontal = 'fill';
        if (stretch) vertical = 'fill';
      } else {
        if (grow) vertical = 'fill';
        if (stretch) horizontal = 'fill';
      }
    }
    return horizontal === 'fixed' && vertical === 'fixed' ? undefined : { horizontal, vertical };
  };

  const grids = (n: N): LayoutGrid[] | undefined => {
    const out: LayoutGrid[] = [];
    for (const g of (n.layoutGrids ?? []) as N[]) {
      const type = g.pattern === 'GRID' ? 'grid' : g.axis === 'Y' || g.type === 'ROWS' ? 'rows' : 'columns';
      const alignment = g.type === 'STRETCH' ? 'stretch' : g.type === 'CENTER' ? 'center' : g.type === 'MAX' ? 'end' : g.type === 'MIN' ? 'start' : 'stretch';
      out.push({ type, count: Math.max(1, g.numSections ?? 1), size: r2(g.sectionSize ?? 10), gutter: r2(g.gutterSize ?? 0), margin: r2(g.offset ?? 0), alignment, color: rgbaHex(g.color), ...(g.visible === false ? { visible: false } : {}) });
    }
    return out.length ? out : undefined;
  };

  const variantOf = (nameV: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const part of nameV.split(',')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return Object.keys(out).length ? out : { Variante: nameV.trim() || 'Padrão' };
  };

  function convert(n: N, parent: N | null): SceneNode | null {
    const type = n.type as string;
    if (n.styleType || ['VARIABLE', 'VARIABLE_SET', 'SLICE'].includes(type)) return null;
    counts[type] = (counts[type] ?? 0) + 1;
    const w = n.size?.x ?? 0, h = n.size?.y ?? 0;
    const parentLayout = !!(parent && layoutOf(parent));
    const id = key(n.guid);
    const nm = (n.name as string) || type.toLowerCase();
    const b = base(n, w, h, parentLayout);
    const fills = paints(n.fillPaints);
    const st = strokes(n);
    if (n.mask) warn.add('Máscaras foram ocultadas (o conteúdo aparece sem o recorte)');
    const common = { id, name: nm, ...b, ...(fills.length ? { fills } : {}), ...(st ? { strokes: st } : {}), ...(n.mask ? { visible: false } : {}) } as SceneNode;
    const proto = interactions(n);
    if (proto) common.interactions = proto;
    const sizing = sizingOf(n, parent, layoutOf(n));
    if (sizing) common.sizing = sizing;

    switch (type) {
      case 'FRAME':
      case 'SECTION':
      case 'SYMBOL':
      case 'GROUP': {
        const isSet = type === 'FRAME' && (n.isStateGroup || ((n.componentPropDefs ?? []) as N[]).some((d) => d.type === 'VARIANT')) && childrenOf(n).some((c) => c.type === 'SYMBOL');
        const isGroup = type === 'GROUP' || (type === 'FRAME' && n.resizeToFit && !fills.length && !st);
        const children = childrenOf(n).map((c) => convert(c, n)).filter(Boolean) as SceneNode[];
        const kind = isSet ? 'component-set' : type === 'SYMBOL' ? 'component' : isGroup ? 'group' : 'frame';
        const out = { ...common, type: kind, children } as ContainerNode;
        if (kind !== 'group') {
          out.clip = n.frameMaskDisabled !== true;
          const r = radius(n);
          if (r) out.cornerRadius = r;
          const L = layoutOf(n);
          if (L) out.layout = L;
          const g = grids(n);
          if (g) out.grids = g;
        }
        if (kind === 'component' || kind === 'component-set') {
          const defs = propDefs(n);
          if (defs) out.properties = defs;
          if (n.symbolDescription || n.description) out.description = String(n.symbolDescription ?? n.description).slice(0, 2000);
        }
        if (kind === 'component' && parent && byId.get(key(parent.guid)) && parentIsSet(parent)) {
          out.variant = variantOf(nm);
          out.name = variantName(out.variant);
        }
        return out;
      }
      case 'INSTANCE': {
        const sid = key(n.symbolData?.symbolID);
        if (!byId.has(sid)) warn.add('Instâncias de componentes que não vieram no arquivo aparecem como “componente ausente”');
        const out = { ...common, type: 'instance', componentId: sid } as InstanceNode;
        const ov: Record<string, InstanceOverride> = {};
        for (const o of (n.symbolData?.symbolOverrides ?? []) as N[]) {
          const guids = o.guidPath?.guids as N[] | undefined;
          if (!guids?.length) continue;
          const path = overridePath(sid, guids);
          if (!path) continue;
          const patch: InstanceOverride = {};
          if (o.textData?.characters !== undefined) patch.text = String(o.textData.characters);
          if (o.fillPaints) patch.fills = paints(o.fillPaints);
          if (typeof o.visible === 'boolean') patch.visible = o.visible;
          if (o.overriddenSymbolID) patch.componentId = key(o.overriddenSymbolID);
          if (o.strokePaints) patch.strokes = strokes({ ...byId.get(path.split('/').pop()!), ...o }) ?? [];
          if (typeof o.opacity === 'number') patch.opacity = r2(o.opacity * 1000) / 1000;
          if (o.textAutoResize) patch.autoResize = o.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'width' : o.textAutoResize === 'HEIGHT' ? 'height' : 'none';
          // crescer/esticar dentro do auto layout do pai (na instância)
          const target = byId.get(path.split('/').pop()!);
          if (target && (o.stackChildPrimaryGrow !== undefined || o.stackChildAlignSelf !== undefined)) {
            const merged = { ...target, ...o };
            const s = sizingOf(merged, byId.get(key(target.parentIndex?.guid)) ?? null, layoutOf(merged));
            patch.sizing = s ?? { horizontal: 'fixed', vertical: 'fixed' };
          }
          if (o.size && typeof o.size.x === 'number') {
            patch.width = r2(o.size.x);
            patch.height = r2(o.size.y);
          }
          if (Object.keys(patch).length) ov[path] = { ...(ov[path] ?? {}), ...patch };
        }
        if (Object.keys(ov).length) out.overrides = ov;
        const props: Record<string, boolean | string> = {};
        for (const a of (n.componentPropAssignments ?? []) as N[]) {
          const v = a.value ?? {};
          const pid = propId(a.defID);
          if (typeof v.boolValue === 'boolean') props[pid] = v.boolValue;
          else if (v.textValue?.characters !== undefined) props[pid] = String(v.textValue.characters);
          else if (v.guidValue) props[pid] = key(v.guidValue);
        }
        if (Object.keys(props).length) out.props = props;
        delete (out as Partial<SceneNode>).fills; // o preenchimento vem do componente
        if (fills.length && !sameAsSymbol(n, sid)) out.fills = fills;
        return out;
      }
      case 'RECTANGLE':
      case 'ROUNDED_RECTANGLE': {
        const out = { ...common, type: 'rect' } as ShapeNode;
        const r = radius(n);
        if (r) out.cornerRadius = r;
        return out;
      }
      case 'ELLIPSE': {
        const arc = n.arcData;
        const partial = arc && (Math.abs((arc.endingAngle ?? 0) - (arc.startingAngle ?? 0) - Math.PI * 2) > 0.001 || (arc.innerRadius ?? 0) > 0);
        if (partial) return pathFrom(n, common);
        return { ...common, type: 'ellipse' } as ShapeNode;
      }
      case 'LINE':
        return { ...common, type: 'line', height: 0 } as ShapeNode;
      case 'STAR':
        return { ...common, type: 'star', points: n.count ?? 5, innerRadius: n.starInnerScale ?? 0.38 } as ShapeNode;
      case 'REGULAR_POLYGON':
        return { ...common, type: 'polygon', points: n.count ?? 3 } as ShapeNode;
      case 'BOOLEAN_OPERATION': {
        const children = childrenOf(n).map((c) => convert(c, n)).filter(Boolean) as SceneNode[];
        const op = n.booleanOperation === 'SUBTRACT' ? 'subtract' : n.booleanOperation === 'INTERSECT' ? 'intersect' : n.booleanOperation === 'XOR' ? 'exclude' : 'union';
        if (!children.length) return pathFrom(n, common);
        return { ...common, type: 'boolean', booleanOp: op, children } as ContainerNode;
      }
      case 'TEXT': {
        const style = textStyle(n);
        fonts.add(style.family);
        const autoResize = n.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'width' : n.textAutoResize === 'HEIGHT' ? 'height' : 'none';
        const t = { ...common, type: 'text', text: String(n.textData?.characters ?? ''), style, autoResize } as TextNode;
        if (((n.textData?.styleOverrideTable ?? []) as unknown[]).length > 1) warn.add('Textos com vários estilos no mesmo bloco usam só o estilo principal');
        return t;
      }
      case 'VECTOR':
        return pathFrom(n, common);
      default: {
        if (n.fillGeometry || n.strokeGeometry) return pathFrom(n, common);
        if (childrenOf(n).length) {
          const children = childrenOf(n).map((c) => convert(c, n)).filter(Boolean) as SceneNode[];
          return { ...common, type: 'group', children } as ContainerNode;
        }
        warn.add(`Camadas do tipo ${type.toLowerCase().replace(/_/g, ' ')} não têm equivalente e ficaram de fora`);
        return null;
      }
    }
  }

  function parentIsSet(p: N): boolean {
    return p.type === 'FRAME' && (p.isStateGroup || ((p.componentPropDefs ?? []) as N[]).some((d) => d.type === 'VARIANT')) && childrenOf(p).some((c) => c.type === 'SYMBOL');
  }

  function sameAsSymbol(n: N, sid: string): boolean {
    const s = byId.get(sid);
    return !!s && JSON.stringify(s.fillPaints ?? null) === JSON.stringify(n.fillPaints ?? null);
  }

  /** Vetor: preenchimento pela geometria pronta; traço aberto pela rede de vetores. */
  function pathFrom(n: N, common: SceneNode): SceneNode | null {
    const fillVisible = ((common.fills ?? []) as Paint[]).some((p) => p.visible !== false);
    let d = '';
    let evenodd = false;
    const geo = geometryPath(n.fillGeometry);
    if (geo && (fillVisible || !common.strokes)) {
      d = geo.d;
      evenodd = geo.evenodd;
    } else if (common.strokes && n.vectorData?.vectorNetworkBlob !== undefined) {
      const blob = blobs[n.vectorData.vectorNetworkBlob];
      const ns = n.vectorData.normalizedSize ?? n.size;
      if (blob && ns?.x && ns?.y) d = vectorNetworkToPath(blob, (n.size?.x ?? ns.x) / ns.x, (n.size?.y ?? ns.y) / ns.y);
      if (!d && n.strokeGeometry) {
        // sem a linha central: usa o contorno do traço como preenchimento
        const sg = geometryPath(n.strokeGeometry);
        if (sg) {
          d = sg.d;
          common.fills = (common.strokes ?? []).map((s) => s.paint);
          delete common.strokes;
        }
      }
    } else if (geo) d = geo.d;
    if (!d) {
      warn.add('Vetores sem desenho salvo ficaram de fora');
      return null;
    }
    const out = { ...common, type: 'path', d } as PathNode;
    if (evenodd) out.fillRule = 'evenodd';
    // espelhado: o espelhamento vai para dentro do desenho
    const t = n.transform;
    if (t && t.m00 * t.m11 - t.m01 * t.m10 < 0) {
      const baked = bakePath(d, [t.m00, t.m10, t.m01, t.m11, t.m02, t.m12]);
      Object.assign(out, baked);
      delete out.rotation;
    }
    return out;
  }

  function interactions(n: N): Interaction[] | undefined {
    const out: Interaction[] = [];
    for (const it of (n.prototypeInteractions ?? []) as N[]) {
      if (it.isDeleted) continue;
      const ev = it.event?.interactionType;
      if (ev && ev !== 'ON_CLICK' && ev !== 'ON_PRESS') {
        warn.add('Interações que não são de clique (hover, teclado, tempo) ficaram de fora');
        continue;
      }
      const a = (it.actions ?? [])[0] as N | undefined;
      if (!a) continue;
      if (a.connectionType === 'BACK') {
        out.push({ trigger: 'click', action: 'back' });
        continue;
      }
      if (a.connectionType !== 'INTERNAL_NODE' || !a.transitionNodeID || (a.navigationType && a.navigationType !== 'NAVIGATE')) {
        warn.add('Ações de protótipo além de navegar e voltar ficaram de fora');
        continue;
      }
      const transition = TRANSITIONS[a.transitionType as string] ?? 'instant';
      out.push({ trigger: 'click', action: 'navigate', target: key(a.transitionNodeID), transition, ...(transition !== 'instant' ? { duration: Math.round((a.transitionDuration ?? 0.3) * 1000) } : {}) });
      break;
    }
    return out.length ? out : undefined;
  }

  // ── Páginas ──
  const doc = all.find((n) => n.type === 'DOCUMENT');
  const canvases = doc ? childrenOf(doc).filter((n) => n.type === 'CANVAS') : all.filter((n) => n.type === 'CANVAS');
  const pages: Page[] = [];
  for (const c of canvases) {
    if (c.internalOnly) continue;
    const children = childrenOf(c).map((n) => convert(n, null)).filter(Boolean) as SceneNode[];
    for (const ch of children) screens.add(ch.id);
    const bg = c.backgroundColor ? rgbaHex(c.backgroundColor).slice(0, 7) : background?.slice(0, 7) ?? '#f4f2ee';
    const page: Page = { id: key(c.guid), name: c.name || `Página ${pages.length + 1}`, background: bg, children };
    const start = ((c.prototypeStartNodeID ? [{ nodeID: c.prototypeStartNodeID }] : c.flowStartingPoints) ?? []) as N[];
    if (start[0]?.nodeID) page.flowStart = key(start[0].nodeID);
    pages.push(page);
  }
  // componentes de bibliotecas que vieram junto no arquivo (página interna): ficam numa página própria
  const internal = canvases.find((c) => c.internalOnly);
  if (internal) {
    const used = childrenOf(internal).filter((n) => n.type === 'SYMBOL' || (n.type === 'FRAME' && parentIsSet(n)));
    if (used.length) {
      const children = used.map((n) => convert(n, null)).filter(Boolean) as SceneNode[];
      // lado a lado, sem sobreposição
      let x = 0, y = 0, rowH = 0;
      for (const ch of children) {
        if (x > 4000) {
          x = 0;
          y += rowH + 80;
          rowH = 0;
        }
        ch.x = x;
        ch.y = y;
        ch.rotation = undefined;
        x += ch.width + 80;
        rowH = Math.max(rowH, ch.height);
      }
      pages.push({ id: key(internal.guid), name: 'Componentes de bibliotecas', background: pages[0]?.background ?? '#f4f2ee', children });
    }
  }
  if (!pages.length) pages.push({ id: 'pagina', name: 'Página 1', background: '#f4f2ee', children: [] });

  // destinos de protótipo que não são telas do topo: sobe até a tela que contém o nó
  const parentOf = (id: string) => key(byId.get(id)?.parentIndex?.guid);
  const fixTargets = (list: SceneNode[]) => list.forEach((n) => {
    for (const it of n.interactions ?? []) {
      if (it.action !== 'navigate' || !it.target || screens.has(it.target)) continue;
      let cur: string | undefined = it.target;
      for (let i = 0; i < 64 && cur && !screens.has(cur); i++) cur = parentOf(cur);
      it.target = cur && screens.has(cur) ? cur : undefined;
    }
    if ('children' in n) fixTargets(n.children);
  });
  for (const p of pages) fixTargets(p.children);

  const out = newDocument(name, pages);
  out.variables = [...collections.values()].filter((c) => c.variables.length);
  if (styles.length) out.styles = styles;
  out.assets = assets as ZalAssets;
  const total = pages.reduce((s, p) => s + countNodes(p.children), 0);
  counts.total = total;
  return { doc: out, report: { warnings: warn.list(), fonts: [...fonts], counts } };
}

type ZalAssets = ReturnType<typeof newDocument>['assets'];

/** Decodifica só a mensagem (útil para ferramentas e testes). */
export function decodeFigMessage(schema: Uint8Array, data: Uint8Array, skip: Iterable<string> = FIG_SKIP): Record<string, KiwiValue> {
  return decodeMessage(decodeSchema(schema), data, 'Message', skip);
}
