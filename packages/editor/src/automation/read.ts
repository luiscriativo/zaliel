// Leitura para a automação: camadas no mesmo formato da escrita, inspeção do layout
// (o que está cortado, sobrando, com pouco contraste) e o inventário do design.
import {
  allStyles,
  findVariable,
  multiply,
  nodeMatrix,
  apply,
  resolvePaint,
  propertyValues,
  propertyDefs,
  walk,
  runsToSpans,
  type TextRun,
  type Mat,
  type SceneNode,
  type ContainerNode,
  type Paint,
  type Stroke,
  strokeSides,
  type Effect,
  type InstanceNode,
  type TextNode,
} from '@zaliel/core';
import type { Editor } from '../editor';

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Pintura no formato curto: "#hex", "$variável" ou objeto. */
export function paintOut(ed: Editor, p: Paint): unknown {
  if (p.type === 'solid') {
    if (p.variable) {
      const v = findVariable(ed.doc, p.variable);
      if (v) return `$${v.variable.name}`;
    }
    return p.opacity !== undefined && p.opacity < 1 ? { color: p.color, opacity: p.opacity } : p.color;
  }
  if (p.type === 'image') return { type: 'image', asset: p.asset, fit: p.scaleMode };
  const h = p.handles;
  const angle = h && p.type === 'linear' ? Math.round((Math.atan2(h.to.x - h.from.x, -(h.to.y - h.from.y)) * 180) / Math.PI + 360) % 360 : undefined;
  return { type: p.type, ...(angle !== undefined ? { angle } : {}), stops: p.stops.map((s) => ({ offset: r1(s.offset * 100) / 100, color: s.color })) };
}

function paintsOut(ed: Editor, list: Paint[] | undefined): unknown {
  const vis = (list ?? []).filter((p) => p.visible !== false);
  if (!vis.length) return undefined;
  return vis.length === 1 ? paintOut(ed, vis[0]) : vis.map((p) => paintOut(ed, p));
}

function strokesOut(ed: Editor, list: Stroke[] | undefined): unknown {
  const vis = (list ?? []).filter((s) => s.visible !== false);
  if (!vis.length) return undefined;
  // lados: só os que têm contorno, no mesmo formato aceito na criação ({bottom: 1})
  const sides = (s: Stroke) => {
    const d = strokeSides(s);
    if (!d) return {};
    return { sides: Object.fromEntries((['top', 'right', 'bottom', 'left'] as const).filter((k) => d[k] > 0).map((k) => [k, d[k]])) };
  };
  const one = (s: Stroke) => ({ color: paintOut(ed, s.paint), width: s.width, align: s.align, ...sides(s), ...(s.dash?.length ? { dash: s.dash } : {}), ...(s.cap ? { cap: s.cap } : {}), ...(s.join ? { join: s.join } : {}) });
  return vis.length === 1 ? one(vis[0]) : vis.map(one);
}

function effectsOut(list: Effect[] | undefined): unknown {
  const vis = (list ?? []).filter((e) => e.visible !== false);
  if (!vis.length) return undefined;
  return vis.map((e) => (e.type === 'drop-shadow' || e.type === 'inner-shadow' ? { type: e.type === 'drop-shadow' ? 'shadow' : 'inner-shadow', color: e.color, x: e.x, y: e.y, blur: e.blur, ...(e.spread ? { spread: e.spread } : {}) } : { type: e.type === 'layer-blur' ? 'blur' : 'background-blur', radius: (e as { radius: number }).radius }));
}

function styleName(ed: Editor, id: string | undefined): string | undefined {
  return id ? allStyles(ed.doc).find((s) => s.id === id)?.name : undefined;
}

/** Caminho de nomes até um nó dentro do componente (para "overrides"). */
function overridePath(ed: Editor, main: ContainerNode, key: string): string {
  const ids = key.split('/');
  const names: string[] = [];
  let list: SceneNode[] = main.children;
  for (const id of ids) {
    // caminho de nomes até a camada (passando pelos frames do meio)
    const trail = (nodes: SceneNode[], acc: string[]): string[] | null => {
      for (const n of nodes) {
        if (n.id === id) return [...acc, n.name];
        if ('children' in n) {
          const r = trail(n.children, [...acc, n.name]);
          if (r) return r;
        }
      }
      return null;
    };
    const path = trail(list, []);
    if (!path) return key;
    names.push(...path);
    let found: SceneNode | undefined;
    walk(list, (n) => {
      if (n.id === id) found = n;
      return found ? false : undefined;
    });
    if (found?.type === 'instance') list = ed.findComponent(found.componentId, found.library)?.children ?? [];
  }
  return names.join(' > ');
}

/** Trechos de estilo no mesmo formato de `spans` da escrita. */
function spansOut(text: string, runs: TextRun[]): Record<string, unknown>[] {
  return runsToSpans(text, runs).map(({ family, ...s }) => (family !== undefined ? { ...s, font: family } : s));
}

/** Uma camada no formato de leitura/escrita da automação. */
export function nodeOut(ed: Editor, n: SceneNode, depth: number): Record<string, unknown> {
  const o: Record<string, unknown> = { id: n.id, type: n.type === 'boolean' ? `boolean:${n.booleanOp}` : n.type, name: n.name, x: r1(n.x), y: r1(n.y), width: r1(n.width), height: r1(n.height) };
  if (n.sizing && (n.sizing.horizontal !== 'fixed' || n.sizing.vertical !== 'fixed')) o.layoutSizing = { horizontal: n.sizing.horizontal, vertical: n.sizing.vertical };
  if (n.visible === false) o.visible = false;
  if (n.locked) o.locked = true;
  if (n.rotation) o.rotation = n.rotation;
  if (n.opacity !== undefined && n.opacity < 1) o.opacity = n.opacity;
  if (n.flipX) o.flipX = true;
  if (n.flipY) o.flipY = true;
  if (n.absolute) o.absolute = true;
  if (n.type === 'text') {
    o.text = n.text;
    const st = n.style;
    Object.assign(o, { font: st.family, size: st.size, weight: st.weight, ...(st.italic ? { italic: true } : {}), lineHeight: st.lineHeight ?? 'auto', ...(st.letterSpacing ? { letterSpacing: st.letterSpacing } : {}), align: st.align ?? 'left', ...(st.verticalAlign && st.verticalAlign !== 'top' ? { verticalAlign: st.verticalAlign } : {}), ...(st.decoration && st.decoration !== 'none' ? { decoration: st.decoration } : {}), ...(st.case && st.case !== 'none' ? { case: st.case } : {}), autoResize: n.autoResize === 'none' ? 'fixed' : n.autoResize });
    o.color = paintsOut(ed, n.fills);
    if (n.runs?.length) o.spans = spansOut(n.text, n.runs);
    if (n.textPath) o.textPath = n.textPath;
  } else {
    const f = paintsOut(ed, n.fills);
    if (f !== undefined) o.fill = f;
  }
  const s = strokesOut(ed, n.strokes);
  if (s !== undefined) o.stroke = s;
  if (n.cornerRadius) o.radius = n.cornerRadius;
  const fx = effectsOut(n.effects);
  if (fx) o.effects = fx;
  for (const [slot, key] of [['fill', 'fillStyle'], ['stroke', 'strokeStyle'], ['text', 'textStyle'], ['effect', 'effectStyle']] as const) {
    const name = styleName(ed, n.styles?.[slot]);
    if (name) o[key] = name;
  }
  if (n.type === 'path') {
    if (n.meta?.icon) o.icon = n.meta.icon;
    else o.d = n.d.length > 600 ? `${n.d.slice(0, 600)}…` : n.d;
  }
  if (n.type === 'polygon' || n.type === 'star') o.points = n.points;
  if ('children' in n) {
    const c = n as ContainerNode;
    if (c.layout) o.layout = { direction: c.layout.direction, gap: c.layout.gap, padding: c.layout.padding, align: c.layout.align, justify: c.layout.justify, ...(c.layout.wrap ? { wrap: true } : {}) };
    if (c.clip) o.clip = true;
    if (c.grids?.length) o.grids = c.grids;
    if (c.description) o.description = c.description;
    if (c.variant) o.variant = c.variant;
    if (c.properties?.length) o.properties = c.properties.map((p) => ({ name: p.name, type: p.type, default: p.type === 'swap' ? ed.findComponent(p.default)?.name ?? p.default : p.default }));
    if (depth > 0) o.children = c.children.map((k) => nodeOut(ed, k, depth - 1));
    else if (c.children.length) o.childCount = c.children.length;
  }
  if (n.propRefs) {
    const owner = ed.propertyOwner(n.id);
    const names: Record<string, string> = {};
    for (const [slot, pid] of Object.entries(n.propRefs)) {
      const p = owner?.properties?.find((x) => x.id === pid);
      if (p) names[slot] = p.name;
    }
    if (Object.keys(names).length) o.bind = names;
  }
  if (n.type === 'instance') instanceOut(ed, n, o);
  if (n.interactions?.length) {
    const it = n.interactions[0];
    o.link = { action: it.action, ...(it.target ? { to: it.target, toName: ed.model.index.get(it.target)?.name } : {}), ...(it.transition && it.transition !== 'instant' ? { transition: it.transition } : {}), ...(it.overlay ? { position: it.overlay.position, closeOutside: it.overlay.closeOutside } : {}) };
  }
  return o;
}

function instanceOut(ed: Editor, n: InstanceNode, o: Record<string, unknown>): void {
  const main = ed.findComponent(n.componentId, n.library);
  if (!main) {
    o.component = '(componente ausente)';
    return;
  }
  const set = ed.finder.setOf?.(main.id, n.library);
  o.component = set ? set.name : main.name;
  o.componentId = main.id;
  if (main.variant) o.variant = main.variant;
  const defs = propertyDefs(main, ed.finder, n.library);
  if (defs.length) {
    const vals = propertyValues(defs, n);
    o.props = Object.fromEntries(defs.map((d) => [d.name, d.type === 'swap' ? ed.findComponent(String(vals[d.id]))?.name ?? vals[d.id] : vals[d.id]]));
  }
  if (n.overrides && Object.keys(n.overrides).length) {
    const ov: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(n.overrides)) {
      const entry: Record<string, unknown> = {};
      if (v.text !== undefined) entry.text = v.text;
      if (v.text !== undefined && v.runs?.length) entry.spans = spansOut(v.text, v.runs);
      if (v.fills) entry.fill = paintsOut(ed, v.fills);
      if (v.strokes) entry.stroke = strokesOut(ed, v.strokes);
      if (v.visible !== undefined) entry.visible = v.visible;
      if (v.opacity !== undefined) entry.opacity = v.opacity;
      if (v.width !== undefined) entry.width = v.width;
      if (v.height !== undefined) entry.height = v.height;
      if (v.componentId) {
        const swapped = ed.findComponent(v.componentId);
        if (swapped?.variant) entry.variant = swapped.variant;
        else entry.component = swapped?.name ?? v.componentId;
      }
      if (Object.keys(entry).length) ov[overridePath(ed, main, key)] = entry;
    }
    if (Object.keys(ov).length) o.overrides = ov;
  }
}

// ── Inspeção ─────────────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Problemas comuns de uma tela: texto cortado, camada fora do frame, contraste baixo, texto pequeno demais. */
export function inspect(ed: Editor, rootId: string): { problems: { id: string; name: string; issue: string }[]; summary: Record<string, number> } {
  const root = ed.model.index.get(rootId);
  if (!root) throw new Error(`camada não encontrada: ${rootId}`);
  const problems: { id: string; name: string; issue: string }[] = [];
  const summary: Record<string, number> = { camadas: 0, textos: 0, instancias: 0 };
  const modes = ed.doc.settings?.modes ?? {};
  /** Cor de fundo que um nó mostra: sólida, média de um gradiente; imagem = desconhecida (undefined). */
  const solid = (n: SceneNode): string | null | undefined => {
    const top = (n.fills ?? []).filter((f) => f.visible !== false).reverse()[0];
    if (!top) return null;
    if (top.type === 'image') return undefined;
    if (top.type !== 'solid') {
      const cs = top.stops.map((s) => [1, 3, 5].map((i) => parseInt(s.color.slice(i, i + 2), 16)));
      const avg = [0, 1, 2].map((k) => Math.round(cs.reduce((a, c) => a + c[k], 0) / cs.length));
      return `#${avg.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    }
    const rp = resolvePaint(ed.doc, top, modes);
    return rp.type === 'solid' && rp.color.length >= 7 && (rp.color.length === 7 || parseInt(rp.color.slice(7), 16) > 200) ? rp.color.slice(0, 7) : null;
  };
  // percorre a árvore exibida (instâncias resolvidas), levando a cor de fundo mais próxima
  const visit = (raw: SceneNode, m: Mat, clipRect: { x: number; y: number; w: number; h: number } | null, bg: string | null | undefined, real: boolean) => {
    if (raw.visible === false) return;
    const n = ed.resolve(raw);
    const nm = multiply(m, nodeMatrix(n));
    const a = apply(nm, { x: 0, y: 0 }), b = apply(nm, { x: n.width, y: n.height });
    const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    summary.camadas++;
    if (raw.type === 'instance') summary.instancias++;
    const id = raw.id;
    if (clipRect && real) {
      const out = box.x < clipRect.x - 0.5 || box.y < clipRect.y - 0.5 || box.x + box.w > clipRect.x + clipRect.w + 0.5 || box.y + box.h > clipRect.y + clipRect.h + 0.5;
      const gone = box.x >= clipRect.x + clipRect.w || box.y >= clipRect.y + clipRect.h || box.x + box.w <= clipRect.x || box.y + box.h <= clipRect.y;
      if (gone) problems.push({ id, name: raw.name, issue: 'fica totalmente fora da área visível do frame (cortado)' });
      else if (out && n.type !== 'frame') problems.push({ id, name: raw.name, issue: 'passa da borda do frame e aparece cortado' });
    }
    if (n.width < 0.5 && n.height < 0.5 && n.type !== 'line') problems.push({ id, name: raw.name, issue: 'tamanho zero' });
    if (n.type === 'text') {
      summary.textos++;
      const t = n as TextNode;
      if (ed.host) {
        const need = ed.host.measureText(t, t.autoResize === 'width' ? Infinity : t.width);
        if (t.autoResize === 'none' && need.height > t.height + 1) problems.push({ id, name: raw.name, issue: `texto não cabe na caixa (precisa de ${Math.ceil(need.height)}px de altura, tem ${Math.round(t.height)}px)` });
        if (t.autoResize !== 'width' && t.text.length > 2) {
          const one = ed.host.measureText(t, Infinity);
          const words = t.text.split(/\s+/).filter(Boolean);
          if (words.length > 1 && one.width > t.width && t.width < t.style.size * 3) problems.push({ id, name: raw.name, issue: 'caixa de texto estreita demais: quebra em muitas linhas' });
        }
        if (!ed.host.fonts.has(t.style.family)) problems.push({ id, name: raw.name, issue: `fonte “${t.style.family}” não instalada (aparece com Inter)` });
      }
      if (t.style.size < 11) problems.push({ id, name: raw.name, issue: `texto de ${t.style.size}px: pequeno demais para ler` });
      const fg = solid(t);
      if (fg && bg) {
        const ratio = contrast(fg, bg);
        const large = t.style.size >= 18 || (t.style.size >= 14 && t.style.weight >= 700);
        if (ratio < (large ? 3 : 4.5)) problems.push({ id, name: raw.name, issue: `contraste baixo com o fundo (${ratio.toFixed(2)}:1; o mínimo é ${large ? '3' : '4.5'}:1)` });
      }
    }
    if (raw.type === 'instance' && n === raw) problems.push({ id, name: raw.name, issue: 'componente da instância não encontrado' });
    if ('children' in n) {
      const c = n as ContainerNode;
      const own = solid(n);
      const nextBg = own === null ? bg : own; // sem preenchimento: continua o fundo de fora
      const nextClip = c.clip && n.type !== 'group' ? box : clipRect;
      // textos vizinhos que se sobrepõem num frame sem auto layout
      if (!c.layout) {
        const texts = c.children.filter((k) => k.type === 'text' && k.visible !== false && !k.absolute);
        for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
          const p = texts[i], q = texts[j];
          if (p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height) problems.push({ id: q.id, name: q.name, issue: `texto sobreposto a “${p.name}”` });
        }
      }
      for (const k of c.children) visit(k, nm, nextClip, nextBg, real && raw.type !== 'instance');
    }
  };
  const parentM = ed.model.index.parentMatrix(rootId);
  visit(root, parentM, null, ed.page.background ?? null, true);
  // o mesmo problema dentro de várias instâncias de um componente vira uma linha só (corrige-se no componente)
  const grouped = new Map<string, { id: string; name: string; issue: string; count: number }>();
  for (const p of problems) {
    const inner = p.id.includes('/') ? p.id.slice(p.id.lastIndexOf('/') + 1) : null;
    const key = inner ? `${inner}|${p.issue}` : `${p.id}|${p.issue}|${grouped.size}`;
    const g = grouped.get(key);
    if (g) g.count++;
    else grouped.set(key, { ...p, count: 1 });
  }
  const list = [...grouped.values()].map(({ count, ...p }) => (count > 1 ? { ...p, issue: `${p.issue} — o mesmo em ${count} instâncias (corrija no componente)` } : p));
  return { problems: list.slice(0, 80), summary };
}

// ── Inventário (cores, tipografia, medidas) ──────────────────────────────────

export function analyze(ed: Editor, ids: string[] | undefined): Record<string, unknown> {
  const roots = ids?.length ? (ids.map((id) => ed.model.index.get(id)).filter(Boolean) as SceneNode[]) : ed.page.children;
  const colors = new Map<string, { count: number; uses: Set<string>; variable?: string }>();
  const fonts = new Map<string, number>();
  const radii = new Map<string, number>();
  const gaps = new Map<number, number>();
  const paddings = new Map<string, number>();
  const shadows = new Map<string, number>();
  const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
  const color = (p: Paint, use: string) => {
    if (p.type !== 'solid' || p.visible === false) return;
    const v = p.variable ? findVariable(ed.doc, p.variable)?.variable.name : undefined;
    const key = p.color + (v ? ` ($${v})` : '');
    const e = colors.get(key) ?? { count: 0, uses: new Set<string>(), variable: v };
    e.count++;
    e.uses.add(use);
    colors.set(key, e);
  };
  walk(roots, (n) => {
    for (const f of n.fills ?? []) color(f, n.type === 'text' ? 'texto' : 'fundo');
    for (const s of n.strokes ?? []) color(s.paint, 'contorno');
    if (n.type === 'text') bump(fonts, `${n.style.family} ${n.style.weight}${n.style.italic ? ' itálico' : ''} ${n.style.size}px / ${n.style.lineHeight ?? 'auto'}`);
    if (n.cornerRadius) bump(radii, JSON.stringify(n.cornerRadius));
    if ('layout' in n && n.layout) {
      bump(gaps, n.layout.gap);
      bump(paddings, n.layout.padding.join(' '));
    }
    for (const e of n.effects ?? []) if (e.type === 'drop-shadow') bump(shadows, `${e.x} ${e.y} ${e.blur} ${e.spread ?? 0} ${e.color}`);
    if (n.type === 'instance') return false;
  });
  const top = <K>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ value: k, count: c }));
  return {
    colors: [...colors.entries()].sort((a, b) => b[1].count - a[1].count).map(([k, v]) => ({ color: k, count: v.count, usedAs: [...v.uses] })),
    typography: top(fonts),
    radii: top(radii),
    gaps: top(gaps),
    paddings: top(paddings),
    shadows: top(shadows),
  };
}
