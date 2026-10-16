// Estilos reutilizáveis de cor, texto e efeito. O nó guarda a referência (`styles`)
// e também uma cópia do valor, para o arquivo continuar legível por quem não
// conhece estilos. Editar um estilo reescreve os nós que o usam.
import type { NodeStyles, Paint, SceneNode, Stroke, Style, TextStyle, ZalDocument } from './types';
import type { Op } from './ops';
import { walk } from './document';
import { clone } from './util';

export type StyleSlot = keyof NodeStyles;

/** Estilos do arquivo e das bibliotecas ligadas. */
export function allStyles(doc: ZalDocument): Style[] {
  return [...(doc.styles ?? []), ...doc.libraries.flatMap((l) => l.styles ?? [])];
}

export function findStyle(doc: ZalDocument, id: string): Style | undefined {
  return allStyles(doc).find((s) => s.id === id);
}

/** Que tipo de estilo cabe em cada lugar do nó. */
export function slotType(slot: StyleSlot): Style['type'] {
  return slot === 'text' ? 'text' : slot === 'effect' ? 'effect' : 'color';
}

/** Propriedades de texto que um estilo de texto carrega (alinhamento fica no nó). */
export function textStyleOf(st: TextStyle): TextStyle {
  const { align: _a, verticalAlign: _v, ...rest } = st;
  return clone(rest);
}

/** Mudanças num nó para que ele use o estilo no lugar indicado. */
export function stylePatch(node: SceneNode, style: Style, slot: StyleSlot): Record<string, unknown> | null {
  const styles = { ...node.styles, [slot]: style.id };
  if (style.type === 'color' && slot === 'fill') return { fills: clone(style.paints), styles };
  if (style.type === 'color' && slot === 'stroke') {
    const base: Stroke = node.strokes?.[0] ?? { paint: style.paints[0], width: 1, align: node.type === 'line' || node.type === 'path' ? 'center' : 'inside' };
    const strokes = style.paints.map((p: Paint, i) => ({ ...(node.strokes?.[i] ?? base), paint: clone(p) }));
    return { strokes, styles };
  }
  if (style.type === 'text' && slot === 'text' && node.type === 'text') return { style: { ...node.style, ...textStyleOf(style.text) }, styles };
  if (style.type === 'effect' && slot === 'effect') return { effects: clone(style.effects), styles };
  return null;
}

/** Tira a ligação com o estilo (o valor atual fica no nó). */
export function detachPatch(node: SceneNode, slot: StyleSlot): Record<string, unknown> {
  const styles = { ...node.styles };
  delete styles[slot];
  return { styles: Object.keys(styles).length ? styles : undefined };
}

/** Operações que reaplicam um estilo em todos os nós que o usam (inclusive dentro de componentes). */
export function propagateStyle(doc: ZalDocument, style: Style): Op[] {
  const ops: Op[] = [];
  for (const page of doc.pages) {
    walk(page.children, (n) => {
      if (!n.styles) return;
      for (const slot of Object.keys(n.styles) as StyleSlot[]) {
        if (n.styles[slot] !== style.id) continue;
        const patch = stylePatch(n, style, slot);
        if (!patch) continue;
        for (const [key, value] of Object.entries(patch)) {
          if (key === 'styles') continue;
          if (JSON.stringify((n as unknown as Record<string, unknown>)[key]) !== JSON.stringify(value)) ops.push({ op: 'set', id: n.id, key, value });
        }
      }
    });
  }
  return ops;
}

/** Operações que soltam todos os nós de um estilo que vai ser excluído. */
export function releaseStyle(doc: ZalDocument, styleId: string): Op[] {
  const ops: Op[] = [];
  for (const page of doc.pages) {
    walk(page.children, (n) => {
      if (!n.styles) return;
      for (const slot of Object.keys(n.styles) as StyleSlot[]) {
        if (n.styles[slot] === styleId) ops.push({ op: 'set', id: n.id, key: `styles.${slot}`, value: undefined });
      }
    });
  }
  return ops;
}

/** Quantos nós usam o estilo. */
export function styleUsage(doc: ZalDocument, styleId: string): number {
  let count = 0;
  for (const page of doc.pages) walk(page.children, (n) => {
    if (n.styles && Object.values(n.styles).includes(styleId)) count++;
  });
  return count;
}
