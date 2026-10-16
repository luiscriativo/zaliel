// Escrita de PDF (1.4) sem dependências: cada página é uma imagem do frame,
// do tamanho do frame (1 px = 1 pt). As imagens chegam já comprimidas (zlib)
// ou cruas; o PDF só as embala.

export interface PdfImage {
  /** Pixels da imagem (largura × altura). */
  width: number;
  height: number;
  /** RGB, 3 bytes por pixel (comprimido com zlib se `deflated`). */
  rgb: Uint8Array;
  /** Transparência opcional, 1 byte por pixel (mesma compressão). */
  alpha?: Uint8Array;
  deflated?: boolean;
}

export interface PdfPage {
  /** Tamanho da página em pontos. */
  width: number;
  height: number;
  image: PdfImage;
}

const enc = new TextEncoder();

/** Texto de PDF entre parênteses, com escape. Caracteres fora do Latin-1 viram "?". */
function pdfString(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (c < 32 || c > 255) out += c > 255 ? '?' : ' ';
    else if (c > 126) out += `\\${c.toString(8).padStart(3, '0')}`;
    else out += ch;
  }
  return `(${out})`;
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** Monta o arquivo PDF. */
export function buildPdf(pages: PdfPage[], info: { title?: string; producer?: string } = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (data: string | Uint8Array) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(b);
    size += b.length;
  };
  // ids: 1 catálogo, 2 páginas, 3 info; depois 4 por página (página, conteúdo, imagem, máscara)
  const obj = (id: number, body: string | (string | Uint8Array)[]) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    for (const part of Array.isArray(body) ? body : [body]) push(part);
    push('\nendobj\n');
  };
  const stream = (dict: string, data: Uint8Array) => [`<< ${dict} /Length ${data.length} >>\nstream\n`, data, '\nendstream'];

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const kids = pages.map((_, i) => `${4 + i * 4} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  obj(3, `<< /Title ${pdfString(info.title ?? '')} /Producer ${pdfString(info.producer ?? '')} >>`);
  pages.forEach((p, i) => {
    const id = 4 + i * 4;
    const w = fmt(p.width), h = fmt(p.height);
    const content = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    obj(id + 1, stream('', content));
    const img = p.image;
    const filter = img.deflated ? ' /Filter /FlateDecode' : '';
    const mask = img.alpha ? ` /SMask ${id + 3} 0 R` : '';
    obj(id + 2, stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${filter}${mask}`, img.rgb));
    if (img.alpha) obj(id + 3, stream(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8${filter}`, img.alpha));
    else obj(id + 3, '<< >>');
  });
  const count = 4 + pages.length * 4;
  const xref = size;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) table += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Separa pixels RGBA (sem pré-multiplicar) em RGB e alfa. O alfa some se tudo for opaco. */
export function splitRgba(rgba: Uint8Array, width: number, height: number): { rgb: Uint8Array; alpha?: Uint8Array } {
  const n = width * height;
  const rgb = new Uint8Array(n * 3);
  const alpha = new Uint8Array(n);
  let opaque = true;
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
    alpha[i] = rgba[i * 4 + 3];
    if (alpha[i] !== 255) opaque = false;
  }
  return opaque ? { rgb } : { rgb, alpha };
}

/** Comprime com zlib (o formato que o PDF chama de FlateDecode). Usa o CompressionStream nativo. */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const res = new Response(new Blob([data as BlobPart]).stream().pipeThrough(cs));
  return new Uint8Array(await res.arrayBuffer());
}
