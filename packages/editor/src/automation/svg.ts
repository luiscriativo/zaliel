// SVG → camadas editáveis (um frame com um vetor por forma). Para logos, ilustrações
// e ícones que não vêm da biblioteca embutida.
import { createNode, multiply, apply, svgShapeToPath, type ContainerNode, type Mat, type Paint, type SceneNode, type Stroke } from '@zaliel/core';
import { SpecError, parseColor, type Converter, type NodeSpec } from './spec';

interface Inherited {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  fillRule: string;
  cap: string;
  join: string;
  dash: number[] | null;
}

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** "translate(10 20) rotate(45) scale(2)" etc. → matriz. */
function parseTransform(s: string | null): Mat {
  if (!s) return IDENTITY;
  let m: Mat = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(s))) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let k: Mat = IDENTITY;
    switch (t[1]) {
      case 'matrix':
        k = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case 'translate':
        k = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        k = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
        const cx = a[1] ?? 0, cy = a[2] ?? 0;
        k = multiply(multiply([1, 0, 0, 1, cx, cy], [c, sn, -sn, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX':
        k = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        k = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, k);
  }
  return m;
}

type CssRule = { selector: string; decls: Record<string, string> };

function parseDecls(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of text.split(';')) {
    const [k, ...v] = decl.split(':');
    if (k && v.length) out[k.trim()] = v.join(':').trim();
  }
  return out;
}

/** Regras dos blocos <style> (comum em SVG exportado do Illustrator: `.st0{fill:#727575;}`). Só seletores simples. */
function parseCss(root: Element): CssRule[] {
  const rules: CssRule[] = [];
  for (const st of Array.from(root.getElementsByTagName('style'))) {
    const text = (st.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const decls = parseDecls(m[2]);
      for (const sel of m[1].split(',')) if (sel.trim()) rules.push({ selector: sel.trim(), decls });
    }
  }
  return rules;
}

/** `tag`, `.classe`, `#id` e combinações como `path.st0` (sem descendentes nem pseudo-classes). */
function matches(el: Element, selector: string): boolean {
  if (!/^[a-zA-Z0-9_-]*([.#][a-zA-Z0-9_-]+)*$/.test(selector)) return false;
  const tag = selector.match(/^[a-zA-Z0-9_-]+/)?.[0];
  if (tag && el.tagName.toLowerCase().replace(/^svg:/, '') !== tag.toLowerCase()) return false;
  const classes = (el.getAttribute('class') ?? '').split(/\s+/);
  for (const part of selector.match(/[.#][a-zA-Z0-9_-]+/g) ?? []) {
    if (part[0] === '.' && !classes.includes(part.slice(1))) return false;
    if (part[0] === '#' && el.getAttribute('id') !== part.slice(1)) return false;
  }
  return true;
}

/** Atributos + regras de <style> + o que vier em style="…" (nessa ordem de prioridade, como no navegador). */
function attrsOf(el: Element, css: CssRule[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) out[a.name] = a.value;
  for (const r of css) if (matches(el, r.selector)) Object.assign(out, r.decls);
  Object.assign(out, parseDecls(el.getAttribute('style') ?? ''));
  return out;
}

function withAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const base = hex.length === 9 ? hex.slice(0, 7) : hex;
  const a0 = hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1;
  return `${base}${Math.round(Math.max(0, Math.min(1, a0 * alpha)) * 255).toString(16).padStart(2, '0')}`;
}

export function svgToNodes(conv: Converter, spec: NodeSpec, geom: { x: number; y: number; width: number; height: number }): ContainerNode | null {
  const ed = conv.ctx;
  const host = ed.ed.host;
  if (!host) return null;
  const doc = new DOMParser().parseFromString(String(spec.svg).trim(), 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new SpecError('SVG inválido (precisa começar com <svg>)');
  const css = parseCss(root);
  const ra = attrsOf(root, css);
  const vb = (ra.viewBox ?? ra.viewbox ?? '').split(/[\s,]+/).map(Number);
  const vbW = vb.length === 4 && vb[2] > 0 ? vb[2] : parseFloat(ra.width) || 100;
  const vbH = vb.length === 4 && vb[3] > 0 ? vb[3] : parseFloat(ra.height) || 100;
  const vx = vb.length === 4 ? vb[0] : 0, vy = vb.length === 4 ? vb[1] : 0;
  const W = typeof spec.width === 'number' ? spec.width : typeof spec.height === 'number' ? (spec.height * vbW) / vbH : parseFloat(ra.width) || vbW;
  const H = typeof spec.height === 'number' ? spec.height : typeof spec.width === 'number' ? (spec.width * vbH) / vbW : parseFloat(ra.height) || vbH;
  // preserveAspectRatio padrão: xMidYMid meet (escala única, centralizado)
  const s = Math.min(W / vbW, H / vbH);
  const base: Mat = [s, 0, 0, s, (W - vbW * s) / 2 - vx * s, (H - vbH * s) / 2 - vy * s];
  const current = typeof spec.color === 'string' ? parseColor(spec.color) ?? '#000000' : '#000000';

  const defs = new Map<string, Element>();
  for (const el of Array.from(root.querySelectorAll('[id]'))) defs.set(el.getAttribute('id')!, el);

  const children: SceneNode[] = [];
  const skipped = new Set<string>();

  const gradient = (ref: string, shapeBox: { x: number; y: number; width: number; height: number }, m: Mat): Paint | null => {
    const id = ref.match(/url\(\s*#([^)\s]+)\s*\)/)?.[1];
    const g = id ? defs.get(id) : undefined;
    if (!g) return null;
    // herda as paradas de outro gradiente (xlink:href)
    let stopsEl = g;
    const href = (g.getAttribute('href') ?? g.getAttribute('xlink:href') ?? '').replace('#', '');
    if (!g.querySelector('stop') && href && defs.get(href)) stopsEl = defs.get(href)!;
    const stops = Array.from(stopsEl.querySelectorAll('stop')).map((st) => {
      const a = attrsOf(st, css);
      const off = a.offset?.endsWith('%') ? parseFloat(a.offset) / 100 : parseFloat(a.offset ?? '0');
      const c = parseColor(a['stop-color'] === 'currentColor' ? current : a['stop-color'] ?? '#000000') ?? '#000000';
      return { offset: Math.max(0, Math.min(1, off || 0)), color: withAlpha(c, a['stop-opacity'] !== undefined ? parseFloat(a['stop-opacity']) : 1) };
    });
    if (stops.length < 2) return stops[0] ? { type: 'solid', color: stops[0].color } : null;
    const a = attrsOf(g, css);
    const user = a.gradientUnits === 'userSpaceOnUse';
    const val = (v: string | undefined, d: number, size: number) => (v === undefined ? d : v.endsWith('%') ? (parseFloat(v) / 100) * (user ? size : 1) : parseFloat(v));
    const norm = (p: { x: number; y: number }) => {
      if (!user) return p;
      const q = apply(m, p);
      return { x: shapeBox.width ? (q.x - shapeBox.x) / shapeBox.width : 0.5, y: shapeBox.height ? (q.y - shapeBox.y) / shapeBox.height : 0.5 };
    };
    if (g.tagName.toLowerCase() === 'radialgradient') {
      const c = norm({ x: val(a.cx, user ? 0 : 0.5, vbW), y: val(a.cy, user ? 0 : 0.5, vbH) });
      const r = val(a.r, 0.5, vbW);
      const edge = norm({ x: val(a.cx, 0.5, vbW) + r, y: val(a.cy, 0.5, vbH) });
      return { type: 'radial', stops, handles: { from: c, to: user ? edge : { x: c.x + r, y: c.y } } };
    }
    return {
      type: 'linear',
      stops,
      handles: { from: norm({ x: val(a.x1, 0, vbW), y: val(a.y1, 0, vbH) }), to: norm({ x: val(a.x2, 1, vbW), y: val(a.y2, 0, vbH) }) },
    };
  };

  const visit = (el: Element, m: Mat, inh: Inherited) => {
    const tag = el.tagName.toLowerCase().replace(/^svg:/, '');
    if (['defs', 'clippath', 'mask', 'lineargradient', 'radialgradient', 'title', 'desc', 'metadata', 'style', 'symbol', 'pattern', 'filter'].includes(tag)) return;
    const a = attrsOf(el, css);
    if (a.display === 'none' || a.visibility === 'hidden') return;
    const mm = multiply(m, parseTransform(a.transform ?? null));
    const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : parseFloat(v));
    const st: Inherited = {
      fill: a.fill !== undefined ? a.fill : inh.fill,
      stroke: a.stroke !== undefined ? a.stroke : inh.stroke,
      strokeWidth: num(a['stroke-width'], inh.strokeWidth),
      opacity: inh.opacity * num(a.opacity, 1),
      fillOpacity: a['fill-opacity'] !== undefined ? parseFloat(a['fill-opacity']) : inh.fillOpacity,
      strokeOpacity: a['stroke-opacity'] !== undefined ? parseFloat(a['stroke-opacity']) : inh.strokeOpacity,
      fillRule: a['fill-rule'] ?? a['clip-rule'] ?? inh.fillRule,
      cap: a['stroke-linecap'] ?? inh.cap,
      join: a['stroke-linejoin'] ?? inh.join,
      dash: a['stroke-dasharray'] && a['stroke-dasharray'] !== 'none' ? a['stroke-dasharray'].split(/[\s,]+/).map(Number).filter(Number.isFinite) : inh.dash,
    };
    if (tag === 'g' || tag === 'svg' || tag === 'a') {
      for (const c of Array.from(el.children)) visit(c, mm, st);
      return;
    }
    if (tag === 'use') {
      const id = (a.href ?? a['xlink:href'] ?? '').replace('#', '');
      const ref = defs.get(id);
      if (ref) visit(ref, multiply(mm, [1, 0, 0, 1, num(a.x, 0), num(a.y, 0)]), st);
      return;
    }
    const d = svgShapeToPath(tag, a);
    if (!d) {
      if (!['g', 'svg'].includes(tag)) skipped.add(tag);
      return;
    }
    const norm = host.normalizePath(d, mm, st.fillRule === 'evenodd');
    if (!norm || (!norm.width && !norm.height)) return;
    const colorOf = (v: string | null) => (v === 'currentColor' ? current : v);
    let fills: Paint[] = [];
    const fv = colorOf(st.fill);
    const box = { x: norm.x, y: norm.y, width: norm.width, height: norm.height };
    if (fv && fv !== 'none' && tag !== 'line' && tag !== 'polyline') {
      if (fv.startsWith('url(')) {
        const g = gradient(fv, box, mm);
        if (g) fills = [st.fillOpacity < 1 ? { ...g, opacity: st.fillOpacity } : g];
      } else {
        const c = parseColor(fv);
        if (c) fills = [{ type: 'solid', color: withAlpha(c, st.fillOpacity) }];
      }
    }
    let strokes: Stroke[] = [];
    const sv = colorOf(st.stroke);
    if (sv && sv !== 'none' && st.strokeWidth > 0) {
      const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2]));
      const paint: Paint | null = sv.startsWith('url(') ? gradient(sv, box, mm) : parseColor(sv) ? { type: 'solid', color: withAlpha(parseColor(sv)!, st.strokeOpacity) } : null;
      if (paint) {
        strokes = [{
          paint,
          width: Math.round(st.strokeWidth * scale * 100) / 100,
          align: 'center',
          ...(st.cap === 'round' || st.cap === 'square' ? { cap: st.cap } : {}),
          ...(st.join === 'round' || st.join === 'bevel' ? { join: st.join } : {}),
          ...(st.dash?.length ? { dash: st.dash.map((v) => v * scale) } : {}),
        }];
      }
    }
    if (!fills.length && !strokes.length) return;
    const node = createNode('path', { x: Math.round(norm.x * 100) / 100, y: Math.round(norm.y * 100) / 100, width: Math.max(0.01, norm.width), height: Math.max(0.01, norm.height) }, {
      d: norm.d,
      name: a.id ?? a['data-name'] ?? (tag === 'path' ? 'Vetor' : tag),
      fills,
      strokes,
      ...(st.fillRule === 'evenodd' ? { fillRule: 'evenodd' as const } : {}),
      ...(st.opacity < 1 ? { opacity: Math.round(st.opacity * 1000) / 1000 } : {}),
    });
    children.push(node);
  };

  const rootInh: Inherited = { fill: '#000000', stroke: null, strokeWidth: 1, opacity: 1, fillOpacity: 1, strokeOpacity: 1, fillRule: 'nonzero', cap: 'butt', join: 'miter', dash: null };
  const rootAttrs = attrsOf(root, css);
  if (rootAttrs.fill) rootInh.fill = rootAttrs.fill;
  if (rootAttrs.stroke) rootInh.stroke = rootAttrs.stroke;
  if (rootAttrs['stroke-width']) rootInh.strokeWidth = parseFloat(rootAttrs['stroke-width']);
  if (rootAttrs['stroke-linecap']) rootInh.cap = rootAttrs['stroke-linecap'];
  if (rootAttrs['stroke-linejoin']) rootInh.join = rootAttrs['stroke-linejoin'];
  for (const c of Array.from(root.children)) visit(c, base, rootInh);

  if (skipped.size) ed.warn(`SVG: ${[...skipped].join(', ')} não ${skipped.size === 1 ? 'é convertido' : 'são convertidos'} (texto vira forma só se já vier como caminho)`);
  if (!children.length) throw new SpecError('o SVG não tem nenhuma forma desenhável');
  return createNode('frame', { x: geom.x, y: geom.y, width: Math.round(W * 100) / 100, height: Math.round(H * 100) / 100 }, { name: spec.name ?? 'SVG', fills: [], clip: false, children });
}
