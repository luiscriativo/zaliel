// Geometria das formas (usada pelo renderizador e pela exportação) e exportação SVG.
import type { Paint, SceneNode, ShapeNode, Stroke, ZalDocument, Effect } from './types';
import { parseHex } from './util';
import { resolvePaint } from './variables';

/** Caminho SVG de polígono/estrela inscrito na caixa w×h. */
export function polygonPath(n: Pick<ShapeNode, 'type' | 'points' | 'innerRadius'>, w: number, h: number): string {
  const count = Math.max(3, Math.round(n.points ?? (n.type === 'star' ? 5 : 3)));
  const star = n.type === 'star';
  const total = star ? count * 2 : count;
  const inner = n.innerRadius ?? 0.38;
  const pts: string[] = [];
  for (let i = 0; i < total; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / total;
    const r = star && i % 2 === 1 ? inner : 1;
    pts.push(`${(w / 2 + (Math.cos(a) * w * r) / 2).toFixed(3)} ${(h / 2 + (Math.sin(a) * h * r) / 2).toFixed(3)}`);
  }
  return `M${pts.join(' L')} Z`;
}

export function radii(n: SceneNode): [number, number, number, number] {
  const r = n.cornerRadius ?? 0;
  const max = Math.min(n.width, n.height) / 2;
  const arr = typeof r === 'number' ? [r, r, r, r] : r;
  return arr.map((v) => Math.max(0, Math.min(v, max))) as [number, number, number, number];
}

export function roundedRectPath(w: number, h: number, [tl, tr, br, bl]: [number, number, number, number]): string {
  return `M${tl} 0 H${w - tr} ${tr ? `A${tr} ${tr} 0 0 1 ${w} ${tr}` : ''} V${h - br} ${br ? `A${br} ${br} 0 0 1 ${w - br} ${h}` : ''} H${bl} ${bl ? `A${bl} ${bl} 0 0 1 0 ${h - bl}` : ''} V${tl} ${tl ? `A${tl} ${tl} 0 0 1 ${tl} 0` : ''} Z`;
}

// ── Exportação SVG ───────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function color(hex: string, opacity = 1): { fill: string; opacity: number } {
  const c = parseHex(hex);
  return { fill: `rgb(${c.r},${c.g},${c.b})`, opacity: c.a * opacity };
}

interface SvgCtx {
  doc: ZalDocument;
  defs: string[];
  n: number;
}

function paintAttr(ctx: SvgCtx, p: Paint, node: SceneNode, prop: 'fill' | 'stroke'): string {
  p = resolvePaint(ctx.doc, p);
  if (p.type === 'solid') {
    const c = color(p.color, p.opacity ?? 1);
    return `${prop}="${c.fill}"${c.opacity < 1 ? ` ${prop}-opacity="${+c.opacity.toFixed(3)}"` : ''}`;
  }
  const id = `z${ctx.n++}`;
  if (p.type === 'linear' || p.type === 'radial' || p.type === 'angular') {
    const stops = p.stops.map((s) => {
      const c = color(s.color);
      return `<stop offset="${s.offset}" stop-color="${c.fill}"${c.opacity < 1 ? ` stop-opacity="${+c.opacity.toFixed(3)}"` : ''}/>`;
    }).join('');
    const h = p.handles ?? { from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 } };
    if (p.type === 'linear') ctx.defs.push(`<linearGradient id="${id}" x1="${h.from.x}" y1="${h.from.y}" x2="${h.to.x}" y2="${h.to.y}">${stops}</linearGradient>`);
    else {
      const r = Math.hypot(h.to.x - h.from.x, h.to.y - h.from.y) || 0.5;
      ctx.defs.push(`<radialGradient id="${id}" cx="${h.from.x}" cy="${h.from.y}" r="${r}">${stops}</radialGradient>`);
    }
    return `${prop}="url(#${id})"${p.opacity !== undefined && p.opacity < 1 ? ` ${prop}-opacity="${p.opacity}"` : ''}`;
  }
  const img = p as Extract<Paint, { type: 'image' }>;
  const asset = ctx.doc.assets[img.asset];
  if (!asset) return `${prop}="none"`;
  const ar = img.scaleMode === 'fit' ? 'xMidYMid meet' : img.scaleMode === 'stretch' ? 'none' : 'xMidYMid slice';
  ctx.defs.push(`<pattern id="${id}" patternContentUnits="objectBoundingBox" width="1" height="1"><image href="data:${asset.mime};base64,${asset.data}" width="1" height="1" preserveAspectRatio="${ar}"/></pattern>`);
  void node;
  return `${prop}="url(#${id})"`;
}

function shapeElement(n: SceneNode, attrs: string): string {
  switch (n.type) {
    case 'ellipse':
      return `<ellipse cx="${n.width / 2}" cy="${n.height / 2}" rx="${n.width / 2}" ry="${n.height / 2}" ${attrs}/>`;
    case 'line':
      return `<line x1="0" y1="0" x2="${n.width}" y2="${n.height}" ${attrs}/>`;
    case 'polygon':
    case 'star':
      return `<path d="${polygonPath(n, n.width, n.height)}" ${attrs}/>`;
    case 'path':
      return `<path d="${esc(n.d)}"${n.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : ''} ${attrs}/>`;
    default: {
      const r = radii(n);
      if (r.every((v) => v === r[0])) return `<rect width="${n.width}" height="${n.height}"${r[0] ? ` rx="${r[0]}"` : ''} ${attrs}/>`;
      return `<path d="${roundedRectPath(n.width, n.height, r)}" ${attrs}/>`;
    }
  }
}

function strokeAttrs(ctx: SvgCtx, n: SceneNode, s: Stroke): string {
  // SVG só desenha contorno centralizado; "inside/outside" são aproximados dobrando com clip na v1
  const dash = s.dash?.length ? ` stroke-dasharray="${s.dash.join(' ')}"` : '';
  return `fill="none" ${paintAttr(ctx, s.paint, n, 'stroke')} stroke-width="${s.width}"${dash}${s.cap ? ` stroke-linecap="${s.cap}"` : ''}${s.join ? ` stroke-linejoin="${s.join}"` : ''}`;
}

function filterFor(ctx: SvgCtx, effects: Effect[] | undefined): string {
  const fx = (effects ?? []).filter((e) => e.visible !== false && (e.type === 'drop-shadow' || e.type === 'layer-blur'));
  if (!fx.length) return '';
  const id = `z${ctx.n++}`;
  const parts = fx.map((e) => {
    if (e.type === 'drop-shadow') {
      const c = color(e.color);
      return `<feDropShadow dx="${e.x}" dy="${e.y}" stdDeviation="${e.blur / 2}" flood-color="${c.fill}" flood-opacity="${c.opacity}"/>`;
    }
    return `<feGaussianBlur stdDeviation="${(e as { radius: number }).radius / 2}"/>`;
  });
  ctx.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${parts.join('')}</filter>`);
  return ` filter="url(#${id})"`;
}

function nodeToSvg(ctx: SvgCtx, n: SceneNode, resolve: (n: SceneNode) => SceneNode): string {
  if (n.visible === false) return '';
  n = resolve(n);
  const flip = n.flipX || n.flipY ? ` translate(${n.width / 2} ${n.height / 2}) scale(${n.flipX ? -1 : 1} ${n.flipY ? -1 : 1}) translate(${-n.width / 2} ${-n.height / 2})` : '';
  const tf = `translate(${n.x} ${n.y})${n.rotation ? ` rotate(${n.rotation} ${n.width / 2} ${n.height / 2})` : ''}${flip}`;
  const op = n.opacity !== undefined && n.opacity < 1 ? ` opacity="${n.opacity}"` : '';
  const filter = filterFor(ctx, n.effects);
  let body = '';
  const fills = (n.fills ?? []).filter((f) => f.visible !== false);
  const strokes = (n.strokes ?? []).filter((s) => s.visible !== false);
  if (n.type === 'text') {
    const st = n.style;
    const fill = fills[0] ? paintAttr(ctx, fills[0], n, 'fill') : 'fill="none"';
    const lh = typeof st.lineHeight === 'number' ? st.lineHeight : st.size * 1.25;
    const anchor = st.align === 'center' ? 'middle' : st.align === 'right' ? 'end' : 'start';
    const ax = st.align === 'center' ? n.width / 2 : st.align === 'right' ? n.width : 0;
    let lines = n.text.split('\n').map((l, i) => `<tspan x="${ax}" y="${(i + 0.8) * lh}">${esc(l)}</tspan>`).join('');
    let pathAnchor = anchor;
    if (n.textPath) {
      // texto em caminho: <textPath> apontando para a curva nas definições
      const id = `z${ctx.n++}`;
      ctx.defs.push(`<path id="${id}" d="${esc(n.textPath.d)}"/>`);
      const start = n.textPath.start ?? 0;
      const offset = st.align === 'center' ? 50 + start : st.align === 'right' ? 100 : start;
      lines = `<textPath href="#${id}" startOffset="${offset}%"${n.textPath.flip ? ' side="right"' : ''}>${esc(n.text.replace(/\n/g, ' '))}</textPath>`;
      pathAnchor = anchor;
    }
    body = `<text font-family="${esc(st.family)}" font-size="${st.size}" font-weight="${st.weight}"${st.italic ? ' font-style="italic"' : ''}${st.letterSpacing ? ` letter-spacing="${st.letterSpacing}"` : ''} text-anchor="${pathAnchor}" ${fill}>${lines}</text>`;
  } else {
    for (const f of fills) body += shapeElement(n, paintAttr(ctx, f, n, 'fill'));
    if ('children' in n && n.children.length) {
      let inner = n.children.map((c) => nodeToSvg(ctx, c, resolve)).join('');
      if (n.clip && n.type !== 'group') {
        const id = `z${ctx.n++}`;
        ctx.defs.push(`<clipPath id="${id}">${shapeElement(n, '')}</clipPath>`);
        inner = `<g clip-path="url(#${id})">${inner}</g>`;
      }
      body += inner;
    }
    for (const s of strokes) body += shapeElement(n, strokeAttrs(ctx, n, s));
  }
  return `<g id="${esc(n.name)}" transform="${tf}"${op}${filter}>${body}</g>`;
}

/** Exporta um nó (e filhos) como SVG. `resolve` troca instâncias pelo conteúdo do componente. */
export function exportSvg(doc: ZalDocument, node: SceneNode, resolve: (n: SceneNode) => SceneNode = (n) => n): string {
  const ctx: SvgCtx = { doc, defs: [], n: 0 };
  const content = nodeToSvg(ctx, { ...resolve(node), x: 0, y: 0, rotation: 0 }, resolve);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${node.width}" height="${node.height}" viewBox="0 0 ${node.width} ${node.height}">${ctx.defs.length ? `<defs>${ctx.defs.join('')}</defs>` : ''}${content}</svg>\n`;
}
