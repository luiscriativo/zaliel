// Histórico de versões dentro do arquivo. Cada versão guarda o documento daquele
// momento comprimido (gzip + base64). As imagens não entram: ficam uma vez só no
// fim do arquivo e servem a todas as versões.
import type { DocVersion, ZalDocument } from './types';
import { uid } from './util';

/** Quantas versões automáticas ficam guardadas (as com nome nunca são descartadas). */
export const MAX_AUTO_VERSIONS = 20;

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** O que vai para dentro de uma versão: tudo menos as imagens e o próprio histórico. */
function snapshotOf(doc: ZalDocument): Omit<ZalDocument, 'versions' | 'assets'> {
  const { versions: _v, assets: _a, ...rest } = doc;
  return rest;
}

/** Cria uma versão com o estado atual do documento. */
export async function createVersion(doc: ZalDocument, name: string, auto = false): Promise<DocVersion> {
  const json = JSON.stringify(snapshotOf(doc));
  const bytes = new TextEncoder().encode(json);
  const packed = await pipe(bytes, new CompressionStream('gzip'));
  return { id: uid(), name, createdAt: Date.now(), ...(auto ? { auto: true } : {}), data: toBase64(packed), size: bytes.length, pages: doc.pages.length };
}

/**
 * Documento de uma versão, pronto para abrir. As imagens vêm do documento atual
 * (`current`), e o histórico de versões continua o mesmo.
 */
export async function readVersion(v: DocVersion, current: ZalDocument): Promise<ZalDocument> {
  const bytes = await pipe(fromBase64(v.data), new DecompressionStream('gzip'));
  const snap = JSON.parse(new TextDecoder().decode(bytes)) as ZalDocument;
  return { ...snap, assets: current.assets, versions: current.versions };
}

/** Acrescenta uma versão e descarta as automáticas mais antigas além do limite. */
export function addVersion(list: DocVersion[] | undefined, v: DocVersion): DocVersion[] {
  const next = [...(list ?? []), v];
  const autos = next.filter((x) => x.auto);
  const drop = new Set(autos.slice(0, Math.max(0, autos.length - MAX_AUTO_VERSIONS)).map((x) => x.id));
  return next.filter((x) => !drop.has(x.id));
}
