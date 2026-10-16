// Desenho da cena com CanvasKit (Skia). Usado pelo canvas do editor e pela exportação PNG.
import type { CanvasKit, Canvas, Paint as SkPaint, Path as SkPath, Image as SkImage, Paragraph, Surface, Shader, BlendMode as SkBlend, EmbindEnumEntity, Typeface } from 'canvaskit-wasm';
import {
  type BlendMode,
  type Paint,
  type SceneNode,
  type Stroke,
  type TextNode,
  type TextStyle,
  type ZalDocument,
  textSegments,
  type Page,
  type Mat,
  nodeMatrix,
  multiply,
  transformRect,
  IDENTITY,
  parseHex,
  resolvePaint,
  radii,
  acceptsStrokeSides,
  strokeSides,
  strokeWeight,
  sideStrokeGeometry,
  type StrokeSides,
} from '@zaliel/core';
import type { FontRegistry } from './fonts';
import { booleanPath, localShapePath, toSkMatrix } from './geometry';

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

/** Desenhar texto: a mesma função mede (para o layout) e pinta. */
export class TextEngine {
  private cache = new Map<string, Paragraph>();
  constructor(private ck: CanvasKit, readonly fonts: FontRegistry) {}

  private weightEnum(w: number): EmbindEnumEntity {
    const W = this.ck.FontWeight;
    const table: [number, EmbindEnumEntity][] = [
      [100, W.Thin], [200, W.ExtraLight], [300, W.Light], [400, W.Normal], [500, W.Medium],
      [600, W.SemiBold], [700, W.Bold], [800, W.ExtraBold], [900, W.Black],
    ];
    return table.reduce((best, cur) => (Math.abs(cur[0] - w) < Math.abs(best[0] - w) ? cur : best))[1];
  }

  transformCase(t: string, c?: string): string {
    if (c === 'upper') return t.toUpperCase();
    if (c === 'lower') return t.toLowerCase();
    if (c === 'title') return t.replace(/\b\p{L}/gu, (m) => m.toUpperCase());
    return t;
  }

  /** Família que existe (as desconhecidas caem na Inter). */
  family(f: string): string {
    return this.fonts.has(f) ? f : 'Inter';
  }

  /** Estilo do CanvasKit para um estilo de texto. A altura de linha é sempre a do texto inteiro. */
  private skTextStyle(s: TextStyle, lineHeight: number | undefined) {
    const ck = this.ck;
    const decoration = s.decoration === 'underline' ? ck.UnderlineDecoration : s.decoration === 'strikethrough' ? ck.LineThroughDecoration : ck.NoDecoration;
    return {
      color: ck.BLACK,
      fontFamilies: [this.family(s.family), 'Inter'],
      fontSize: s.size,
      fontStyle: { weight: this.weightEnum(s.weight), slant: s.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright },
      letterSpacing: s.letterSpacing ?? 0,
      decoration,
      ...(lineHeight ? { heightMultiplier: lineHeight / s.size, halfLeading: true } : {}),
    };
  }

  /** Parágrafo pronto para uma largura (Infinity = sem quebra). Fica em cache. */
  paragraph(n: TextNode, width: number, paint?: SkPaint, paintKey?: unknown): Paragraph {
    const ck = this.ck;
    const st = n.style;
    // trechos com estilo próprio (negrito, cor…): cada um entra com o seu estilo
    const segs = n.text && n.runs?.length ? textSegments(n.text, st, n.runs) : null;
    let ready = true;
    for (const s of segs ? segs.map((g) => g.style) : [st]) {
      const family = this.family(s.family);
      this.fonts.ensure(family, s.weight, !!s.italic);
      ready &&= this.fonts.isReady(family, s.weight, !!s.italic);
    }
    const key = JSON.stringify([n.text, st, segs ? n.runs : null, width, ready, paint ? [paintKey ?? n.fills, n.width, n.height] : null]);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const lh = typeof st.lineHeight === 'number' ? st.lineHeight : undefined;
    const textStyle = this.skTextStyle(st, lh);
    const align = { left: ck.TextAlign.Left, center: ck.TextAlign.Center, right: ck.TextAlign.Right, justify: ck.TextAlign.Justify }[st.align ?? 'left'];
    const pStyle = new ck.ParagraphStyle({ textStyle, textAlign: align });
    const builder = ck.ParagraphBuilder.MakeFromFontProvider(pStyle, this.fonts.provider);
    const bg = paint ? new ck.Paint() : null;
    bg?.setColor(ck.TRANSPARENT);
    const text = this.transformCase(n.text || ' ', st.case);
    if (!segs) {
      if (paint) builder.pushPaintStyle(new ck.TextStyle(textStyle), paint, bg!);
      builder.addText(text);
    } else {
      // maiúsculas que mudam o tamanho do texto (ß → SS) são convertidas pedaço a pedaço
      const sameLength = text.length === n.text.length;
      const own: SkPaint[] = [];
      for (const g of segs) {
        const ts = new ck.TextStyle(this.skTextStyle(g.style, lh));
        if (paint) {
          let fg = paint;
          if (g.color) {
            fg = new ck.Paint();
            fg.setAntiAlias(true);
            const c = parseHex(g.color);
            fg.setColor(ck.Color(c.r, c.g, c.b, c.a));
            own.push(fg);
          }
          builder.pushPaintStyle(ts, fg, bg!);
        } else builder.pushStyle(ts);
        builder.addText(sameLength ? text.slice(g.start, g.end) : this.transformCase(n.text.slice(g.start, g.end), st.case));
        builder.pop();
      }
      for (const p of own) p.delete();
    }
    bg?.delete();
    const p = builder.build();
    builder.delete();
    p.layout(width === Infinity ? 1e6 : Math.max(1, width));
    if (width === Infinity) p.layout(Math.ceil(p.getMaxIntrinsicWidth()) + 1);
    this.cache.set(key, p);
    if (this.cache.size > 3000) {
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

/** Posição UTF-16 de cada byte UTF-8 do texto (o CanvasKit conta as letras em UTF-8). */
function utf8ToUtf16(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.codePointAt(i)!;
    const bytes = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    for (let b = 0; b < bytes; b++) out.push(i);
    if (c > 0xffff) i++;
  }
  out.push(text.length);
  return out;
}

export class Renderer {
  surface: Surface | null = null;
  text: TextEngine;
  private images = new Map<string, SkImage | null>();
  private trash: { delete(): void }[] = [];
  private doc!: ZalDocument;
  private resolve!: (n: SceneNode) => SceneNode;
  private hidden?: Set<string>;
  /** Matriz do pai atual no espaço da página (para saber onde cada nó cai na tela). */
  private mat: Mat = IDENTITY;
  /** Área visível no espaço da página (null = desenha tudo, como nas exportações). */
  private cull: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Pixels de tela por unidade (Infinity nas exportações: sem simplificações). */
  private lod = Infinity;
  /** Modo escolhido por coleção de variáveis (ex.: claro/escuro). */
  modes: Record<string, string> = {};

  constructor(public ck: CanvasKit, public fonts: FontRegistry) {
    this.text = new TextEngine(ck, fonts);
  }

  attach(canvas: HTMLCanvasElement): boolean {
    // as imagens guardadas pertencem ao contexto antigo
    this.invalidate();
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
    // só o que cai na tela é desenhado (com folga para sombras e contornos)
    const z = o.viewport.zoom;
    const w = surface.width() / o.dpr, h = surface.height() / o.dpr;
    this.cull = { x0: -o.viewport.x / z, y0: -o.viewport.y / z, x1: (w - o.viewport.x) / z, y1: (h - o.viewport.y) / z };
    this.lod = z;
    this.mat = IDENTITY;
    this.dpr = o.dpr;
    for (const n of o.page.children) {
      if (!this.drawCached(canvas, n)) this.drawNode(canvas, n);
    }
    this.cull = null;
    this.lod = Infinity;
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

  // ── Cache de telas pequenas ────────────────────────────────────────────────
  // Com pouco zoom, cada camada do topo vira uma imagem guardada e reaproveitada
  // até algo dentro dela mudar (veja `invalidate`).

  private dpr = 1;
  private shots = new Map<string, { image: SkImage; scale: number; w: number; h: number }>();

  /** Algo mudou dentro destas camadas do topo (ou em todas, sem ids). */
  invalidate(ids?: Iterable<string>): void {
    if (!ids) {
      for (const s of this.shots.values()) s.image.delete();
      this.shots.clear();
      return;
    }
    for (const id of ids) {
      const s = this.shots.get(id);
      if (s) {
        s.image.delete();
        this.shots.delete(id);
      }
    }
  }

  /**
   * Superfície fora da tela: na GPU (mesmo contexto do canvas) quando der, que é muitas vezes
   * mais rápida para sombras e desfoques; senão, na CPU. `release` libera tudo (na CPU,
   * dispose também solta os pixels — só delete deixaria a memória presa).
   */
  private offscreen(w: number, h: number): { surface: Surface; release: () => void } | null {
    const ck = this.ck;
    if (this.surface && w <= 8192 && h <= 8192) {
      try {
        const gpu = this.surface.makeSurface({ width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Premul, colorSpace: ck.ColorSpace.SRGB });
        if (gpu) return { surface: gpu, release: () => gpu.delete() };
      } catch {
        /* sem GPU: usa a CPU */
      }
    }
    const cpu = ck.MakeSurface(w, h);
    return cpu ? { surface: cpu, release: () => cpu.dispose() } : null;
  }

  /** Desenha uma camada do topo pela imagem guardada, quando ela aparece pequena. Devolve false para o desenho normal. */
  private drawCached(canvas: Canvas, raw: SceneNode): boolean {
    const px = Math.max(raw.width, raw.height) * this.lod;
    if (this.lod >= 0.5 || px > 420 || px < 2 || raw.rotation || raw.visible === false || raw.effects?.length || this.hidden?.size) return false;
    if (!('children' in raw) || raw.type === 'group') return false;
    if (this.invisible(raw, nodeMatrix(raw))) return true;
    // escala em degraus (potências de 2) para reaproveitar a mesma imagem em vários zooms
    const scale = Math.pow(2, Math.ceil(Math.log2(this.lod * this.dpr)));
    let shot = this.shots.get(raw.id);
    if (shot && (shot.scale !== scale || shot.w !== raw.width || shot.h !== raw.height)) {
      shot.image.delete();
      this.shots.delete(raw.id);
      shot = undefined;
    }
    if (!shot) {
      const w = Math.max(1, Math.ceil(raw.width * scale)), h = Math.max(1, Math.ceil(raw.height * scale));
      const off = this.offscreen(w, h);
      if (!off) return false;
      const surface = off.surface;
      const c = surface.getCanvas();
      c.save();
      c.clear(this.ck.TRANSPARENT);
      const saved = { cull: this.cull, lod: this.lod, mat: this.mat };
      this.cull = null;
      this.lod = scale / this.dpr;
      this.mat = IDENTITY;
      c.scale(scale, scale);
      this.drawNode(c, { ...raw, x: 0, y: 0 } as SceneNode);
      Object.assign(this, saved);
      c.restore();
      const image = surface.makeImageSnapshot();
      off.release();
      shot = { image, scale, w: raw.width, h: raw.height };
      this.shots.set(raw.id, shot);
    }
    const paint = this.t(new this.ck.Paint());
    canvas.drawImageRectOptions(shot.image, this.ck.XYWHRect(0, 0, shot.image.width(), shot.image.height()), this.ck.XYWHRect(raw.x, raw.y, shot.image.width() / scale, shot.image.height() / scale), this.ck.FilterMode.Linear, this.ck.MipmapMode.None, paint);
    return true;
  }

  /** Desenha um nó sozinho numa superfície fora da tela. */
  private snapshot<T>(doc: ZalDocument, node: SceneNode, resolve: (n: SceneNode) => SceneNode, scale: number, clear: Float32Array, read: (img: SkImage, w: number, h: number) => T): T | null {
    const w = Math.max(1, Math.ceil(node.width * scale));
    const h = Math.max(1, Math.ceil(node.height * scale));
    const off = this.offscreen(w, h);
    if (!off) return null;
    const surface = off.surface;
    this.doc = doc;
    this.resolve = resolve;
    this.hidden = undefined;
    this.modes = doc.settings?.modes ?? {};
    const canvas = surface.getCanvas();
    canvas.clear(clear);
    canvas.scale(scale, scale);
    this.drawNode(canvas, { ...node, x: 0, y: 0, rotation: 0 } as SceneNode);
    const img = surface.makeImageSnapshot();
    const out = read(img, w, h);
    img.delete();
    off.release();
    this.flushTrash();
    return out;
  }

  /** Exporta um nó como PNG/JPG/WebP numa escala. */
  exportImage(doc: ZalDocument, node: SceneNode, resolve: (n: SceneNode) => SceneNode, scale = 1, format: 'png' | 'jpg' | 'webp' = 'png', background?: string): Uint8Array | null {
    const clear = background ? this.color(background) : format === 'jpg' ? this.ck.WHITE : this.ck.TRANSPARENT;
    const fmt = format === 'jpg' ? this.ck.ImageFormat.JPEG : format === 'webp' ? this.ck.ImageFormat.WEBP : this.ck.ImageFormat.PNG;
    return this.snapshot(doc, node, resolve, scale, clear, (img) => img.encodeToBytes(fmt, 92));
  }

  /** Pixels RGBA (sem pré-multiplicar) de um nó — usados pela exportação em PDF. */
  exportPixels(doc: ZalDocument, node: SceneNode, resolve: (n: SceneNode) => SceneNode, scale = 1): { width: number; height: number; rgba: Uint8Array } | null {
    const ck = this.ck;
    return this.snapshot(doc, node, resolve, scale, ck.TRANSPARENT, (img, width, height) => {
      const px = img.readPixels(0, 0, { width, height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB });
      return px ? { width, height, rgba: new Uint8Array(px.buffer, px.byteOffset, px.byteLength) } : null;
    });
  }

  // ── Geometria ──────────────────────────────────────────────────────────────

  shapePath(n: SceneNode): SkPath | null {
    const p = n.type === 'boolean' ? booleanPath(this.ck, n, this.resolve) : localShapePath(this.ck, n);
    return p ? this.t(p) : null;
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

  /** O nó (e o que ele contém) pode ser pulado: fora da tela ou pequeno demais para enxergar. */
  private invisible(n: SceneNode, m: Mat): boolean {
    if (!this.cull) return false;
    const b = transformRect(m, { x: 0, y: 0, width: n.width, height: n.height });
    const tiny = b.width * this.lod < 0.5 && b.height * this.lod < 0.5;
    if (tiny && !(n.effects?.length || n.strokes?.length)) return true;
    // container sem recorte pode ter filhos fora da caixa: só some se for grupo (a caixa envolve os filhos)
    if ('children' in n && n.children.length && n.type !== 'group' && n.type !== 'boolean' && !n.clip) return false;
    let pad = 2 / this.lod;
    for (const s of n.strokes ?? []) pad = Math.max(pad, strokeWeight(s));
    for (const e of n.effects ?? []) pad = Math.max(pad, 'blur' in e ? e.blur * 1.5 + Math.abs(e.x) + Math.abs(e.y) + (e.spread ?? 0) : e.radius * 1.5);
    const c = this.cull;
    return b.x + b.width + pad < c.x0 || b.y + b.height + pad < c.y0 || b.x - pad > c.x1 || b.y - pad > c.y1;
  }

  drawNode(canvas: Canvas, raw: SceneNode): void {
    if (raw.visible === false || this.hidden?.has(raw.id)) return;
    const parentMat = this.mat;
    // a caixa é a mesma antes e depois de resolver: confere a visibilidade primeiro
    // (resolver instâncias e booleanas custa caro e é inútil fora da tela)
    const m = multiply(parentMat, nodeMatrix(raw));
    if (this.invisible(raw, m)) return;
    const n = this.resolve(raw);
    this.mat = m;
    try {
      this.drawNodeAt(canvas, n);
    } finally {
      this.mat = parentMat;
    }
  }

  private drawNodeAt(canvas: Canvas, n: SceneNode): void {
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

    if ('children' in n && n.children.length && n.type !== 'boolean') {
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
    if (s.visible === false || strokeWeight(s) <= 0) return;
    const ck = this.ck;
    if (n.type === 'text') return; // contorno de texto fica para depois
    if (!path) return;
    const sides = acceptsStrokeSides(n) ? strokeSides(s) : null;
    if (sides) return this.drawSideStroke(canvas, n, s, sides);
    if (s.width <= 0) return;
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

  /** Contorno com espessura por lado: faixa preenchida (liso) ou linha central recortada por lado (tracejado). */
  private drawSideStroke(canvas: Canvas, n: SceneNode, s: Stroke, sides: StrokeSides): void {
    const ck = this.ck;
    const g = sideStrokeGeometry(n.width, n.height, radii(n), sides, s.align);
    const svg = (d: string) => {
      const p = ck.Path.MakeFromSVGString(d);
      return p ? this.t(p) : null;
    };
    if (!s.dash?.length) {
      const ring = svg(g.ring);
      const p = this.skPaint(s.paint, n.width, n.height, 'fill');
      if (!ring || !p) return;
      ring.setFillType(ck.FillType.EvenOdd);
      canvas.drawPath(ring, p);
      return;
    }
    const center = svg(g.center);
    if (!center) return;
    for (const wd of g.wedges) {
      const clip = svg(wd.clip);
      const p = this.skPaint(s.paint, n.width, n.height, 'stroke');
      if (!clip || !p) continue;
      p.setStrokeWidth(wd.width);
      p.setStrokeCap(s.cap === 'round' ? ck.StrokeCap.Round : s.cap === 'square' ? ck.StrokeCap.Square : ck.StrokeCap.Butt);
      const fx = ck.PathEffect.MakeDash(s.dash.length % 2 ? [...s.dash, ...s.dash] : s.dash, 0);
      if (fx) p.setPathEffect(this.t(fx));
      canvas.save();
      canvas.clipPath(clip, ck.ClipOp.Intersect, true);
      canvas.drawPath(center, p);
      canvas.restore();
    }
  }

  /**
   * Onde vai cada letra de um texto em caminho: id do glifo e a transformação (RSXform:
   * cosseno, seno, x, y) de cada uma. Usado para desenhar e para converter em vetor.
   */
  private textPathLayout(n: TextNode): { tf: Typeface; size: number; ids: number[]; xf: number[] } | null {
    const ck = this.ck;
    const st = n.style;
    const family = this.text.fonts.has(st.family) ? st.family : 'Inter';
    this.text.fonts.ensure(family, st.weight, !!st.italic);
    const tf = this.text.fonts.typeface(family, st.weight, !!st.italic) ?? this.text.fonts.typeface('Inter', st.weight, !!st.italic);
    const path = n.textPath ? ck.Path.MakeFromSVGString(n.textPath.d) : null;
    if (!tf || !path) {
      path?.delete();
      return null;
    }
    const font = new ck.Font(tf, st.size);
    const iter = new ck.ContourMeasureIter(path, false, 1);
    const cm = iter.next();
    try {
      const xf: number[] = [];
      const ids: number[] = [];
      if (!cm) return { tf, size: st.size, ids, xf };
      const text = this.text.transformCase(n.text || '', st.case);
      const glyphs = font.getGlyphIDs(text);
      const widths = font.getGlyphWidths(glyphs);
      const ls = st.letterSpacing ?? 0;
      const total = widths.reduce((a, w) => a + w, 0) + ls * Math.max(0, glyphs.length - 1);
      const len = cm.length();
      const align = st.align ?? 'left';
      let dist = ((n.textPath!.start ?? 0) / 100) * len + (align === 'center' ? (len - total) / 2 : align === 'right' ? len - total : 0);
      // do outro lado: a letra fica embaixo da linha e o caminho é lido ao contrário
      const flip = !!n.textPath!.flip;
      const shift = flip ? -font.getMetrics().ascent * 0.8 : 0;
      for (let i = 0; i < glyphs.length; i++) {
        const w = widths[i];
        const mid = flip ? len - (dist + w / 2) : dist + w / 2;
        dist += w + ls;
        if (mid < 0 || mid > len) continue;
        const [px, py, tx0, ty0] = cm.getPosTan(mid);
        const tx = flip ? -tx0 : tx0, ty = flip ? -ty0 : ty0;
        // normal (para fora da curva) para deslocar a linha de base quando invertido
        const nx = -ty, ny = tx;
        xf.push(tx, ty, px - tx * (w / 2) - nx * shift, py - ty * (w / 2) - ny * shift);
        ids.push(glyphs[i]);
      }
      return { tf, size: st.size, ids, xf };
    } finally {
      cm?.delete();
      iter.delete();
      font.delete();
      path.delete();
    }
  }

  /** Texto que segue um caminho: cada letra é colocada e girada sobre a curva. */
  private drawTextOnPath(canvas: Canvas, n: TextNode, paint: SkPaint): boolean {
    const lay = this.textPathLayout(n);
    if (!lay) return false;
    if (!lay.ids.length) return true;
    const font = new this.ck.Font(lay.tf, lay.size);
    const blob = this.ck.TextBlob.MakeFromRSXformGlyphs(lay.ids, lay.xf, font);
    if (blob) {
      canvas.drawTextBlob(blob, 0, 0, paint);
      blob.delete();
    }
    font.delete();
    return true;
  }

  /**
   * Contorno das letras de um texto, como caminho SVG no espaço do próprio texto
   * (o mesmo lugar onde elas aparecem no canvas). null = a fonte ainda não carregou.
   */
  textOutline(n: TextNode): string | null {
    const st = n.style;
    const fontFor = (s: TextStyle) => this.text.fonts.outlineFont(this.text.family(s.family), s.weight, !!s.italic) ?? this.text.fonts.outlineFont('Inter', s.weight, !!s.italic);
    const baseFont = fontFor(st);
    if (!baseFont) return null;
    let font = baseFont;
    const parts: string[] = [];
    const r = (v: number) => Math.round(v * 100) / 100;
    // glifo na origem (linha de base em y = 0) levado pela matriz [a, b, c, d, e, f]
    const glyph = (id: number, size: number, m: number[]) => {
      if (id >= font.numGlyphs) return;
      const path = font.glyphs.get(id).getPath(0, 0, size);
      const pt = (x: number, y: number) => `${r(m[0] * x + m[2] * y + m[4])} ${r(m[1] * x + m[3] * y + m[5])}`;
      for (const c of path.commands) {
        if (c.type === 'M') parts.push(`M${pt(c.x, c.y)}`);
        else if (c.type === 'L') parts.push(`L${pt(c.x, c.y)}`);
        else if (c.type === 'Q') parts.push(`Q${pt(c.x1, c.y1)} ${pt(c.x, c.y)}`);
        else if (c.type === 'C') parts.push(`C${pt(c.x1, c.y1)} ${pt(c.x2, c.y2)} ${pt(c.x, c.y)}`);
        else if (c.type === 'Z') parts.push('Z');
      }
    };
    const rect = (x: number, y: number, w: number, h: number) => parts.push(`M${r(x)} ${r(y)}L${r(x + w)} ${r(y)}L${r(x + w)} ${r(y + h)}L${r(x)} ${r(y + h)}Z`);

    if (n.textPath) {
      const lay = this.textPathLayout(n);
      if (!lay) return null;
      for (let i = 0; i < lay.ids.length; i++) {
        const [cos, sin, x, y] = lay.xf.slice(i * 4, i * 4 + 4);
        glyph(lay.ids[i], lay.size, [cos, sin, -sin, cos, x, y]);
      }
      return parts.join('');
    }

    const width = n.autoResize === 'width' ? Infinity : n.width;
    const p = this.text.paragraph(n, width);
    let oy = 0;
    if (n.autoResize === 'none') {
      const h = p.getHeight();
      if (st.verticalAlign === 'middle') oy = (n.height - h) / 2;
      else if (st.verticalAlign === 'bottom') oy = n.height - h;
    }
    // trechos com estilo próprio: cada pedaço desenhado pelo CanvasKit usa a fonte do seu trecho
    const segs = n.text && n.runs?.length ? textSegments(n.text, st, n.runs) : null;
    const index = segs ? utf8ToUtf16(this.text.transformCase(n.text, st.case)) : null;
    const styleAt = (offset: number): TextStyle => {
      if (!segs || !index) return st;
      const at = index[Math.min(offset, index.length - 1)] ?? 0;
      return (segs.find((g) => g.start <= at && at < g.end) ?? segs[segs.length - 1]).style;
    };
    for (const line of p.getShapedLines()) {
      for (const run of line.runs) {
        if (!run.glyphs.length) continue;
        const rs = styleAt(run.offsets[0]);
        const f = rs === st ? baseFont : fontFor(rs);
        if (!f) return null; // a fonte do trecho ainda não carregou
        font = f;
        for (let i = 0; i < run.glyphs.length; i++) {
          const x = run.positions[i * 2], y = run.positions[i * 2 + 1] + oy;
          glyph(run.glyphs[i], run.size, [1, 0, 0, 1, x, y]);
        }
        // sublinhado e tachado também viram forma
        const x0 = run.positions[0], x1 = run.positions[run.glyphs.length * 2];
        const scale = run.size / font.unitsPerEm;
        const post = font.tables.post as { underlinePosition?: number; underlineThickness?: number } | undefined;
        const os2 = font.tables.os2 as { yStrikeoutPosition?: number; yStrikeoutSize?: number } | undefined;
        if (x1 > x0 && rs.decoration === 'underline') {
          const t = (post?.underlineThickness || font.unitsPerEm * 0.07) * scale;
          rect(x0, line.baseline + oy - (post?.underlinePosition ?? -font.unitsPerEm * 0.1) * scale - t / 2, x1 - x0, t);
        } else if (x1 > x0 && rs.decoration === 'strikethrough') {
          const t = (os2?.yStrikeoutSize || font.unitsPerEm * 0.06) * scale;
          rect(x0, line.baseline + oy - (os2?.yStrikeoutPosition ?? font.unitsPerEm * 0.3) * scale - t / 2, x1 - x0, t);
        }
      }
    }
    return parts.join('');
  }

  private drawText(canvas: Canvas, n: TextNode): void {
    const fill = (n.fills ?? []).find((f) => f.visible !== false);
    if (!fill) return;
    if (n.textPath) {
      const paint = this.skPaint(fill, n.width, n.height);
      if (paint && this.drawTextOnPath(canvas, n, paint)) return;
    }
    // letra pequena demais para ler no zoom atual: barras no lugar das linhas (bem mais rápido)
    if (n.style.size * this.lod < 3) {
      const c = fill.type === 'solid' ? resolvePaint(this.doc, fill, this.modes) : fill;
      const color = c.type === 'solid' ? c.color : '#888888';
      const p = this.t(new this.ck.Paint());
      p.setColor(this.color(color, 0.32 * (c.opacity ?? 1)));
      const lh = typeof n.style.lineHeight === 'number' ? n.style.lineHeight : n.style.size * 1.25;
      const lines = Math.max(1, Math.round(n.height / lh));
      const w = n.autoResize === 'width' ? n.width : n.width * 0.92;
      for (let i = 0; i < lines; i++) canvas.drawRect(this.ck.XYWHRect(0, i * lh + lh * 0.3, i === lines - 1 && lines > 1 ? w * 0.6 : w, lh * 0.45), p);
      return;
    }
    const paint = this.skPaint(fill, n.width, n.height);
    if (!paint) return;
    const width = n.autoResize === 'width' ? Infinity : n.width;
    // a chave leva a cor já resolvida: trocar de modo (claro/escuro) muda a cor sem mudar o nó
    const p = this.text.paragraph(n, width, paint, resolvePaint(this.doc, fill, this.modes));
    let y = 0;
    const h = p.getHeight();
    if (n.autoResize === 'none') {
      if (n.style.verticalAlign === 'middle') y = (n.height - h) / 2;
      else if (n.style.verticalAlign === 'bottom') y = n.height - h;
    }
    canvas.drawParagraph(p, 0, y);
  }
}
