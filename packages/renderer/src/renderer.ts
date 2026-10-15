// Desenho da cena com CanvasKit (Skia). Usado pelo canvas do editor e pela exportação PNG.
import type { CanvasKit, Canvas, Paint as SkPaint, Path as SkPath, Image as SkImage, Paragraph, Surface, Shader, BlendMode as SkBlend, EmbindEnumEntity } from 'canvaskit-wasm';
import {
  type BlendMode,
  type Paint,
  type SceneNode,
  type Stroke,
  type TextNode,
  type ZalDocument,
  type Page,
  type Mat,
  nodeMatrix,
  parseHex,
  polygonPath,
  radii,
  resolvePaint,
} from '@zaliel/core';
import type { FontRegistry } from './fonts';

export interface Viewport {
  zoom: number;
  x: number; // deslocamento em px de tela
  y: number;
}

export interface FrameOptions {
  doc: ZalDocument;
  page: Page;
  viewport: Viewport;
  dpr: number;
  /** Troca instâncias pelo conteúdo resolvido. */
  resolve: (n: SceneNode) => SceneNode;
  /** Nós que não devem aparecer (ex.: texto em edição). */
  hidden?: Set<string>;
  /** Desenho por cima, em coordenadas de tela (seleção, guias…). */
  overlay?: (canvas: Canvas, ck: CanvasKit) => void;
  /** Cor de fundo da área fora da página (usa a da página por padrão). */
  background?: string;
}

const BLEND: Record<BlendMode, keyof CanvasKit['BlendMode']> = {
  normal: 'SrcOver',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'ColorDodge',
  'color-burn': 'ColorBurn',
  'hard-light': 'HardLight',
  'soft-light': 'SoftLight',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

export function toSkMatrix(m: Mat): number[] {
  return [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1];
}

/** Desenhar texto: a mesma função mede (para o layout) e pinta. */
export class TextEngine {
  private cache = new Map<string, Paragraph>();
  constructor(private ck: CanvasKit, private fonts: FontRegistry) {}

  private weightEnum(w: number): EmbindEnumEntity {
    const W = this.ck.FontWeight;
    const table: [number, EmbindEnumEntity][] = [
      [100, W.Thin], [200, W.ExtraLight], [300, W.Light], [400, W.Normal], [500, W.Medium],
      [600, W.SemiBold], [700, W.Bold], [800, W.ExtraBold], [900, W.Black],
    ];
    return table.reduce((best, cur) => (Math.abs(cur[0] - w) < Math.abs(best[0] - w) ? cur : best))[1];
  }

  private transformCase(t: string, c?: string): string {
    if (c === 'upper') return t.toUpperCase();
    if (c === 'lower') return t.toLowerCase();
    if (c === 'title') return t.replace(/\b\p{L}/gu, (m) => m.toUpperCase());
    return t;
  }

  /** Parágrafo pronto para uma largura (Infinity = sem quebra). Fica em cache. */
  paragraph(n: TextNode, width: number, paint?: SkPaint): Paragraph {
    const ck = this.ck;
    const st = n.style;
    const family = this.fonts.has(st.family) ? st.family : 'Inter';
    this.fonts.ensure(family, st.weight, !!st.italic);
    const ready = this.fonts.isReady(family, st.weight, !!st.italic);
    const key = JSON.stringify([n.text, st, width, ready, paint ? [n.fills, n.width, n.height] : null]);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const lh = typeof st.lineHeight === 'number' ? st.lineHeight : undefined;
    const decoration = st.decoration === 'underline' ? ck.UnderlineDecoration : st.decoration === 'strikethrough' ? ck.LineThroughDecoration : ck.NoDecoration;
    const textStyle = {
      color: ck.BLACK,
      fontFamilies: [family, 'Inter'],
      fontSize: st.size,
      fontStyle: { weight: this.weightEnum(st.weight), slant: st.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright },
      letterSpacing: st.letterSpacing ?? 0,
      decoration,
      ...(lh ? { heightMultiplier: lh / st.size, halfLeading: true } : {}),
    };
    const align = { left: ck.TextAlign.Left, center: ck.TextAlign.Center, right: ck.TextAlign.Right, justify: ck.TextAlign.Justify }[st.align ?? 'left'];
    const pStyle = new ck.ParagraphStyle({ textStyle, textAlign: align });
    const builder = ck.ParagraphBuilder.MakeFromFontProvider(pStyle, this.fonts.provider);
    if (paint) {
      const bg = new ck.Paint();
      bg.setColor(ck.TRANSPARENT);
      builder.pushPaintStyle(new ck.TextStyle(textStyle), paint, bg);
      bg.delete();
    }
    builder.addText(this.transformCase(n.text || ' ', st.case));
    const p = builder.build();
    builder.delete();
    p.layout(width === Infinity ? 1e6 : Math.max(1, width));
    if (width === Infinity) p.layout(Math.ceil(p.getMaxIntrinsicWidth()) + 1);
    this.cache.set(key, p);
    if (this.cache.size > 800) {
      const [oldKey, old] = this.cache.entries().next().value as [string, Paragraph];
      this.cache.delete(oldKey);
      old.delete();
    }
    return p;
  }

  measure = (n: TextNode, maxWidth: number): { width: number; height: number } => {
    const p = this.paragraph(n, maxWidth);
    const width = maxWidth === Infinity ? Math.ceil(p.getMaxIntrinsicWidth()) : maxWidth;
    return { width: Math.max(1, width), height: Math.max(1, Math.ceil(p.getHeight())) };
  };

  clear(): void {
    for (const p of this.cache.values()) p.delete();
    this.cache.clear();
  }
}

export class Renderer {
  surface: Surface | null = null;
  text: TextEngine;
  private images = new Map<string, SkImage | null>();
  private trash: { delete(): void }[] = [];
  private doc!: ZalDocument;
  private resolve!: (n: SceneNode) => SceneNode;
  private hidden?: Set<string>;
  /** Modo escolhido por coleção de variáveis (ex.: claro/escuro). */
  modes: Record<string, string> = {};

  constructor(public ck: CanvasKit, public fonts: FontRegistry) {
    this.text = new TextEngine(ck, fonts);
  }

  attach(canvas: HTMLCanvasElement): boolean {
    this.surface?.delete();
    this.surface = this.ck.MakeWebGLCanvasSurface(canvas) ?? this.ck.MakeSWCanvasSurface(canvas);
    return !!this.surface;
  }

  private t<T extends { delete(): void }>(o: T): T {
    this.trash.push(o);
    return o;
  }

  private flushTrash() {
    for (const o of this.trash) o.delete();
    this.trash = [];
  }

  color(hex: string, opacity = 1): Float32Array {
    const c = parseHex(hex);
    return this.ck.Color(c.r, c.g, c.b, c.a * opacity);
  }

  /** Esquece imagens decodificadas (ao trocar de documento). */
  resetImages(): void {
    for (const i of this.images.values()) i?.delete();
    this.images.clear();
  }

  image(key: string): SkImage | null {
    if (this.images.has(key)) return this.images.get(key)!;
    const asset = this.doc.assets[key] ?? this.doc.libraries.map((l) => l.assets?.[key]).find(Boolean);
    let img: SkImage | null = null;
    if (asset) {
      const bin = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0));
      img = this.ck.MakeImageFromEncoded(bin);
    }
    this.images.set(key, img);
    return img;
  }

  /** Desenha um quadro completo no canvas da tela. */
  frame(o: FrameOptions): void {
    const surface = this.surface;
    if (!surface) return;
    const canvas = surface.getCanvas();
    this.doc = o.doc;
    this.resolve = o.resolve;
    this.hidden = o.hidden;
    this.modes = o.doc.settings?.modes ?? {};
    canvas.clear(this.color(o.background ?? o.page.background));
    canvas.save();
    canvas.scale(o.dpr, o.dpr);
    canvas.translate(o.viewport.x, o.viewport.y);
    canvas.scale(o.viewport.zoom, o.viewport.zoom);
    for (const n of o.page.children) this.drawNode(canvas, n);
    canvas.restore();
    if (o.overlay) {
      canvas.save();
      canvas.scale(o.dpr, o.dpr);
      o.overlay(canvas, this.ck);
      canvas.restore();
    }
    surface.flush();
    this.flushTrash();
  }

  /** Exporta um nó como PNG/JPG/WebP numa escala. */
  exportImage(doc: ZalDocument, node: SceneNode, resolve: (n: SceneNode) => SceneNode, scale = 1, format: 'png' | 'jpg' | 'webp' = 'png', background?: string): Uint8Array | null {
    const w = Math.max(1, Math.ceil(node.width * scale));
    const h = Math.max(1, Math.ceil(node.height * scale));
    const surface = this.ck.MakeSurface(w, h);
    if (!surface) return null;
    this.doc = doc;
    this.resolve = resolve;
    this.hidden = undefined;
    this.modes = doc.settings?.modes ?? {};
    const canvas = surface.getCanvas();
    canvas.clear(background ? this.color(background) : format === 'jpg' ? this.ck.WHITE : this.ck.TRANSPARENT);
    canvas.scale(scale, scale);
    this.drawNode(canvas, { ...node, x: 0, y: 0, rotation: 0 } as SceneNode);
    const img = surface.makeImageSnapshot();
    const fmt = format === 'jpg' ? this.ck.ImageFormat.JPEG : format === 'webp' ? this.ck.ImageFormat.WEBP : this.ck.ImageFormat.PNG;
    const bytes = img.encodeToBytes(fmt, 92);
    img.delete();
    surface.delete();
    this.flushTrash();
    return bytes;
  }

  // ── Geometria ──────────────────────────────────────────────────────────────

  shapePath(n: SceneNode): SkPath | null {
    const ck = this.ck;
    const w = n.width, h = n.height;
    switch (n.type) {
      case 'ellipse': {
        const b = new ck.PathBuilder();
        b.addOval(ck.LTRBRect(0, 0, w, h));
        return this.t(b.detachAndDelete());
      }
      case 'line': {
        const b = new ck.PathBuilder();
        b.moveTo(0, 0).lineTo(w, h);
        return this.t(b.detachAndDelete());
      }
      case 'polygon':
      case 'star':
        return this.t(ck.Path.MakeFromSVGString(polygonPath(n, w, h))!);
      case 'path': {
        const p = n.d ? ck.Path.MakeFromSVGString(n.d) : null;
        if (!p) return null;
        if (n.fillRule === 'evenodd') p.setFillType(ck.FillType.EvenOdd);
        return this.t(p);
      }
      case 'text':
        return null;
      default: {
        const [tl, tr, br, bl] = radii(n);
        const b = new ck.PathBuilder();
        if (tl || tr || br || bl) b.addRRect(Float32Array.of(0, 0, w, h, tl, tl, tr, tr, br, br, bl, bl));
        else b.addRect(ck.LTRBRect(0, 0, w, h));
        return this.t(b.detachAndDelete());
      }
    }
  }

  private shader(p: Paint, w: number, h: number): Shader | null {
    const ck = this.ck;
    if (p.type === 'linear' || p.type === 'radial' || p.type === 'angular') {
      const stops = [...p.stops].sort((a, b) => a.offset - b.offset);
      if (!stops.length) return null;
      const colors = stops.map((s) => this.color(s.color));
      const pos = stops.map((s) => s.offset);
      const hd = p.handles ?? (p.type === 'linear' ? { from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 } } : { from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 0.5 } });
      const from = [hd.from.x * w, hd.from.y * h];
      const to = [hd.to.x * w, hd.to.y * h];
      if (p.type === 'linear') return this.t(ck.Shader.MakeLinearGradient(from, to, colors, pos, ck.TileMode.Clamp));
      if (p.type === 'radial') {
        const r = Math.max(0.5, Math.hypot(to[0] - from[0], to[1] - from[1]));
        return this.t(ck.Shader.MakeRadialGradient(from, r, colors, pos, ck.TileMode.Clamp));
      }
      const angle = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
      const m = ck.Matrix.rotated((angle * Math.PI) / 180, from[0], from[1]);
      return this.t(ck.Shader.MakeSweepGradient(from[0], from[1], colors, pos, ck.TileMode.Clamp, m));
    }
    if (p.type === 'image') {
      const img = this.image(p.asset);
      if (!img) return null;
      const iw = img.width(), ih = img.height();
      let sx = w / iw, sy = h / ih, tx = 0, ty = 0;
      let tile = ck.TileMode.Decal;
      if (p.scaleMode === 'fill' || p.scaleMode === 'fit') {
        const s = p.scaleMode === 'fill' ? Math.max(sx, sy) : Math.min(sx, sy);
        sx = sy = s;
        tx = (w - iw * s) / 2;
        ty = (h - ih * s) / 2;
      } else if (p.scaleMode === 'tile') {
        sx = sy = 1;
        tile = ck.TileMode.Repeat;
      }
      return this.t(img.makeShaderOptions(tile, tile, ck.FilterMode.Linear, ck.MipmapMode.Linear, [sx, 0, tx, 0, sy, ty, 0, 0, 1]));
    }
    return null;
  }

  /** Paint do Skia para uma pintura do documento (null = invisível). */
  skPaint(p: Paint, w: number, h: number, style: 'fill' | 'stroke' = 'fill'): SkPaint | null {
    if (p.visible === false) return null;
    p = resolvePaint(this.doc, p, this.modes);
    const ck = this.ck;
    const paint = this.t(new ck.Paint());
    paint.setAntiAlias(true);
    paint.setStyle(style === 'fill' ? ck.PaintStyle.Fill : ck.PaintStyle.Stroke);
    if (p.type === 'solid') paint.setColor(this.color(p.color, p.opacity ?? 1));
    else {
      const sh = this.shader(p, w, h);
      if (!sh) return null;
      paint.setShader(sh);
      paint.setAlphaf(p.opacity ?? 1);
    }
    if (p.blendMode && p.blendMode !== 'normal') paint.setBlendMode(ck.BlendMode[BLEND[p.blendMode]] as SkBlend);
    return paint;
  }

  // ── Desenho ────────────────────────────────────────────────────────────────

  drawNode(canvas: Canvas, raw: SceneNode): void {
    if (raw.visible === false || this.hidden?.has(raw.id)) return;
    const n = this.resolve(raw);
    const ck = this.ck;
    canvas.save();
    canvas.concat(toSkMatrix(nodeMatrix(n)));

    const effects = (n.effects ?? []).filter((e) => e.visible !== false);
    const path = this.shapePath(n);

    // Desfoque do fundo: borra o que já foi desenhado atrás, recortado pela forma
    for (const e of effects) if (e.type === 'background-blur' && path) {
      canvas.save();
      canvas.clipPath(path, ck.ClipOp.Intersect, true);
      const blur = this.t(ck.ImageFilter.MakeBlur(e.radius / 2, e.radius / 2, ck.TileMode.Clamp, null));
      canvas.saveLayer(undefined, null, blur);
      canvas.restore();
      canvas.restore();
    }

    // Sombras externas: uma camada "só sombra" por efeito, depois o conteúdo
    for (const e of effects) if (e.type === 'drop-shadow') {
      const sigma = e.blur / 2;
      const filter = this.t(ck.ImageFilter.MakeDropShadowOnly(e.x, e.y, sigma, sigma, this.color(e.color), null));
      const lp = this.t(new ck.Paint());
      lp.setImageFilter(filter);
      canvas.saveLayer(lp);
      if (e.spread && path) {
        // espalhamento: desenha a forma engordada como silhueta
        const p = this.t(new ck.Paint());
        p.setColor(ck.BLACK);
        p.setAntiAlias(true);
        canvas.drawPath(path, p);
        if (e.spread > 0) {
          p.setStyle(ck.PaintStyle.Stroke);
          p.setStrokeWidth(e.spread * 2);
          canvas.drawPath(path, p);
        }
      } else this.drawContent(canvas, n, path, false);
      canvas.restore();
    }

    const needsLayer = (n.opacity !== undefined && n.opacity < 1) || (n.blendMode && n.blendMode !== 'normal') || effects.some((e) => e.type === 'layer-blur');
    if (needsLayer) {
      const lp = this.t(new ck.Paint());
      if (n.opacity !== undefined && n.opacity < 1) lp.setAlphaf(Math.max(0, n.opacity));
      if (n.blendMode && n.blendMode !== 'normal') lp.setBlendMode(ck.BlendMode[BLEND[n.blendMode]] as SkBlend);
      const lb = effects.find((e) => e.type === 'layer-blur') as { radius: number } | undefined;
      if (lb) lp.setImageFilter(this.t(ck.ImageFilter.MakeBlur(lb.radius / 2, lb.radius / 2, ck.TileMode.Decal, null)));
      canvas.saveLayer(lp);
    }
    this.drawContent(canvas, n, path, true);
    if (needsLayer) canvas.restore();
    canvas.restore();
  }

  /** Preenchimentos, filhos, sombra interna e contornos. */
  private drawContent(canvas: Canvas, n: SceneNode, path: SkPath | null, withInner: boolean): void {
    const ck = this.ck;
    const fills = n.fills ?? [];
    if (n.type === 'text') {
      this.drawText(canvas, n);
    } else if (path) {
      for (const f of fills) {
        const p = this.skPaint(f, n.width, n.height);
        if (p && n.type !== 'line') canvas.drawPath(path, p);
      }
    }

    if (withInner) for (const e of n.effects ?? []) if (e.type === 'inner-shadow' && e.visible !== false && path) {
      canvas.save();
      canvas.clipPath(path, ck.ClipOp.Intersect, true);
      const pb = new ck.PathBuilder();
      const pad = e.blur * 2 + Math.abs(e.x) + Math.abs(e.y) + 10;
      pb.addRect(ck.LTRBRect(-pad, -pad, n.width + pad, n.height + pad));
      pb.addPath(path, 1, 0, e.x, 0, 1, e.y, 0, 0, 1);
      const ring = this.t(pb.detachAndDelete());
      ring.setFillType(ck.FillType.EvenOdd);
      const p = this.t(new ck.Paint());
      p.setColor(this.color(e.color));
      p.setAntiAlias(true);
      if (e.blur > 0) p.setMaskFilter(this.t(ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, e.blur / 2, true)));
      canvas.drawPath(ring, p);
      canvas.restore();
    }

    if ('children' in n && n.children.length) {
      const clip = n.type !== 'group' && n.clip && path;
      if (clip) {
        canvas.save();
        canvas.clipPath(path!, ck.ClipOp.Intersect, true);
      }
      for (const c of n.children) this.drawNode(canvas, c);
      if (clip) canvas.restore();
    }

    for (const s of n.strokes ?? []) this.drawStroke(canvas, n, path, s);
  }

  private drawStroke(canvas: Canvas, n: SceneNode, path: SkPath | null, s: Stroke): void {
    if (s.visible === false || s.width <= 0) return;
    const ck = this.ck;
    if (n.type === 'text') return; // contorno de texto fica para depois
    if (!path) return;
    const p = this.skPaint(s.paint, n.width, n.height, 'stroke');
    if (!p) return;
    const open = n.type === 'line' || (n.type === 'path' && !/z\s*$/i.test(n.d.trim()));
    const align = open ? 'center' : s.align;
    p.setStrokeWidth(align === 'center' ? s.width : s.width * 2);
    p.setStrokeCap(s.cap === 'round' ? ck.StrokeCap.Round : s.cap === 'square' ? ck.StrokeCap.Square : ck.StrokeCap.Butt);
    p.setStrokeJoin(s.join === 'round' ? ck.StrokeJoin.Round : s.join === 'bevel' ? ck.StrokeJoin.Bevel : ck.StrokeJoin.Miter);
    if (s.dash?.length) {
      const fx = ck.PathEffect.MakeDash(s.dash.length % 2 ? [...s.dash, ...s.dash] : s.dash, 0);
      if (fx) p.setPathEffect(this.t(fx));
    }
    canvas.save();
    if (align === 'inside') canvas.clipPath(path, ck.ClipOp.Intersect, true);
    else if (align === 'outside') canvas.clipPath(path, ck.ClipOp.Difference, true);
    canvas.drawPath(path, p);
    canvas.restore();
  }

  private drawText(canvas: Canvas, n: TextNode): void {
    const fill = (n.fills ?? []).find((f) => f.visible !== false);
    if (!fill) return;
    const paint = this.skPaint(fill, n.width, n.height);
    if (!paint) return;
    const width = n.autoResize === 'width' ? Infinity : n.width;
    const p = this.text.paragraph(n, width, paint);
    let y = 0;
    const h = p.getHeight();
    if (n.autoResize === 'none') {
      if (n.style.verticalAlign === 'middle') y = (n.height - h) / 2;
      else if (n.style.verticalAlign === 'bottom') y = n.height - h;
    }
    canvas.drawParagraph(p, 0, y);
  }
}
