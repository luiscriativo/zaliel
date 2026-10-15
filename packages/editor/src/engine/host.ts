// Liga o CanvasKit ao elemento <canvas>: carregamento, laço de desenho, medida de texto e exportação.
import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';
import { FontRegistry, Renderer } from '@zaliel/renderer';
import type { SceneNode, TextNode } from '@zaliel/core';
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
        this.editor.model.refreshLayout();
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
