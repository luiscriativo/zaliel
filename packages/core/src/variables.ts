// Variáveis (tokens) com modos — ex.: cores para tema claro e escuro.
import type { Paint, Variable, VariableCollection, VariableValue, ZalDocument } from './types';

export function allCollections(doc: ZalDocument): VariableCollection[] {
  return [...doc.variables, ...doc.libraries.flatMap((l) => l.variables ?? [])];
}

export function findVariable(doc: ZalDocument, id: string): { variable: Variable; collection: VariableCollection } | undefined {
  for (const collection of allCollections(doc)) {
    const variable = collection.variables.find((v) => v.id === id);
    if (variable) return { variable, collection };
  }
  return undefined;
}

/** Valor da variável no modo escolhido (segue aliases, com proteção contra ciclos). */
export function resolveVariable(doc: ZalDocument, id: string, modes: Record<string, string> = {}, depth = 0): VariableValue | undefined {
  const found = findVariable(doc, id);
  if (!found || depth > 16) return undefined;
  const mode = modes[found.collection.id] ?? found.collection.defaultMode;
  const v = found.variable.values[mode] ?? found.variable.values[found.collection.defaultMode];
  if (v && typeof v === 'object' && 'alias' in v) return resolveVariable(doc, v.alias, modes, depth + 1);
  return v;
}

/** Aplica a variável ligada a uma pintura sólida (se houver). */
export function resolvePaint(doc: ZalDocument, p: Paint, modes?: Record<string, string>): Paint {
  if (p.type === 'solid' && p.variable) {
    const v = resolveVariable(doc, p.variable, modes);
    if (typeof v === 'string') return { ...p, color: v };
  }
  return p;
}
