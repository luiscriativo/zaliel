// Importação de arquivos .pen (JSON). Componentes reutilizáveis viram componentes,
// "ref" vira instância (ou cópia desanexada quando muda a estrutura), variáveis com
// temas viram coleções com modos e bibliotecas importadas entram como páginas.
import type {
  AutoLayout,
  ContainerNode,
  Effect,
  InstanceNode,
  InstanceOverride,
  Page,
  Paint,
  PathNode,
  SceneNode,
  ShapeNode,
  Sizing,
  Stroke,
  TextNode,
  TextStyle,
  TextRun,
  Variable,
  VariableCollection,
  VariableValue,
} from '../types';
import { cssHex, makeAsset, newDocument, r2, weightFromStyle, Warnings, countNodes, type ImportResult } from './common';
import { mapPoints, parsePath, serializePath } from '../vector';
import { clone } from '../util';
import { spansToRuns, type TextSpan } from '../text';

/* eslint-disable @typescript-eslint/no-explicit-any */
type P = Record<string, any>;

/** Marca, num nó copiado, o arquivo de onde ele veio. */
const FROM = '__arquivo';

/** Ícone desenhado como caminho num quadrado `size` × `size`. */
export interface IconShape {
  d: string;
  size: number;
  /** Ícones de traço (Lucide): o caminho é contornado; senão é preenchido. */
  stroke: boolean;
  strokeWidth?: number;
}

export interface PenInput {
  /** Conteúdo do arquivo principal. */
  text: string;
  /** Bibliotecas importadas: apelido → conteúdo do arquivo (já lido pelo sistema). */
  imports?: Record<string, { name: string; text: string }>;
  /** Imagens referenciadas por caminho relativo → bytes. */
  images?: Record<string, Uint8Array>;
  /** Desenho de ícones de bibliotecas de ícones (biblioteca, nome) → forma. */
  icons?: (library: string, name: string) => IconShape | null;
}

/** Caminhos de imagem e ícones usados (para quem chama ler/preparar antes de converter). */
export function penDependencies(text: string): { imports: Record<string, string>; images: string[]; icons: { library: string; name: string }[] } {
  const j = JSON.parse(text);
  const images = new Set<string>();
  const icons = new Map<string, { library: string; name: string }>();
  const visit = (v: any) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== 'object') return;
    if (v.type === 'image' && typeof v.url === 'string') images.add(v.url);
    // ícones de nós e de overrides ({ "icon": "nome" } sem o tipo)
    if (typeof v.icon === 'string' && (v.type === 'icon' || v.type === undefined)) {
      const library = String(v.library ?? 'lucide');
      icons.set(`${library}|${v.icon}`, { library, name: v.icon });
    }
    for (const k of Object.keys(v)) if (typeof v[k] === 'object') visit(v[k]);
  };
  visit(j);
  return { imports: j.imports ?? {}, images: [...images], icons: [...icons.values()] };
}

interface Ctx {
  /** Modo escolhido por eixo de tema (eixo qualificado → modo). */
  theme: Record<string, string>;
  /** Prefixo do arquivo atual ("" no principal, "Q:" numa biblioteca). */
  prefix: string;
  /** O pai tem auto layout? */
  parentLayout: boolean;
  /** Largura/altura do pai (para "preencher" fora de auto layout). */
  parentW?: number;
  parentH?: number;
}

export function penToDocument(input: PenInput, name: string): ImportResult {
  const warn = new Warnings();
  const fonts = new Set<string>();
  const counts: Record<string, number> = {};
  const main = JSON.parse(input.text) as P;

  // ── Arquivos: o principal e as bibliotecas, com ids qualificados pelo apelido ──
  interface PenFile { prefix: string; json: P; label: string }
  const files: PenFile[] = [{ prefix: '', json: main, label: name }];
  const seen = new Set<string>();
  const addImports = (json: P, prefix: string) => {
    for (const [alias, path] of Object.entries((json.imports ?? {}) as Record<string, string>)) {
      const p = `${prefix}${alias}:`;
      if (seen.has(p)) continue;
      seen.add(p);
      const lib = input.imports?.[p.slice(0, -1)] ?? input.imports?.[alias];
      if (!lib) {
        warn.add(`A biblioteca “${path}” não foi encontrada ao lado do arquivo; os componentes dela aparecem como ausentes`);
        continue;
      }
      try {
        const lj = JSON.parse(lib.text) as P;
        files.push({ prefix: p, json: lj, label: lib.name });
        addImports(lj, p);
      } catch {
        warn.add(`A biblioteca “${path}” está danificada`);
      }
    }
  };
  addImports(main, '');
  /** Id absoluto: ids e referências são relativos ao arquivo onde estão escritos. */
  const q = (prefix: string, id: string) => (id.startsWith('@') ? id.slice(1) : prefix + id);
  /** Converte um id absoluto para relativo a outro arquivo. */
  const rel = (abs: string, prefix: string) => (prefix && abs.startsWith(prefix) ? abs.slice(prefix.length) : abs);

  // ── Componentes reutilizáveis (por id qualificado) ──
  const reusable = new Map<string, { node: P; prefix: string }>();
  for (const f of files) {
    const visit = (n: P) => {
      if (n.reusable && n.id) reusable.set(q(f.prefix, n.id), { node: n, prefix: f.prefix });
      (n.children ?? []).forEach(visit);
    };
    (f.json.children ?? []).forEach(visit);
  }

  // ── Variáveis e temas ──
  const axisModes = new Map<string, string[]>(); // eixo qualificado → modos
  for (const f of files) for (const [axis, modes] of Object.entries((f.json.themes ?? {}) as Record<string, string[]>)) axisModes.set(f.prefix + axis, modes);
  interface VarDef { id: string; type: string; entries: { value: any; theme?: Record<string, string> }[]; prefix: string; axis?: string }
  const vars = new Map<string, VarDef>();
  for (const f of files) {
    for (const [vname, def] of Object.entries((f.json.variables ?? {}) as Record<string, P>)) {
      const id = f.prefix + vname;
      const raw = Array.isArray(def.value) ? def.value : [{ value: def.value }];
      const entries = raw.map((e: P) => ({ value: e?.value, theme: e?.theme ? Object.fromEntries(Object.entries(e.theme as Record<string, string>).map(([a, m]) => [qualifyAxis(f.prefix, a), m])) : undefined }));
      const axis = entries.find((e: { theme?: Record<string, string> }) => e.theme)?.theme;
      vars.set(id, { id, type: String(def.type ?? 'string'), entries, prefix: f.prefix, axis: axis ? Object.keys(axis)[0] : undefined });
    }
  }
  function qualifyAxis(prefix: string, axis: string): string {
    // "Q:Sistema operacional" já vem qualificado quando usado no arquivo principal
    return axisModes.has(axis) ? axis : prefix + axis;
  }
  const defaultTheme: Record<string, string> = {};
  for (const [axis, modes] of axisModes) if (modes[0]) defaultTheme[axis] = modes[0];

  const varValue = (v: VarDef, theme: Record<string, string>, depth = 0): any => {
    let best: any = undefined, score = -1;
    for (const e of v.entries) {
      const t = e.theme ?? {};
      const keys = Object.keys(t);
      if (keys.some((k) => (theme[k] ?? defaultTheme[k]) !== t[k])) continue;
      if (keys.length > score) {
        best = e.value;
        score = keys.length;
      }
    }
    if (best === undefined) best = v.entries[0]?.value;
    if (typeof best === 'string' && best.startsWith('$') && depth < 8) {
      const ref = vars.get(qualifyVar(v.prefix, best.slice(1)));
      if (ref) return varValue(ref, theme, depth + 1);
    }
    return best;
  };
  function qualifyVar(prefix: string, name: string): string {
    if (vars.has(prefix + name)) return prefix + name;
    if (vars.has(name)) return name;
    // último recurso: a mesma variável em outro arquivo (conteúdo que passou de um arquivo para outro)
    for (const f of files) if (vars.has(f.prefix + name)) return f.prefix + name;
    return prefix + name;
  }
  const VAR = /^\$[\w:./-]+$/;
  /** Valor de uma propriedade que pode ser "$variável". `literal`: texto que pode começar com "$" de verdade. */
  const val = (raw: any, ctx: Ctx, literal = false): any => {
    if (typeof raw === 'string' && VAR.test(raw)) {
      const v = vars.get(qualifyVar(ctx.prefix, raw.slice(1)));
      if (!v) {
        if (literal) return raw;
        warn.add('Algumas variáveis usadas não existem no arquivo');
        return undefined;
      }
      return varValue(v, ctx.theme);
    }
    return raw;
  };
  const num = (raw: any, ctx: Ctx, fallback = 0): number => {
    const v = val(raw, ctx);
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  // coleções do Zaliel: uma por eixo de tema (e uma para as variáveis sem tema) de cada arquivo
  const collections = new Map<string, VariableCollection>();
  const collectionFor = (v: VarDef): VariableCollection => {
    const ck = v.axis ?? `${v.prefix}__base`;
    let c = collections.get(ck);
    if (!c) {
      const fileLabel = files.find((f) => f.prefix === v.prefix)?.label ?? '';
      const modes = v.axis ? (axisModes.get(v.axis) ?? ['Padrão']).map((m) => ({ id: `${ck}#${m}`, name: m })) : [{ id: `${ck}#padrao`, name: 'Padrão' }];
      const label = v.axis ? v.axis.slice(v.prefix.length) : 'Variáveis';
      c = { id: ck, name: v.prefix ? `${label} (${fileLabel})` : label, modes, defaultMode: modes[0].id, variables: [] };
      collections.set(ck, c);
    }
    return c;
  };
  for (const v of vars.values()) {
    const c = collectionFor(v);
    const type = v.type === 'color' ? 'color' : v.type === 'number' ? 'number' : v.type === 'boolean' ? 'boolean' : 'string';
    const values: Record<string, VariableValue> = {};
    for (const m of c.modes) {
      const theme = v.axis ? { ...defaultTheme, [v.axis]: m.name } : defaultTheme;
      let x = varValue(v, theme);
      if (type === 'color') x = cssHex(x) ?? '#000000';
      else if (type === 'number') x = typeof x === 'number' ? x : parseFloat(x) || 0;
      else if (type === 'boolean') x = x === true || x === 'true';
      else x = String(x ?? '');
      values[m.id] = x;
    }
    c.variables.push({ id: v.id, name: v.id.replace(/:/g, '/'), type, values } as Variable);
  }
  const themed = (ctx: Ctx, v: VarDef) => !!v.axis && (ctx.theme[v.axis] ?? defaultTheme[v.axis]) !== defaultTheme[v.axis];

  // ── Imagens ──
  const assets: Record<string, NonNullable<ReturnType<typeof makeAsset>>> = {};
  const assetFor = (url: string): string | null => {
    const key = url.replace(/[^a-z0-9._-]+/gi, '_').slice(-80);
    if (assets[key]) return key;
    const bytes = input.images?.[url];
    if (!bytes) return null;
    const a = makeAsset(bytes);
    if (!a) return null;
    assets[key] = a;
    return key;
  };

  // ── Pinturas ──
  const paintOf = (raw: any, ctx: Ctx): Paint | null => {
    if (raw == null) return null;
    if (typeof raw === 'string') {
      if (raw.startsWith('$')) {
        const v = vars.get(qualifyVar(ctx.prefix, raw.slice(1)));
        const color = cssHex(v ? varValue(v, ctx.theme) : undefined);
        if (!color) return null;
        const out: Paint = { type: 'solid', color };
        if (v && v.type === 'color' && !themed(ctx, v)) out.variable = v.id;
        return out;
      }
      const color = cssHex(raw);
      return color ? { type: 'solid', color } : null;
    }
    if (typeof raw !== 'object') return null;
    if (raw.enabled === false) return null;
    if (raw.type === 'color') return paintOf(raw.color, ctx);
    if (raw.type === 'gradient') {
      const stops = ((raw.colors ?? []) as P[]).map((c) => ({ offset: r2(Math.min(1, Math.max(0, num(c.position, ctx)))), color: cssHex(val(c.color, ctx)) ?? '#000000' }));
      const deg = num(raw.rotation, ctx, 180);
      const r = (deg * Math.PI) / 180;
      const dx = Math.sin(r) / 2, dy = -Math.cos(r) / 2;
      const cx = raw.center?.x ?? 0.5, cy = raw.center?.y ?? 0.5;
      const kind = raw.gradientType === 'radial' ? 'radial' : raw.gradientType === 'angular' || raw.gradientType === 'conic' ? 'angular' : 'linear';
      const handles = kind === 'linear' ? { from: { x: r2(cx - dx), y: r2(cy - dy) }, to: { x: r2(cx + dx), y: r2(cy + dy) } } : { from: { x: cx, y: cy }, to: { x: cx + (raw.size?.width ?? 1) / 2, y: cy } };
      return { type: kind, stops, handles, ...(typeof raw.opacity === 'number' && raw.opacity < 1 ? { opacity: raw.opacity } : {}) } as Paint;
    }
    if (raw.type === 'image') {
      const url = String(raw.url ?? '');
      if (/^https?:/i.test(url)) {
        warn.add('Imagens da internet não são baixadas (o Zaliel funciona offline)');
        return null;
      }
      const asset = assetFor(url);
      if (!asset) {
        warn.add('Imagens que não estavam na pasta do arquivo ficaram de fora');
        return null;
      }
      const mode = raw.mode === 'fit' ? 'fit' : raw.mode === 'stretch' ? 'stretch' : raw.mode === 'tile' ? 'tile' : 'fill';
      return { type: 'image', asset, scaleMode: mode };
    }
    return null;
  };
  const weightOf = (raw: any, ctx: Ctx): number => {
    const wv = val(raw, ctx);
    return typeof wv === 'number' ? wv : /^\d+$/.test(String(wv)) ? parseInt(String(wv), 10) : wv === 'bold' ? 700 : weightFromStyle(String(wv ?? ''));
  };
  /** Conteúdo de um texto: string, ou lista de pedaços com estilo próprio. */
  const textContent = (raw: any, ctx: Ctx, base?: TextStyle): { text: string; runs: TextRun[] } => {
    const c = val(raw, ctx, true);
    if (!Array.isArray(c)) return { text: String(c ?? ''), runs: [] };
    const spans = c.map((p: any): TextSpan => {
      if (!p || typeof p !== 'object') return { text: String(p ?? '') };
      const s: TextSpan = { text: String(val(p.content ?? p.text, ctx, true) ?? '') };
      if (p.fontWeight !== undefined) s.weight = weightOf(p.fontWeight, ctx);
      if (p.fontStyle !== undefined) s.italic = p.fontStyle === 'italic';
      if (p.fontSize !== undefined) s.size = num(p.fontSize, ctx, base?.size ?? 14);
      if (p.fontFamily !== undefined) {
        const family = String(val(p.fontFamily, ctx) ?? '').split(',')[0].replace(/["']/g, '').trim();
        if (family) {
          s.family = family;
          fonts.add(family);
        }
      }
      if (p.letterSpacing !== undefined) s.letterSpacing = r2(num(p.letterSpacing, ctx));
      if (p.textDecoration === 'underline' || p.underline) s.decoration = 'underline';
      if (p.textDecoration === 'line-through' || p.strikethrough) s.decoration = 'strikethrough';
      const solid = p.fill !== undefined ? paints(p.fill, ctx).find((f) => f.type === 'solid') : undefined;
      if (solid && solid.type === 'solid') s.color = solid.color;
      return s;
    });
    return spansToRuns(spans, base);
  };
  const paints = (raw: any, ctx: Ctx): Paint[] => (Array.isArray(raw) ? raw : raw != null ? [raw] : []).map((p) => paintOf(p, ctx)).filter(Boolean) as Paint[];

  const strokesOf = (n: P, ctx: Ctx): Stroke[] | undefined => {
    const list = paints(n.stroke, ctx);
    if (!list.length) return undefined;
    // espessura por lado: lista [topo, direita, baixo, esquerda] (como no CSS) ou objeto {top, right, bottom, left}
    const raw = n.strokeWidth;
    let sides: Stroke['sides'];
    if (Array.isArray(raw)) {
      const v = (raw as unknown[]).map((x) => r2(num(x, ctx)));
      const [t, r = t, b = t, l = r] = v;
      sides = { top: t ?? 0, right: r ?? 0, bottom: b ?? 0, left: l ?? 0 };
    } else if (raw && typeof raw === 'object') {
      const o = raw as P;
      sides = { top: r2(num(o.top ?? 0, ctx)), right: r2(num(o.right ?? 0, ctx)), bottom: r2(num(o.bottom ?? 0, ctx)), left: r2(num(o.left ?? 0, ctx)) };
    }
    const sw = sides ? Math.max(sides.top, sides.right, sides.bottom, sides.left) : num(raw ?? 1, ctx, 1);
    if (!sw) return undefined;
    if (sides && sides.top === sw && sides.right === sw && sides.bottom === sw && sides.left === sw) sides = undefined;
    const align = n.strokeAlignment === 'inner' || n.strokeAlignment === 'inside' ? 'inside' : n.strokeAlignment === 'outer' || n.strokeAlignment === 'outside' ? 'outside' : 'center';
    const cap = n.strokeLinecap === 'round' ? 'round' : n.strokeLinecap === 'square' ? 'square' : undefined;
    const join = n.strokeLinejoin === 'round' ? 'round' : n.strokeLinejoin === 'bevel' ? 'bevel' : undefined;
    const dash = Array.isArray(n.strokeDashArray ?? n.strokeDasharray) ? ((n.strokeDashArray ?? n.strokeDasharray) as number[]) : undefined;
    return list.map((paint) => ({ paint, width: r2(sw), align, ...(sides ? { sides } : {}), ...(cap ? { cap } : {}), ...(join ? { join } : {}), ...(dash ? { dash } : {}) }) as Stroke);
  };

  const effectsOf = (raw: any, ctx: Ctx): Effect[] | undefined => {
    const out: Effect[] = [];
    for (const e of (Array.isArray(raw) ? raw : raw ? [raw] : []) as P[]) {
      if (e.enabled === false) continue;
      if (e.type === 'shadow') {
        out.push({ type: e.shadowType === 'inner' ? 'inner-shadow' : 'drop-shadow', color: cssHex(val(e.color, ctx)) ?? '#00000040', x: num(e.offset?.x, ctx), y: num(e.offset?.y, ctx), blur: num(e.blur, ctx), ...(e.spread ? { spread: num(e.spread, ctx) } : {}) });
      } else if (e.type === 'blur' || e.type === 'layer_blur') out.push({ type: 'layer-blur', radius: num(e.radius ?? e.blur, ctx, 4) });
      else if (e.type === 'background_blur' || e.type === 'backdrop_blur') out.push({ type: 'background-blur', radius: num(e.radius ?? e.blur, ctx, 8) });
    }
    return out.length ? out : undefined;
  };

  const padding = (raw: any, ctx: Ctx): [number, number, number, number] => {
    if (Array.isArray(raw)) {
      const v = raw.map((x) => num(x, ctx));
      if (v.length === 2) return [v[0], v[1], v[0], v[1]];
      if (v.length === 4) return [v[0], v[1], v[2], v[3]];
      return [v[0] ?? 0, v[0] ?? 0, v[0] ?? 0, v[0] ?? 0];
    }
    const p = num(raw, ctx);
    return [p, p, p, p];
  };

  /** "fill_container", "fit_content" (com valor de reserva opcional entre parênteses) ou número. */
  const dim = (raw: any, ctx: Ctx): { mode: 'fixed' | 'fill' | 'hug' | 'auto'; value?: number } => {
    if (raw === undefined) return { mode: 'auto' };
    const v = val(raw, ctx);
    if (typeof v === 'number') return { mode: 'fixed', value: v };
    const s = String(v);
    const m = /\(([-\d.]+)\)/.exec(s);
    if (s.startsWith('fill_container')) return { mode: 'fill', value: m ? parseFloat(m[1]) : undefined };
    if (s.startsWith('fit_content')) return { mode: 'hug', value: m ? parseFloat(m[1]) : undefined };
    const n = parseFloat(s);
    return Number.isFinite(n) ? { mode: 'fixed', value: n } : { mode: 'auto' };
  };

  // ── Refs: instância ou cópia expandida ──
  const SIMPLE = new Set(['content', 'enabled', 'fill']);
  const isSimplePatch = (p: P) => Object.keys(p).every((k) => SIMPLE.has(k));
  const ROOT_INSTANCE_PROPS = new Set(['id', 'type', 'ref', 'name', 'x', 'y', 'width', 'height', 'descendants', 'fill', 'stroke', 'strokeWidth', 'strokeAlignment', 'cornerRadius', 'opacity', 'rotation', 'enabled', 'layoutPosition', 'effect']);

  /**
   * Aplica overrides por caminho de ids ("a/b/c") numa cópia da árvore do componente.
   * `compPrefix`: arquivo do componente; `refPrefix`: arquivo onde o override foi escrito.
   */
  const applyPatches = (root: P, patches: Record<string, P>, compPrefix: string, refPrefix: string) => {
    const find = (n: P, abs: string): { node: P; parent: P | null; index: number } | null => {
      const list = (n.children ?? []) as P[];
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (q(compPrefix, String(c.id)) === abs) return { node: c, parent: n, index: i };
        if (c.type !== 'ref') {
          const r = find(c, abs);
          if (r) return r;
        }
      }
      return null;
    };
    for (const [path, patch] of Object.entries(patches)) {
      const [head, ...rest] = path.split('/');
      const hit = find(root, q(refPrefix, head));
      if (!hit) continue;
      if (rest.length) {
        // passa adiante para a instância aninhada (com o caminho relativo ao arquivo dela)
        const k = rest.map((seg) => rel(q(refPrefix, seg), compPrefix)).join('/');
        const tagged = patch.type || patch.children || patch.ref ? { ...patch, [FROM]: patch[FROM] ?? refPrefix } : patch;
        hit.node.descendants = { ...(hit.node.descendants ?? {}), [k]: tagged };
      } else if (patch.type && patch.type !== hit.node.type) {
        // nó trocado: o conteúdo novo foi escrito no arquivo de quem fez o override
        hit.parent!.children[hit.index] = { ...patch, id: patch.id ?? hit.node.id, [FROM]: patch[FROM] ?? refPrefix };
      } else if (patch.type) {
        const origin = patch[FROM] ?? refPrefix;
        const { [FROM]: _o, ...props } = patch;
        if (typeof props.ref === 'string') props.ref = '@' + q(origin, props.ref);
        hit.parent!.children[hit.index] = { ...hit.node, ...props, id: hit.node.id, ...(patch.children ? { children: (patch.children as P[]).map((c) => ({ ...c, [FROM]: c[FROM] ?? origin })) } : {}) };
      } else {
        // troca de instância: a referência nova foi escrita no arquivo de quem fez o override
        const { [FROM]: _f, ...props } = patch;
        if (typeof props.ref === 'string') props.ref = '@' + q(patch[FROM] ?? refPrefix, props.ref);
        Object.assign(hit.node, props);
      }
    }
  };

  /** Troca ids de uma cópia expandida para não repetir os do componente. */
  const reid = (n: P, base: string, prefix: string) => {
    const own = typeof n[FROM] === 'string' ? n[FROM] : prefix;
    if (n.id) n.id = `${base}-${q(own, n.id).replace(/:/g, '_')}`;
    (n.children ?? []).forEach((c: P) => reid(c, base, own));
  };

  // ── Conversão dos nós ──
  const convertList = (list: P[], ctx: Ctx): SceneNode[] => (list ?? []).map((c) => convert(c, ctx)).filter(Boolean) as SceneNode[];

  function convert(n: P, ctx0: Ctx): SceneNode | null {
    if (!n || typeof n !== 'object') return null;
    const type = String(n.type);
    counts[type] = (counts[type] ?? 0) + 1;
    if (type === 'prompt' || type === 'context') return null;
    // trecho vindo de outro arquivo (override com conteúdo novo): ids e variáveis relativos a ele
    if (typeof n[FROM] === 'string' && n[FROM] !== ctx0.prefix) ctx0 = { ...ctx0, prefix: n[FROM] };
    const ctx: Ctx = n.theme ? { ...ctx0, theme: { ...ctx0.theme, ...Object.fromEntries(Object.entries(n.theme as Record<string, string>).map(([a, m]) => [qualifyAxis(ctx0.prefix, a), m])) } } : ctx0;
    const id = q(ctx.prefix, String(n.id ?? Math.random().toString(36).slice(2)));
    const enabled = val(n.enabled, ctx);
    const w = dim(n.width, ctx), h = dim(n.height, ctx);
    const base: Partial<SceneNode> & { id: string; name: string; x: number; y: number; width: number; height: number } = {
      id,
      name: String(n.name ?? type),
      x: num(n.x, ctx),
      y: num(n.y, ctx),
      width: w.value ?? (w.mode === 'fill' ? ctx.parentW ?? 100 : 0),
      height: h.value ?? (h.mode === 'fill' ? ctx.parentH ?? 100 : 0),
    };
    if (enabled === false) base.visible = false;
    if (typeof n.opacity !== 'undefined' && num(n.opacity, ctx, 1) < 1) base.opacity = r2(num(n.opacity, ctx, 1));
    if (n.rotation) base.rotation = r2(num(n.rotation, ctx));
    if (ctx.parentLayout && n.layoutPosition === 'absolute') base.absolute = true;
    const fx = effectsOf(n.effect, ctx);
    if (fx) base.effects = fx;
    const sizing = (own: boolean): Sizing | undefined => {
      const mode = (d: typeof w): Sizing['horizontal'] => (d.mode === 'fill' && ctx.parentLayout ? 'fill' : d.mode === 'hug' || (d.mode === 'auto' && own) ? 'hug' : 'fixed');
      const s: Sizing = { horizontal: mode(w), vertical: mode(h) };
      return s.horizontal === 'fixed' && s.vertical === 'fixed' ? undefined : s;
    };

    switch (type) {
      case 'frame':
      case 'group': {
        const layoutKind = type === 'group' ? 'none' : n.layout ?? 'horizontal';
        const L: AutoLayout | undefined = layoutKind === 'vertical' || layoutKind === 'horizontal' ? {
          direction: layoutKind,
          gap: num(n.gap, ctx),
          padding: padding(n.padding, ctx),
          justify: n.justifyContent === 'center' ? 'center' : n.justifyContent === 'end' ? 'end' : n.justifyContent === 'space_between' || n.justifyContent === 'space_around' || n.justifyContent === 'space_evenly' ? 'space-between' : 'start',
          align: n.alignItems === 'center' ? 'center' : n.alignItems === 'end' ? 'end' : n.alignItems === 'stretch' ? 'stretch' : 'start',
        } : undefined;
        const children = convertList(n.children, { ...ctx, parentLayout: !!L, parentW: base.width || undefined, parentH: base.height || undefined });
        const out = { ...base, type: n.reusable ? 'component' : 'frame', children } as ContainerNode;
        const fills = paints(n.fill, ctx);
        if (fills.length) out.fills = fills;
        const st = strokesOf(n, ctx);
        if (st) out.strokes = st;
        const r = radiusOf(n.cornerRadius, ctx);
        if (r) out.cornerRadius = r;
        if (n.clip) out.clip = true;
        if (L) out.layout = L;
        const s = sizing(!!L);
        if (s) out.sizing = s;
        if (!L) fitToChildren(out, w.mode, h.mode);
        return out;
      }
      case 'ref': {
        const target = q(ctx.prefix, String(n.ref ?? ''));
        const comp = reusable.get(target);
        const patches = (n.descendants ?? {}) as Record<string, P>;
        const rootOverrides = Object.keys(n).filter((k) => !ROOT_INSTANCE_PROPS.has(k) && k !== 'theme' && k !== FROM);
        const needsCopy = !comp || Object.values(patches).some((p) => !isSimplePatch(p)) || rootOverrides.length > 0 || !!n.theme;
        if (comp && needsCopy) {
          // muda a estrutura ou o tema: vira uma cópia editável
          const copy = clone(comp.node);
          delete copy.reusable;
          for (const [k, v] of Object.entries(n)) if (!['type', 'ref', 'descendants', 'id', FROM].includes(k)) copy[k] = v;
          if (n.name === undefined) copy.name = comp.node.name;
          applyPatches(copy, patches, comp.prefix, ctx.prefix);
          reid(copy, id.replace(/:/g, '_'), comp.prefix);
          copy.id = id.replace(/:/g, '_');
          const node = convert(copy, { ...ctx, prefix: comp.prefix });
          if (node) {
            node.id = id;
            counts.refExpanded = (counts.refExpanded ?? 0) + 1;
          }
          return node;
        }
        if (!comp) warn.add('Instâncias de componentes que não estão no arquivo aparecem como “componente ausente”');
        const inst = { ...base, type: 'instance', componentId: target } as InstanceNode;
        if (n.name === undefined && comp) inst.name = String(comp.node.name ?? 'Instância');
        if (comp) {
          const cw = dim(comp.node.width, ctx), ch = dim(comp.node.height, ctx);
          if (n.width === undefined) inst.width = cw.value ?? 100;
          if (n.height === undefined) inst.height = ch.value ?? 40;
        }
        const s = sizing(false);
        if (s) inst.sizing = s;
        const fills = paints(n.fill, ctx);
        if (fills.length) inst.fills = fills;
        const st = strokesOf(n, ctx);
        if (st) inst.strokes = st;
        const r = radiusOf(n.cornerRadius, ctx);
        if (r !== undefined) inst.cornerRadius = r;
        const ov: Record<string, InstanceOverride> = {};
        for (const [path, p] of Object.entries(patches)) {
          const k = path.split('/').map((seg) => q(ctx.prefix, seg)).join('/');
          const o: InstanceOverride = {};
          if (p.content !== undefined) {
            const c = textContent(p.content, ctx);
            o.text = c.text;
            if (c.runs.length) o.runs = c.runs;
          }
          if (p.enabled !== undefined) o.visible = val(p.enabled, ctx) !== false;
          if (p.fill !== undefined) o.fills = paints(p.fill, ctx);
          ov[k] = o;
        }
        if (Object.keys(ov).length) inst.overrides = ov;
        return inst;
      }
      case 'text': {
        const size = num(n.fontSize, ctx, 14);
        const family = String(val(n.fontFamily, ctx) ?? 'Inter').split(',')[0].replace(/["']/g, '').trim() || 'Inter';
        fonts.add(family);
        const weight = weightOf(n.fontWeight, ctx);
        const style: TextStyle = { family, weight, size };
        const lh = val(n.lineHeight, ctx);
        if (typeof lh === 'number' && lh > 0) style.lineHeight = r2(lh <= 4 ? lh * size : lh);
        else style.lineHeight = 'auto';
        if (n.letterSpacing) style.letterSpacing = r2(num(n.letterSpacing, ctx));
        const align = { center: 'center', right: 'right', end: 'right', justify: 'justify' }[String(n.textAlign)];
        if (align) style.align = align as TextStyle['align'];
        const valign = { middle: 'middle', center: 'middle', bottom: 'bottom', end: 'bottom' }[String(n.textAlignVertical ?? n.verticalAlign)];
        if (valign) style.verticalAlign = valign as TextStyle['verticalAlign'];
        if (n.fontStyle === 'italic') style.italic = true;
        if (n.textDecoration === 'underline' || n.underline) style.decoration = 'underline';
        if (n.textDecoration === 'line-through' || n.strikethrough) style.decoration = 'strikethrough';
        const growth = String(n.textGrowth ?? 'auto');
        const autoResize = growth === 'fixed-width' ? 'height' : growth === 'fixed-width-height' || growth === 'fixed' ? 'none' : 'width';
        const fills = paints(n.fill, ctx);
        const content = textContent(n.content, ctx, style);
        const t = { ...base, type: 'text', text: content.text, style, autoResize, fills: fills.length ? fills : [{ type: 'solid', color: '#000000' }] } as TextNode;
        if (content.runs.length) t.runs = content.runs;
        if (autoResize !== 'width' && !t.width) t.width = ctx.parentW ?? 200;
        const s = sizing(false);
        if (s) t.sizing = s;
        if (s?.horizontal === 'fill' && t.autoResize === 'width') t.autoResize = 'height';
        return t;
      }
      case 'rectangle':
      case 'ellipse': {
        const out = { ...base, type: type === 'rectangle' ? 'rect' : 'ellipse' } as ShapeNode;
        const fills = paints(n.fill, ctx);
        if (fills.length) out.fills = fills;
        const st = strokesOf(n, ctx);
        if (st) out.strokes = st;
        const r = radiusOf(n.cornerRadius, ctx);
        if (r && type === 'rectangle') out.cornerRadius = r;
        const s = sizing(false);
        if (s) out.sizing = s;
        return out;
      }
      case 'line': {
        const st = strokesOf(n, ctx) ?? [{ paint: { type: 'solid', color: '#000000' }, width: 1, align: 'center' }];
        return { ...base, type: 'line', height: 0, strokes: st } as ShapeNode;
      }
      case 'path': {
        const vb = (Array.isArray(n.viewBox) ? n.viewBox : [0, 0, base.width || 1, base.height || 1]).map(Number);
        const sx = vb[2] ? (base.width || vb[2]) / vb[2] : 1, sy = vb[3] ? (base.height || vb[3]) / vb[3] : 1;
        let d = String(n.geometry ?? '');
        try {
          d = serializePath(mapPoints(parsePath(d), (p) => ({ x: (p.x - vb[0]) * sx, y: (p.y - vb[1]) * sy })));
        } catch {
          d = '';
        }
        if (!d) return null;
        const out = { ...base, type: 'path', d, width: base.width || vb[2], height: base.height || vb[3] } as PathNode;
        if (n.fillRule === 'evenodd') out.fillRule = 'evenodd';
        const fills = paints(n.fill, ctx);
        if (fills.length) out.fills = fills;
        const st = strokesOf(n, ctx);
        if (st) out.strokes = st;
        return out;
      }
      case 'icon': {
        const library = String(n.library ?? 'lucide');
        const iconName = String(val(n.icon, ctx) ?? '');
        const color = paints(n.fill, ctx);
        const shape = input.icons?.(library, iconName) ?? null;
        const width = base.width || 24, height = base.height || 24;
        if (shape) {
          const k = Math.min(width, height) / shape.size;
          const d = serializePath(mapPoints(parsePath(shape.d), (p) => ({ x: p.x * k + (width - shape.size * k) / 2, y: p.y * k + (height - shape.size * k) / 2 })));
          const out = { ...base, type: 'path', name: base.name, width, height, d } as PathNode;
          if (shape.stroke) {
            out.fills = [];
            out.strokes = [{ paint: color[0] ?? { type: 'solid', color: '#000000' }, width: r2((shape.strokeWidth ?? 2) * k), align: 'center', cap: 'round', join: 'round' }];
          } else out.fills = color.length ? color : [{ type: 'solid', color: '#000000' }];
          return out;
        }
        if (/material/i.test(library)) {
          // fontes de ícones do Material desenham o ícone pelo nome (ligadura)
          fonts.add(library);
          return { ...base, type: 'text', width, height, text: iconName, autoResize: 'none', fills: color.length ? color : [{ type: 'solid', color: '#000000' }], style: { family: library, weight: 400, size: Math.min(width, height), lineHeight: Math.min(width, height), align: 'center', verticalAlign: 'middle' } } as TextNode;
        }
        warn.add(`Ícone “${iconName}” (${library}) virou um marcador: o desenho dele não está disponível`);
        return { ...base, type: 'rect', width, height, cornerRadius: 3, fills: [], strokes: [{ paint: color[0] ?? { type: 'solid', color: '#000000' }, width: 1, align: 'inside', dash: [2, 2] }] } as ShapeNode;
      }
      case 'note': {
        const text = { id: `${id}-texto`, type: 'text', name: 'Nota', x: 12, y: 12, width: Math.max(40, (base.width || 240) - 24), height: 20, text: String(n.content ?? ''), autoResize: 'height', fills: [{ type: 'solid', color: '#3a3320' }], style: { family: 'Inter', weight: 400, size: 13, lineHeight: 'auto' } } as TextNode;
        return { ...base, type: 'frame', name: base.name || 'Nota', width: base.width || 240, height: base.height || 160, fills: [{ type: 'solid', color: '#f6e7a6' }], cornerRadius: 4, clip: true, children: [text] } as ContainerNode;
      }
      default:
        warn.add(`Camadas do tipo “${type}” não têm equivalente e ficaram de fora`);
        return null;
    }
  }

  function radiusOf(raw: any, ctx: Ctx): number | [number, number, number, number] | undefined {
    if (raw === undefined) return undefined;
    if (Array.isArray(raw)) {
      const v = raw.map((x) => num(x, ctx));
      const r: [number, number, number, number] = v.length === 4 ? [v[0], v[1], v[2], v[3]] : [v[0], v[0], v[0], v[0]];
      return r.every((x) => x === r[0]) ? r[0] || undefined : r;
    }
    const v = num(raw, ctx);
    return v || undefined;
  }

  /** Frames sem auto layout e sem tamanho: a caixa envolve os filhos. */
  function fitToChildren(f: ContainerNode, wm: string, hm: string) {
    if (!f.children.length) return;
    if (!f.width && (wm === 'auto' || wm === 'hug')) f.width = Math.max(...f.children.map((c) => c.x + c.width));
    if (!f.height && (hm === 'auto' || hm === 'hug')) f.height = Math.max(...f.children.map((c) => c.y + c.height));
  }

  // ── Páginas: o arquivo principal e uma por biblioteca ──
  const pages: Page[] = [];
  for (const f of files) {
    const ctx: Ctx = { theme: { ...defaultTheme }, prefix: f.prefix, parentLayout: false };
    const children = convertList(f.json.children ?? [], ctx);
    if (!children.length && f.prefix) continue;
    pages.push({ id: `pagina-${pages.length + 1}`, name: f.prefix ? `Biblioteca: ${f.label}` : 'Página 1', background: '#f4f2ee', children });
  }

  const doc = newDocument(name, pages);
  doc.variables = [...collections.values()].filter((c) => c.variables.length);
  doc.assets = assets;
  counts.total = pages.reduce((s, p) => s + countNodes(p.children), 0);
  return { doc, report: { warnings: warn.list(), fonts: [...fonts], counts } };
}
