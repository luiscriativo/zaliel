// Camada por cima do desenho: seleção, alças, guias, nomes dos frames, medidas e caneta.
import type { Canvas, CanvasKit, Paint as SkPaint, Paragraph } from 'canvaskit-wasm';
import { apply, multiply, parseHex, rectCorners, gridBands, gridLines, startScreen, walk, type Mat, type Point, type SceneNode } from '@zaliel/core';
import { toSkMatrix } from '@zaliel/renderer';
import type { CanvasHost } from './host';
import { RULER } from './interaction';
import { curve, handlePoint, linkCurves, screenRect, type LinkCurve } from './links';

const SEL = '#b5822f';
const COMPONENT = '#7d5ba6';
const GUIDE = '#d9583b';

const labels = new Map<string, Paragraph>();

function label(host: CanvasHost, text: string, color: string, size = 11, weight = 500): Paragraph {
  const key = `${text}|${color}|${size}|${weight}`;
  let p = labels.get(key);
  if (p) return p;
  const ck = host.ck;
  const c = parseHex(color);
  const style = new ck.ParagraphStyle({
    textStyle: { color: ck.Color(c.r, c.g, c.b, c.a), fontFamilies: ['Inter'], fontSize: size, fontStyle: { weight: weight >= 600 ? ck.FontWeight.SemiBold : weight >= 500 ? ck.FontWeight.Medium : ck.FontWeight.Normal } },
    maxLines: 1,
    ellipsis: '…',
  });
  const b = ck.ParagraphBuilder.MakeFromFontProvider(style, host.fonts.provider);
  b.addText(text);
  p = b.build();
  b.delete();
  p.layout(1000);
  if (labels.size > 400) {
    const [k, old] = labels.entries().next().value as [string, Paragraph];
    labels.delete(k);
    old.delete();
  }
  labels.set(key, p);
  return p;
}

function luminance(hex: string) {
  const c = parseHex(hex);
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

export function drawOverlay(host: CanvasHost, canvas: Canvas, ck: CanvasKit): void {
  const ed = host.editor;
  const it = host.interaction;
  const z = ed.viewport.zoom;
  const darkBg = luminance(ed.page.background) < 0.45;
  const paints: { delete(): void }[] = [];
  const stroke = (color: string, width = 1, alpha = 1) => {
    const p = new ck.Paint();
    const c = parseHex(color);
    p.setColor(ck.Color(c.r, c.g, c.b, c.a * alpha));
    p.setStyle(ck.PaintStyle.Stroke);
    p.setStrokeWidth(width);
    p.setAntiAlias(true);
    paints.push(p);
    return p;
  };
  const fill = (color: string, alpha = 1) => {
    const p = new ck.Paint();
    const c = parseHex(color);
    p.setColor(ck.Color(c.r, c.g, c.b, c.a * alpha));
    p.setAntiAlias(true);
    paints.push(p);
    return p;
  };
  const poly = (pts: Point[], paint: ReturnType<typeof stroke>, close = true) => {
    const b = new ck.PathBuilder();
    b.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) b.lineTo(p.x, p.y);
    if (close) b.close();
    const path = b.detachAndDelete();
    canvas.drawPath(path, paint);
    path.delete();
  };
  const quadOf = (id: string): Point[] | null => {
    const n = ed.model.index.get(id);
    if (!n) return null;
    const m = ed.model.index.worldMatrix(id);
    return rectCorners({ x: 0, y: 0, width: n.width, height: n.height }).map((p) => ed.worldToScreen(apply(m, p)));
  };
  const colorFor = (n: SceneNode | undefined) => (n && (n.type === 'component' || n.type === 'instance' || n.type === 'component-set') ? COMPONENT : SEL);
  const size = host.size();
  const view: Mat = [z, 0, 0, z, ed.viewport.x, ed.viewport.y];

  // grades de layout dos frames (debaixo de tudo o que é interface)
  if (ed.settings.layoutGrids) {
    walk(ed.page.children, (n) => {
      if (n.visible === false) return false;
      if (!('grids' in n) || !n.grids?.length) return;
      const m = multiply(view, ed.model.index.worldMatrix(n.id));
      canvas.save();
      canvas.concat(toSkMatrix(m));
      canvas.clipRect(ck.LTRBRect(0, 0, n.width, n.height), ck.ClipOp.Intersect, true);
      const k = Math.hypot(m[0], m[1]) || 1;
      for (const g of n.grids) {
        if (g.visible === false) continue;
        if (g.type === 'grid') {
          const l = gridLines(g, n.width, n.height);
          if (g.size * k < 4) continue; // pequena demais para enxergar
          const p = stroke(g.color, 1 / k);
          for (const x of l.xs) canvas.drawLine(x, 0, x, n.height, p);
          for (const y of l.ys) canvas.drawLine(0, y, n.width, y, p);
        } else {
          const p = fill(g.color);
          for (const b of gridBands(g, n.width, n.height)) canvas.drawRect(ck.XYWHRect(b.x, b.y, b.width, b.height), p);
        }
      }
      canvas.restore();
    });
  }

  // grade de pixels em zoom alto
  if (ed.settings.pixelGrid && z >= 8) {
    const size = host.size();
    const a = ed.screenToWorld({ x: 0, y: 0 }), b = ed.screenToWorld({ x: size.width, y: size.height });
    const gp = stroke(darkBg ? '#ffffff' : '#000000', 1, 0.07);
    for (let x = Math.floor(a.x); x <= b.x; x++) {
      const sx = Math.round(ed.worldToScreen({ x, y: 0 }).x) + 0.5;
      canvas.drawLine(sx, 0, sx, size.height, gp);
    }
    for (let y = Math.floor(a.y); y <= b.y; y++) {
      const sy = Math.round(ed.worldToScreen({ x: 0, y }).y) + 0.5;
      canvas.drawLine(0, sy, size.width, sy, gp);
    }
  }

  // nomes dos frames do topo (a área de cada um fica guardada para dar para clicar nele)
  host.frameLabels = [];
  for (const n of ed.page.children) {
    if (n.visible === false || !('children' in n) || n.type === 'group' || n.type === 'boolean') continue;
    const q = quadOf(n.id);
    if (!q) continue;
    const selected = ed.selection.includes(n.id);
    const comp = n.type === 'component' || n.type === 'component-set';
    const color = comp ? COMPONENT : selected ? SEL : darkBg ? '#a8a399' : '#7a746a';
    const name = n.type === 'component' ? `◇ ${n.name}` : n.type === 'component-set' ? `❖ ${n.name}` : n.name;
    const p = label(host, name, color, 11, selected ? 600 : 500);
    const maxW = Math.max(20, Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y));
    if (maxW < 30) continue;
    if (!n.locked) host.frameLabels.push({ id: n.id, x: q[0].x, y: q[0].y, width: Math.min(maxW, Math.ceil(p.getMaxIntrinsicWidth()) + 4), angle: n.rotation ?? 0 });
    canvas.save();
    canvas.translate(q[0].x, q[0].y);
    canvas.rotate(((n.rotation ?? 0)), 0, 0);
    canvas.clipRect(ck.LTRBRect(0, -20, maxW, 0), ck.ClipOp.Intersect, true);
    canvas.drawParagraph(p, 0, -17);
    canvas.restore();
  }

  // destino ao arrastar para dentro de outro frame
  if (it?.dropTarget && it.drag?.kind === 'move') {
    const first = ed.selection[0];
    if (first && ed.model.index.parentId(first) !== it.dropTarget && it.dropTarget !== ed.pageId) {
      const q = quadOf(it.dropTarget);
      if (q) poly(q, stroke(SEL, 2));
    }
  }

  // hover
  if (ed.hover && !ed.selection.includes(ed.hover) && !it?.drag) {
    const q = quadOf(ed.hover);
    if (q) poly(q, stroke(colorFor(ed.model.index.get(ed.hover)), 1.5));
  }

  // seleção
  const sel = ed.selection.filter((id) => ed.model.index.get(id));
  for (const id of sel) {
    const q = quadOf(id);
    if (q) poly(q, stroke(colorFor(ed.model.index.get(id)), 1));
  }
  if (sel.length && it && !ed.editingText && ed.tool === 'move' && !ed.vectorEdit) {
    const quad = it.selectionQuad();
    const moving = it.drag?.kind === 'move' || it.drag?.kind === 'reorder';
    if (quad) {
      const color = sel.length === 1 ? colorFor(ed.model.index.get(sel[0])) : SEL;
      if (!quad.single) poly(quad.pts, stroke(color, 1));
      if (!moving) {
        const hf = fill('#ffffff'), hs = stroke(color, 1);
        for (const h of it.handles()) {
          const r = ck.LTRBRect(h.p.x - 3.5, h.p.y - 3.5, h.p.x + 3.5, h.p.y + 3.5);
          canvas.drawRect(r, hf);
          canvas.drawRect(r, hs);
        }
      }
      // medidas
      const b = ed.selectionBounds();
      if (b) {
        const n = sel.length === 1 ? ed.model.index.get(sel[0])! : null;
        const w = n ? n.width : b.width, h = n ? n.height : b.height;
        const text = n?.type === 'line' ? `${fmt(w)}` : `${fmt(w)} × ${fmt(h)}`;
        const p = label(host, text, '#ffffff', 10.5, 500);
        const tw = Math.ceil(p.getMaxIntrinsicWidth()) + 10;
        const bottom = Math.max(...quad.pts.map((pt) => pt.y));
        const cx = quad.pts.reduce((s, pt) => s + pt.x, 0) / 4;
        const rr = ck.RRectXY(ck.LTRBRect(cx - tw / 2, bottom + 6, cx + tw / 2, bottom + 23), 3, 3);
        canvas.drawRRect(rr, fill(color));
        canvas.drawParagraph(p, cx - tw / 2 + 5, bottom + 8);
      }
    }
  }

  // retângulo de seleção
  if (it?.marquee) {
    const a = ed.worldToScreen({ x: it.marquee.x, y: it.marquee.y });
    const r = ck.LTRBRect(a.x, a.y, a.x + it.marquee.width * z, a.y + it.marquee.height * z);
    canvas.drawRect(r, fill(SEL, 0.08));
    canvas.drawRect(r, stroke(SEL, 1));
  }

  // prévia de criação
  if (it?.preview) {
    const a = ed.worldToScreen({ x: it.preview.x, y: it.preview.y });
    const r = ck.LTRBRect(a.x, a.y, a.x + it.preview.width * z, a.y + it.preview.height * z);
    if (it.drag?.kind === 'create' && it.drag.tool === 'ellipse') canvas.drawOval(r, stroke(SEL, 1));
    else canvas.drawRect(r, stroke(SEL, 1));
    const p = label(host, `${fmt(it.preview.width)} × ${fmt(it.preview.height)}`, '#ffffff', 10.5);
    const tw = Math.ceil(p.getMaxIntrinsicWidth()) + 10;
    const cx = a.x + (it.preview.width * z) / 2, by = a.y + it.preview.height * z;
    canvas.drawRRect(ck.RRectXY(ck.LTRBRect(cx - tw / 2, by + 6, cx + tw / 2, by + 23), 3, 3), fill(SEL));
    canvas.drawParagraph(p, cx - tw / 2 + 5, by + 8);
  }
  if (it?.linePreview) {
    const [a, b] = it.linePreview.map((p) => ed.worldToScreen(p));
    canvas.drawLine(a.x, a.y, b.x, b.y, stroke(SEL, 1.5));
  }

  // guias de encaixe
  if (it?.guides.length) {
    const gp = stroke(GUIDE, 1);
    for (const g of it.guides) {
      if (g.axis === 'x') {
        const a = ed.worldToScreen({ x: g.at, y: g.from }), b = ed.worldToScreen({ x: g.at, y: g.to });
        canvas.drawLine(Math.round(a.x) + 0.5, a.y, Math.round(b.x) + 0.5, b.y, gp);
      } else {
        const a = ed.worldToScreen({ x: g.from, y: g.at }), b = ed.worldToScreen({ x: g.to, y: g.at });
        canvas.drawLine(a.x, Math.round(a.y) + 0.5, b.x, Math.round(b.y) + 0.5, gp);
      }
    }
  }

  // caneta
  if (it && it.pen.length) {
    const pts = it.pen;
    const b = new ck.PathBuilder();
    const s = (p: Point) => ed.worldToScreen(p);
    b.moveTo(s(pts[0].p).x, s(pts[0].p).y);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], c = pts[i];
      const o = s(a.out ?? a.p), n = s(c.in ?? c.p), e = s(c.p);
      b.cubicTo(o.x, o.y, n.x, n.y, e.x, e.y);
    }
    if (!it.drag) {
      const last = pts[pts.length - 1];
      const o = s(last.out ?? last.p), e = s(it.world);
      b.cubicTo(o.x, o.y, e.x, e.y, e.x, e.y);
    }
    const path = b.detachAndDelete();
    canvas.drawPath(path, stroke(SEL, 1.5));
    path.delete();
    const hf = fill('#ffffff'), hs = stroke(SEL, 1), hl = stroke(SEL, 1, 0.6);
    for (const p of pts) {
      const c = s(p.p);
      for (const h of [p.in, p.out]) if (h) {
        const hp = s(h);
        canvas.drawLine(c.x, c.y, hp.x, hp.y, hl);
        canvas.drawCircle(hp.x, hp.y, 3, hf);
        canvas.drawCircle(hp.x, hp.y, 3, hs);
      }
      const r = ck.LTRBRect(c.x - 3.5, c.y - 3.5, c.x + 3.5, c.y + 3.5);
      canvas.drawRect(r, hf);
      canvas.drawRect(r, hs);
    }
  }

  // guias da página
  const guides = ed.page.guides ?? [];
  const gd = it?.drag?.kind === 'guide' ? it.drag : null;
  if (guides.length || gd) {
    const gp = stroke(GUIDE, 1);
    const line = (axis: 'x' | 'y', at: number) => {
      const s = ed.worldToScreen({ x: at, y: at });
      if (axis === 'x') canvas.drawLine(Math.round(s.x) + 0.5, 0, Math.round(s.x) + 0.5, size.height, gp);
      else canvas.drawLine(0, Math.round(s.y) + 0.5, size.width, Math.round(s.y) + 0.5, gp);
    };
    guides.forEach((g, i) => gd?.index !== i && line(g.axis, g.at));
    if (gd) {
      line(gd.axis, gd.at);
      const s = ed.worldToScreen({ x: gd.at, y: gd.at });
      const p = label(host, fmt(gd.at).toString(), '#ffffff', 10.5);
      const tw = Math.ceil(p.getMaxIntrinsicWidth()) + 10;
      const x = gd.axis === 'x' ? s.x + 6 : (it?.pointer.x ?? 0) + 12;
      const y = gd.axis === 'y' ? s.y + 6 : (it?.pointer.y ?? 0) + 12;
      canvas.drawRRect(ck.RRectXY(ck.LTRBRect(x, y, x + tw, y + 17), 3, 3), fill(GUIDE));
      canvas.drawParagraph(p, x + 5, y + 2);
    }
  }

  // pontos e alças do vetor em edição
  if (ed.vectorEdit && it) {
    const vt = it.vector;
    const node = vt.node();
    if (node) {
      const m = vt.matrix();
      const s = (p: Point) => ed.worldToScreen(apply(m, p));
      const subs = vt.subpaths();
      const b = new ck.PathBuilder();
      for (const sp of subs) {
        const pts = sp.points;
        if (!pts.length) continue;
        const a0 = s(pts[0]);
        b.moveTo(a0.x, a0.y);
        const seg = (a: (typeof pts)[number], c: (typeof pts)[number]) => {
          const o = s(a.out ?? a), i2 = s(c.in ?? c), e = s(c);
          b.cubicTo(o.x, o.y, i2.x, i2.y, e.x, e.y);
        };
        for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
        if (sp.closed && pts.length > 1) {
          seg(pts[pts.length - 1], pts[0]);
          b.close();
        }
      }
      const outline = b.detachAndDelete();
      canvas.drawPath(outline, stroke(SEL, 1.25));
      outline.delete();
      // segmento sob o cursor (clique adiciona um ponto)
      const hv = vt.hover;
      if (hv?.kind === 'segment') {
        const sp = subs[hv.sub];
        const a = sp?.points[hv.index], c = sp?.points[(hv.index + 1) % (sp?.points.length ?? 1)];
        if (a && c) {
          const hb = new ck.PathBuilder();
          const a1 = s(a), o = s(a.out ?? a), i2 = s(c.in ?? c), e = s(c);
          hb.moveTo(a1.x, a1.y).cubicTo(o.x, o.y, i2.x, i2.y, e.x, e.y);
          const hp = hb.detachAndDelete();
          canvas.drawPath(hp, stroke(SEL, 2.5));
          hp.delete();
        }
      }
      const hf = fill('#ffffff'), hs = stroke(SEL, 1), hl = stroke(SEL, 1, 0.7), on = fill(SEL);
      for (const ref of vt.handleOwners(subs)) {
        const p = subs[ref.sub]?.points[ref.index];
        if (!p) continue;
        const c = s(p);
        for (const h of [p.in, p.out]) if (h) {
          const hp = s(h);
          canvas.drawLine(c.x, c.y, hp.x, hp.y, hl);
          canvas.drawCircle(hp.x, hp.y, 3.5, hf);
          canvas.drawCircle(hp.x, hp.y, 3.5, hs);
        }
      }
      for (const [si, sp] of subs.entries()) for (const [i, p] of sp.points.entries()) {
        const c = s(p);
        const big = hv?.kind === 'anchor' && hv.sub === si && hv.index === i ? 4.5 : 3.5;
        const r = ck.LTRBRect(c.x - big, c.y - big, c.x + big, c.y + big);
        canvas.drawRect(r, vt.isSelected(si, i) ? on : hf);
        canvas.drawRect(r, hs);
      }
    }
  }

  // ligações do protótipo
  if (ed.rightTab === 'prototype') {
    const start = startScreen(ed.page);
    if (start) {
      const q = quadOf(start.id);
      if (q) {
        const p = label(host, '▶ Início', '#ffffff', 10.5, 600);
        const tw = Math.ceil(p.getMaxIntrinsicWidth()) + 10;
        const x = q[0].x, y = q[0].y - 40;
        canvas.drawRRect(ck.RRectXY(ck.LTRBRect(x, y, x + tw, y + 17), 3, 3), fill(SEL));
        canvas.drawParagraph(p, x + 5, y + 2);
      }
    }
    const ld = it?.linkDrag?.moved ? it.linkDrag : null;
    const drawCurve = (c: Omit<LinkCurve, 'from' | 'to' | 'interaction'>, active: boolean, overlay: boolean, endHandle: boolean) => {
      const pb = new ck.PathBuilder();
      pb.moveTo(c.a.x, c.a.y).cubicTo(c.c1.x, c.c1.y, c.c2.x, c.c2.y, c.e.x, c.e.y);
      const path = pb.detachAndDelete();
      const line = stroke(SEL, active ? 2 : 1.25, active ? 1 : 0.55);
      // sobreposições (modais) em tracejado
      const dash = overlay ? ck.PathEffect.MakeDash([6, 4], 0) : null;
      if (dash) line.setPathEffect(dash);
      canvas.drawPath(path, line);
      if (dash) {
        line.setPathEffect(null);
        dash.delete();
      }
      path.delete();
      canvas.drawCircle(c.a.x, c.a.y, 3.5, fill(SEL, active ? 1 : 0.6));
      const dir = c.forward ? -1 : 1;
      const e = c.e;
      poly([e, { x: e.x + dir * 8, y: e.y - 4.5 }, { x: e.x + dir * 8, y: e.y + 4.5 }], fill(SEL, active ? 1 : 0.6));
      // ponta que dá para arrastar para outra tela
      if (endHandle) {
        canvas.drawCircle(e.x, e.y, 4.5, fill('#ffffff'));
        canvas.drawCircle(e.x, e.y, 4.5, stroke(SEL, 1.5));
      }
    };
    for (const c of linkCurves(ed)) {
      if (ld && ld.existing && c.from === ld.from) continue; // a que está sendo puxada segue o cursor
      const active = ed.selection.includes(c.from) || ed.selection.includes(c.to) || it?.linkHover === c.from;
      drawCurve(c, active, c.interaction.action === 'overlay', ed.selection.includes(c.from));
    }
    // alça "+" da camada selecionada: puxar dela até uma tela cria a ligação
    if (!ld && ed.selection.length === 1 && !ed.isInner(ed.selection[0]) && !ed.vectorEdit) {
      const h = handlePoint(ed, ed.selection[0]);
      if (h) {
        canvas.drawCircle(h.x, h.y, 7, fill(SEL));
        canvas.drawCircle(h.x, h.y, 7, stroke('#ffffff', 1.5));
        const plus = stroke('#ffffff', 1.6);
        canvas.drawLine(h.x - 3.5, h.y, h.x + 3.5, h.y, plus);
        canvas.drawLine(h.x, h.y - 3.5, h.x, h.y + 3.5, plus);
      }
    }
    // arrastando: a linha segue o cursor e a tela de destino acende
    if (ld) {
      const fromB = screenRect(ed, ld.from);
      const toB = ld.target ? screenRect(ed, ld.target) : null;
      if (toB) {
        canvas.drawRect(ck.LTRBRect(toB.x, toB.y, toB.x + toB.width, toB.y + toB.height), fill(SEL, 0.08));
        canvas.drawRect(ck.LTRBRect(toB.x, toB.y, toB.x + toB.width, toB.y + toB.height), stroke(SEL, 2));
      }
      if (fromB) drawCurve(curve(fromB, toB ?? ld.at), true, ld.existing?.action === 'overlay', false);
    }
  }

  // réguas
  if (ed.settings.rulers) drawRulers(host, canvas, ck, fill, stroke);

  for (const p of paints) p.delete();
}


type PaintFn = (color: string, alpha?: number) => SkPaint;

/** Réguas em cima e à esquerda, com a faixa da seleção destacada. */
function drawRulers(host: CanvasHost, canvas: Canvas, ck: CanvasKit, fill: PaintFn, stroke: (color: string, width?: number, alpha?: number) => SkPaint) {
  const ed = host.editor;
  const { width, height } = host.size();
  const dark = ed.theme === 'dark';
  const bg = dark ? '#1a1917' : '#f4f1eb';
  const ink = dark ? '#75705f' : '#958d7f';
  const line = dark ? '#2b2925' : '#ddd6c9';
  const z = ed.viewport.zoom;
  // passo entre números: pelo menos ~60 px na tela
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  const step = steps.find((s) => s * z >= 60) ?? 10000;
  const minor = step / (step % 5 === 0 ? 5 : step % 2 === 0 ? 2 : 1);
  canvas.drawRect(ck.LTRBRect(0, 0, width, RULER), fill(bg));
  canvas.drawRect(ck.LTRBRect(0, 0, RULER, height), fill(bg));
  // faixa da seleção
  const sb = ed.selectionBounds();
  if (sb) {
    const a = ed.worldToScreen({ x: sb.x, y: sb.y });
    canvas.drawRect(ck.LTRBRect(Math.max(RULER, a.x), 0, a.x + sb.width * z, RULER), fill(SEL, 0.18));
    canvas.drawRect(ck.LTRBRect(0, Math.max(RULER, a.y), RULER, a.y + sb.height * z), fill(SEL, 0.18));
  }
  const tick = stroke(ink, 1, 0.8);
  const x0 = ed.screenToWorld({ x: RULER, y: 0 }).x, x1 = ed.screenToWorld({ x: width, y: 0 }).x;
  for (let v = Math.floor(x0 / minor) * minor; v <= x1; v += minor) {
    const sx = Math.round(ed.worldToScreen({ x: v, y: 0 }).x) + 0.5;
    if (sx < RULER) continue;
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    canvas.drawLine(sx, major ? 0 : RULER - 5, sx, RULER, tick);
    if (major) canvas.drawParagraph(label(host, fmt(v).toString(), ink, 9.5, 400), sx + 3, 2);
  }
  const y0 = ed.screenToWorld({ x: 0, y: RULER }).y, y1 = ed.screenToWorld({ x: 0, y: height }).y;
  for (let v = Math.floor(y0 / minor) * minor; v <= y1; v += minor) {
    const sy = Math.round(ed.worldToScreen({ x: 0, y: v }).y) + 0.5;
    if (sy < RULER) continue;
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    canvas.drawLine(major ? 0 : RULER - 5, sy, RULER, sy, tick);
    if (major) {
      canvas.save();
      canvas.translate(2, sy - 3);
      canvas.rotate(-90, 0, 0);
      canvas.drawParagraph(label(host, fmt(v).toString(), ink, 9.5, 400), 0, 0);
      canvas.restore();
    }
  }
  // marcas das guias nas réguas
  for (const g of ed.page.guides ?? []) {
    const s = ed.worldToScreen({ x: g.at, y: g.at });
    if (g.axis === 'x' && s.x > RULER) canvas.drawRect(ck.LTRBRect(s.x - 1, RULER - 6, s.x + 2, RULER), fill(GUIDE));
    if (g.axis === 'y' && s.y > RULER) canvas.drawRect(ck.LTRBRect(RULER - 6, s.y - 1, RULER, s.y + 2), fill(GUIDE));
  }
  const border = stroke(line, 1);
  canvas.drawLine(RULER, RULER - 0.5, width, RULER - 0.5, border);
  canvas.drawLine(RULER - 0.5, RULER, RULER - 0.5, height, border);
  canvas.drawRect(ck.LTRBRect(0, 0, RULER, RULER), fill(bg));
}

function fmt(v: number) {
  return Math.round(v * 100) / 100;
}
