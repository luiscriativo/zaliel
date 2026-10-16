// Liga o CanvasKit ao elemento <canvas>: carregamento, laço de desenho, medida de texto e exportação.
import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';
import { FontRegistry, Renderer, booleanPathData, outlineData, normalizePath, type PathData } from '@zaliel/renderer';
import type { ContainerNode, SceneNode, TextNode } from '@zaliel/core';
import type { Editor } from '../editor';
import { drawOverlay } from './overlay';
import type { Interaction } from './interaction';

export interface HostAssets {
  wasmUrl: string;
  /** Inter embutida: "400" → URL, "400-italic" → URL… */
  interFiles: Record<string, string>;
}

let ckPromise: Promise<CanvasKit> | null = null;

export function loadCanvasKit(wasmUrl: string): Promise<CanvasKit> {
  ckPromise ??= CanvasKitInit({ locateFile: () => wasmUrl });
  return ckPromise;
}

export class CanvasHost {
  renderer: Renderer;
  fonts: FontRegistry;
  canvas: HTMLCanvasElement | null = null;
  interaction: Interaction | null = null;
  /** Onde ficou o nome de cada frame do topo no último desenho (px de tela), para clicar nele. */
  frameLabels: { id: string; x: number; y: number; width: number; angle: number }[] = [];
  private raf = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private readyCallbacks: (() => void)[] = [];
  private relayoutTimer = 0;
  contextLost = false;
  onFontsChanged: (() => void) | null = null;

  static async create(editor: Editor, assets: HostAssets): Promise<CanvasHost> {
    const ck = await loadCanvasKit(assets.wasmUrl);
    const fonts = new FontRegistry(ck);
    await fonts.registerBundled('Inter', assets.interFiles);
    const host = new CanvasHost(editor, ck, fonts);
    // fontes do sistema chegam depois, sem travar a abertura
    fonts.loadSystemFonts().then(() => host.onFontsChanged?.());
    return host;
  }

  constructor(public editor: Editor, public ck: CanvasKit, fonts: FontRegistry) {
    this.fonts = fonts;
    this.renderer = new Renderer(ck, fonts);
    fonts.onLoad(() => {
      // uma fonte nova muda a medida dos textos: refaz o layout uma vez, sem histórico
      clearTimeout(this.relayoutTimer);
      this.relayoutTimer = window.setTimeout(() => {
        this.renderer.text.clear();
        this.renderer.invalidate();
        this.editor.relayoutAfterFonts();
        this.invalidate();
      }, 30);
    });
  }

  measureText = (n: TextNode, maxWidth: number) => this.renderer.text.measure(n, maxWidth);

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.addEventListener('webglcontextlost', this.onLost);
    this.resize();
    for (const cb of this.readyCallbacks.splice(0)) cb();
  }

  unmount(): void {
    cancelAnimationFrame(this.raf);
    this.canvas?.removeEventListener('webglcontextlost', this.onLost);
    this.renderer.surface?.delete();
    this.renderer.surface = null;
    this.canvas = null;
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    // recria a superfície quando o contexto da GPU volta
    setTimeout(() => {
      if (this.canvas) {
        this.renderer.attach(this.canvas);
        this.contextLost = false;
        this.invalidate();
      }
    }, 200);
  };

  whenReady(cb: () => void): void {
    if (this.canvas && this.width) cb();
    else this.readyCallbacks.push(cb);
  }

  size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  resize(): void {
    const c = this.canvas;
    if (!c) return;
    const r = c.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
    if (w === this.width && h === this.height && dpr === this.dpr && this.renderer.surface) return;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    this.renderer.attach(c);
    this.draw();
  }

  resetDocument(): void {
    this.renderer.invalidate();
    this.renderer.resetImages();
    this.renderer.text.clear();
  }

  invalidate = (): void => {
    if (this.raf || !this.canvas) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  };

  draw(): void {
    const e = this.editor;
    if (!this.canvas || this.contextLost || e.home) return;
    const hidden = e.editingText ? new Set([e.editingText]) : undefined;
    this.renderer.frame({
      doc: e.doc,
      page: e.page,
      viewport: e.viewport,
      dpr: this.dpr,
      resolve: e.resolve,
      hidden,
      overlay: (canvas, ck) => drawOverlay(this, canvas, ck),
    });
  }

  exportImage(n: SceneNode, scale: number, format: 'png' | 'jpg' | 'webp'): Uint8Array | null {
    return this.renderer.exportImage(this.editor.doc, n, this.editor.resolve, scale, format);
  }

  /** Pixels RGBA de um nó (para o PDF). */
  pixels(n: SceneNode, scale: number): { width: number; height: number; rgba: Uint8Array } | null {
    return this.renderer.exportPixels(this.editor.doc, n, this.editor.resolve, scale);
  }

  /**
   * Imagem codificada pelo codificador do próprio navegador (bem mais rápido que o do Skia
   * e assíncrono: a janela continua respondendo em exportações grandes).
   */
  async encodeImage(n: SceneNode, scale: number, format: 'png' | 'jpg' | 'webp'): Promise<Uint8Array | null> {
    const px = this.pixels(n, scale);
    if (!px || typeof OffscreenCanvas === 'undefined') return this.exportImage(n, scale, format);
    const canvas = new OffscreenCanvas(px.width, px.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return this.exportImage(n, scale, format);
    const image = new ImageData(new Uint8ClampedArray(px.rgba), px.width, px.height);
    if (format === 'jpg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, px.width, px.height);
      const tmp = new OffscreenCanvas(px.width, px.height);
      tmp.getContext('2d')!.putImageData(image, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    } else ctx.putImageData(image, 0, 0);
    const type = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    const blob = await canvas.convertToBlob({ type, quality: 0.92 });
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** Resultado de uma operação booleana como caminho SVG (Path.MakeFromOp). */
  booleanData(n: ContainerNode): PathData {
    return booleanPathData(this.ck, n, this.editor.resolve);
  }

  /** Contorno de uma forma como caminho SVG (para converter em vetor). Textos viram o contorno das letras. */
  outline(n: SceneNode): PathData {
    if (n.type === 'text') return { d: this.renderer.textOutline(n) ?? '', fillRule: 'nonzero' };
    return outlineData(this.ck, n, this.editor.resolve);
  }

  /** Caminho SVG levado por uma matriz [a,b,c,d,e,f] e sem arcos (`keepOrigin`: não move para 0,0). */
  normalizePath(d: string, m: number[] = [1, 0, 0, 1, 0, 0], evenOdd = false, keepOrigin = false) {
    return normalizePath(this.ck, d, m as [number, number, number, number, number, number], evenOdd, keepOrigin);
  }

  /** O texto pode virar vetor agora? (a fonte precisa estar carregada e legível) */
  canOutlineText(n: SceneNode): boolean {
    return n.type === 'text' && this.renderer.textOutline(n) !== null;
  }

  /** Miniatura (data URL) de um nó — usada no painel de recursos. */
  thumbnail(n: SceneNode, max = 96): string | null {
    const scale = Math.min(2, (max * 2) / Math.max(n.width, n.height, 1));
    const bytes = this.renderer.exportImage(this.editor.doc, n, this.editor.resolve, scale, 'png');
    if (!bytes) return null;
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(s)}`;
  }
}
