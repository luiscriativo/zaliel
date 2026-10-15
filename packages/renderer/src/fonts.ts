// Fontes do canvas. A Inter vai embutida no app (offline); as fontes instaladas
// no computador são lidas pela Local Font Access API do Chromium.
import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm';

export interface FontFace {
  family: string;
  style: string; // ex.: "Bold Italic"
  weight: number;
  italic: boolean;
  postscriptName?: string;
  load: () => Promise<ArrayBuffer>;
}

export interface FontFamily {
  family: string;
  faces: FontFace[];
  bundled?: boolean;
}

interface LocalFontData {
  family: string;
  style: string;
  fullName: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}

const WEIGHTS: [RegExp, number][] = [
  [/hairline|thin/i, 100],
  [/extra\s*light|ultra\s*light/i, 200],
  [/semi\s*light|demi\s*light/i, 350],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi\s*bold|demi\s*bold/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
];

export function weightFromStyle(style: string): number {
  for (const [re, w] of WEIGHTS) if (re.test(style)) return w;
  return 400;
}

export class FontRegistry {
  provider: TypefaceFontProvider;
  families = new Map<string, FontFamily>();
  private loaded = new Set<string>();
  private pending = new Map<string, Promise<boolean>>();
  private listeners = new Set<() => void>();
  systemFontsError: string | null = null;

  constructor(ck: CanvasKit) {
    this.provider = ck.TypefaceFontProvider.Make();
  }

  onLoad(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Fontes que vêm com o app: mapa "peso[-italic]" → URL do arquivo. */
  async registerBundled(family: string, files: Record<string, string>): Promise<void> {
    const faces: FontFace[] = Object.entries(files).map(([key, url]) => {
      const weight = parseInt(key, 10);
      const italic = key.includes('italic');
      return { family, style: `${weight}${italic ? ' Italic' : ''}`, weight, italic, load: () => fetch(url).then((r) => r.arrayBuffer()) };
    });
    this.families.set(family, { family, faces, bundled: true });
    // a regular já fica pronta para o primeiro desenho
    await this.ensure(family, 400, false);
  }

  /** Lê as fontes instaladas no sistema (Windows/macOS/Linux) — nada sai da máquina. */
  async loadSystemFonts(): Promise<number> {
    const q = (globalThis as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
    if (!q) {
      this.systemFontsError = 'Este sistema não permite listar as fontes instaladas.';
      return 0;
    }
    try {
      const list = await q();
      for (const f of list) {
        if (this.families.get(f.family)?.bundled) continue;
        let fam = this.families.get(f.family);
        if (!fam) {
          fam = { family: f.family, faces: [] };
          this.families.set(f.family, fam);
        }
        fam.faces.push({
          family: f.family,
          style: f.style,
          weight: weightFromStyle(f.style),
          italic: /italic|oblique/i.test(f.style),
          postscriptName: f.postscriptName,
          load: async () => (await f.blob()).arrayBuffer(),
        });
      }
      this.systemFontsError = null;
      return list.length;
    } catch (e) {
      this.systemFontsError = `Não foi possível ler as fontes do sistema: ${(e as Error).message}`;
      return 0;
    }
  }

  sortedFamilies(): FontFamily[] {
    return [...this.families.values()].sort((a, b) => (a.bundled === b.bundled ? a.family.localeCompare(b.family) : a.bundled ? -1 : 1));
  }

  private key(family: string, weight: number, italic: boolean) {
    return `${family}|${weight}|${italic ? 1 : 0}`;
  }

  /** Face mais próxima do peso/itálico pedido. */
  pick(family: string, weight: number, italic: boolean): FontFace | undefined {
    const fam = this.families.get(family);
    if (!fam || !fam.faces.length) return undefined;
    return [...fam.faces].sort((a, b) => {
      const da = Math.abs(a.weight - weight) + (a.italic === italic ? 0 : 1000);
      const db = Math.abs(b.weight - weight) + (b.italic === italic ? 0 : 1000);
      return da - db;
    })[0];
  }

  isReady(family: string, weight: number, italic: boolean): boolean {
    const face = this.pick(family, weight, italic);
    return !face || this.loaded.has(this.key(face.family, face.weight, face.italic));
  }

  has(family: string): boolean {
    return this.families.has(family);
  }

  /** Carrega a face (uma vez) e avisa quem desenha para redesenhar. */
  ensure(family: string, weight: number, italic: boolean): Promise<boolean> {
    const face = this.pick(family, weight, italic);
    if (!face) return Promise.resolve(false);
    const k = this.key(face.family, face.weight, face.italic);
    if (this.loaded.has(k)) return Promise.resolve(true);
    let p = this.pending.get(k);
    if (!p) {
      p = face
        .load()
        .then((buf) => {
          this.provider.registerFont(buf, face.family);
          this.loaded.add(k);
          for (const l of this.listeners) l();
          return true;
        })
        .catch(() => false);
      this.pending.set(k, p);
    }
    return p;
  }
}
