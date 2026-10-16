// Leitura de arquivos de outros programas para importação. Aqui só se lê do disco e
// se descomprime; a conversão para o formato do Zaliel acontece na interface.
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readFigContainer, readZip, penDependencies } from '@zaliel/core';

export const IMPORT_EXTENSIONS = ['fig', 'pen'];

export type ImportPayload =
  | { kind: 'fig'; name: string; schema: Uint8Array; data: Uint8Array; images: Record<string, Uint8Array>; background?: string }
  | { kind: 'pen'; name: string; text: string; imports: Record<string, { name: string; text: string }>; images: Record<string, Uint8Array> };

const inflateRaw = (b: Uint8Array) => new Uint8Array(zlib.inflateRawSync(b));
const zstd = typeof (zlib as { zstdDecompressSync?: unknown }).zstdDecompressSync === 'function' ? (b: Uint8Array) => new Uint8Array((zlib as unknown as { zstdDecompressSync: (b: Uint8Array) => Buffer }).zstdDecompressSync(b)) : undefined;

/** Procura um arquivo relativo à pasta do documento (e às pastas acima, até três níveis). */
function findNear(dir: string, rel: string): string | null {
  if (path.isAbsolute(rel)) return existsSync(rel) ? rel : null;
  let cur = dir;
  for (let i = 0; i < 4; i++) {
    const p = path.join(cur, rel);
    if (existsSync(p)) return p;
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return null;
}

export async function readForImport(file: string): Promise<ImportPayload> {
  const ext = path.extname(file).slice(1).toLowerCase();
  const name = path.basename(file, path.extname(file));
  const bytes = new Uint8Array(await fs.readFile(file));
  const looksJson = bytes[0] === 0x7b || (bytes[0] === 0xef && bytes[3] === 0x7b);
  if (ext === 'pen' || looksJson) {
    const text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
    const dir = path.dirname(file);
    const imports: Record<string, { name: string; text: string }> = {};
    const images: Record<string, Uint8Array> = {};
    // bibliotecas (e as bibliotecas delas), com apelidos encadeados: "Q", "Q:R"…
    const queue: { text: string; dir: string; prefix: string }[] = [{ text, dir, prefix: '' }];
    const done = new Set<string>();
    while (queue.length) {
      const cur = queue.shift()!;
      let deps: ReturnType<typeof penDependencies>;
      try {
        deps = penDependencies(cur.text);
      } catch {
        continue;
      }
      for (const url of deps.images) {
        const p = findNear(cur.dir, url);
        if (p && !images[url]) images[url] = new Uint8Array(await fs.readFile(p));
      }
      for (const [alias, rel] of Object.entries(deps.imports)) {
        const key = cur.prefix ? `${cur.prefix}:${alias}` : alias;
        const p = findNear(cur.dir, rel);
        if (!p || done.has(key)) continue;
        done.add(key);
        const libText = (await fs.readFile(p, 'utf8')).replace(/^﻿/, '');
        imports[key] = { name: path.basename(p, path.extname(p)), text: libText };
        queue.push({ text: libText, dir: path.dirname(p), prefix: key });
      }
    }
    return { kind: 'pen', name, text, imports, images };
  }
  const c = readFigContainer(bytes, { inflateRaw, zstd }, readZip);
  return { kind: 'fig', name, schema: c.schema, data: c.data, images: c.images, background: c.background };
}
