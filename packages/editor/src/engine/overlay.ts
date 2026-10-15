// Camada por cima do desenho: seleção, alças, guias, nomes dos frames, medidas e caneta.
import type { Canvas, CanvasKit, Paragraph } from 'canvaskit-wasm';
import { apply, parseHex, rectCorners, type Point, type SceneNode } from '@zaliel/core';
import type { CanvasHost } from './host';

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
  const colorFor = (n: SceneNode | undefined) => (n && (n.type === 'component' || n.type === 'instance') ? COMPONENT : SEL);

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

  // nomes dos frames do topo
  for (const n of ed.page.children) {
    if (n.visible === false || !('children' in n) || n.type === 'group') continue;
    const q = quadOf(n.id);
    if (!q) continue;
    const selected = ed.selection.includes(n.id);
    const color = n.type === 'component' ? COMPONENT : selected ? SEL : darkBg ? '#a8a399' : '#7a746a';
    const name = n.type === 'component' ? `◇ ${n.name}` : n.name;
    const p = label(host, name, color, 11, selected ? 600 : 500);
    const maxW = Math.max(20, Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y));
    if (maxW < 30) continue;
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
  if (sel.length && it && !ed.editingText && ed.tool === 'move') {
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

  for (const p of paints) p.delete();
}

function fmt(v: number) {
  return Math.round(v * 100) / 100;
}
