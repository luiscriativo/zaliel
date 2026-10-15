// Formato .zal: JSON legível (UTF-8, indentado). Abre no Bloco de Notas/VS Code.
// As imagens vão em base64 no fim do arquivo ("assets") para o JSON principal
// continuar fácil de ler.
import { z } from 'zod';
import { FORMAT_VERSION, type ContainerNode, type LinkedLibrary, type SceneNode, type ZalDocument } from './types';
import { walk } from './document';

export const EXTENSION = 'zal';

const hex = z.string().regex(/^#([0-9a-f]{6}|[0-9a-f]{8})$/i, 'cor inválida (use #rrggbb ou #rrggbbaa)');
const num = z.number().refine(Number.isFinite, 'número inválido');

const nodeTypes = ['frame', 'group', 'rect', 'ellipse', 'line', 'polygon', 'star', 'path', 'text', 'component', 'instance'] as const;

const NodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.looseObject({
    id: z.string().min(1),
    type: z.enum(nodeTypes),
    name: z.string(),
    x: num,
    y: num,
    width: num.min(0),
    height: num.min(0),
    children: z.array(NodeSchema).optional(),
    text: z.string().optional(),
    componentId: z.string().optional(),
  }),
);

const PageSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  background: hex,
  children: z.array(NodeSchema),
});

const DocumentSchema = z.looseObject({
  format: z.literal('zaliel'),
  version: z.number().int().min(1),
  id: z.string().min(1),
  name: z.string(),
  pages: z.array(PageSchema).min(1),
  variables: z.array(z.any()).default([]),
  libraries: z.array(z.any()).default([]),
  assets: z.record(z.string(), z.looseObject({ mime: z.string(), data: z.string() })).default({}),
});

export class FileFormatError extends Error {
  constructor(message: string, public details?: string) {
    super(message);
  }
}

/** Converte um documento para o texto do arquivo .zal. */
export function serialize(doc: ZalDocument): string {
  // ordem fixa das chaves de topo: o conteúdo de design primeiro, as imagens por último
  const { format, version, id, name, settings, pages, variables, libraries, meta, assets } = doc;
  const ordered = { format, version, id, name, settings, pages, variables, libraries, meta, assets };
  return JSON.stringify(ordered, null, 2) + '\n';
}

/** Lê o texto de um .zal, valida, migra versões antigas e devolve o documento. */
export function parse(text: string): ZalDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new FileFormatError('O arquivo não é um JSON válido.', String((e as Error).message));
  }
  if (!raw || typeof raw !== 'object' || (raw as { format?: string }).format !== 'zaliel') {
    throw new FileFormatError('Este arquivo não é um documento do Zaliel.');
  }
  const version = (raw as { version?: number }).version ?? 0;
  if (version > FORMAT_VERSION) {
    throw new FileFormatError(`Este arquivo foi criado por uma versão mais nova do Zaliel (formato ${version}). Atualize o aplicativo para abri-lo.`);
  }
  const migrated = migrate(raw as Record<string, unknown>);
  const res = DocumentSchema.safeParse(migrated);
  if (!res.success) {
    const issue = res.error.issues[0];
    throw new FileFormatError('O arquivo está danificado ou foi editado de forma inválida.', `${issue.path.join('.')}: ${issue.message}`);
  }
  const doc = res.data as unknown as ZalDocument;
  checkUniqueIds(doc);
  return doc;
}

function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  // versão 1 é a primeira; migrações futuras entram aqui, uma por versão
  return { ...raw, version: FORMAT_VERSION };
}

function checkUniqueIds(doc: ZalDocument) {
  const seen = new Set<string>();
  for (const p of doc.pages) {
    if (seen.has(p.id)) throw new FileFormatError('O arquivo tem ids repetidos.', p.id);
    seen.add(p.id);
    walk(p.children, (n) => {
      if (seen.has(n.id)) throw new FileFormatError('O arquivo tem ids repetidos.', n.id);
      seen.add(n.id);
    });
  }
}

/** Hash curto e estável (FNV-1a) — usado para detectar atualização de bibliotecas. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Componentes que um arquivo publica como biblioteca (todos os componentes do arquivo). */
export function publishedComponents(doc: ZalDocument): ContainerNode[] {
  const out: ContainerNode[] = [];
  for (const p of doc.pages) walk(p.children, (n) => {
    if (n.type === 'component') out.push(n);
  });
  return out;
}

/** Monta a cópia de uma biblioteca para ficar guardada dentro do arquivo que a usa. */
export function buildLibrary(source: ZalDocument, path: string): LinkedLibrary {
  const components = JSON.parse(JSON.stringify(publishedComponents(source))) as ContainerNode[];
  // só as imagens usadas pelos componentes
  const used = new Set<string>();
  walk(components as SceneNode[], (n) => {
    for (const f of [...(n.fills ?? []), ...(n.strokes ?? []).map((s) => s.paint)]) if (f.type === 'image') used.add(f.asset);
  });
  const assets = Object.fromEntries(Object.entries(source.assets).filter(([k]) => used.has(k)));
  const payload = JSON.stringify({ components, variables: source.variables });
  return { id: source.id, name: source.name, path, hash: hashText(payload), components, variables: source.variables, assets };
}
