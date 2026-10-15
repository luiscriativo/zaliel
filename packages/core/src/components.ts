// Componentes e instâncias. Uma instância guarda só o id do componente e os
// overrides; a árvore que aparece na tela é "resolvida" a partir do componente.
import type { ContainerNode, InstanceNode, SceneNode, ZalDocument } from './types';
import { applyConstraints, layoutNode, type MeasureText } from './layout';
import { clone, uid } from './util';
import { walk } from './document';

export type FindComponent = (id: string, library?: string) => ContainerNode | undefined;

export function componentFinder(doc: ZalDocument, local: () => ContainerNode[]): FindComponent {
  return (id, library) => {
    if (library) {
      const lib = doc.libraries.find((l) => l.id === library);
      return lib?.components.find((c) => c.id === id);
    }
    return local().find((c) => c.id === id) ?? doc.libraries.flatMap((l) => l.components).find((c) => c.id === id);
  };
}

/** Id que um nó interno ganha dentro de uma instância resolvida. */
export function innerId(instanceId: string, id: string): string {
  return `${instanceId}/${id}`;
}

/**
 * Resolve uma instância num frame "virtual" (somente leitura) com o conteúdo do componente,
 * já com overrides, layout e constraints aplicados no tamanho da instância.
 */
export function resolveInstance(inst: InstanceNode, find: FindComponent, measureText?: MeasureText, depth = 0): ContainerNode | null {
  const main = find(inst.componentId, inst.library);
  if (!main || depth > 12) return null;
  const tree = clone(main) as ContainerNode;
  const overrides = inst.overrides ?? {};

  // Overrides e instâncias aninhadas
  const resolveChildren = (list: SceneNode[]): SceneNode[] =>
    list.map((n) => {
      const o = overrides[n.id];
      if (o) {
        if (o.text !== undefined && n.type === 'text') n.text = o.text;
        if (o.fills) n.fills = clone(o.fills);
        if (o.visible !== undefined) n.visible = o.visible;
        if (o.componentId && n.type === 'instance') n.componentId = o.componentId;
      }
      if (n.type === 'instance') {
        // overrides do pai para nós dentro da instância aninhada: "<idAninhada>/<idInterno>"
        const nested: InstanceNode = { ...n, overrides: { ...(n.overrides ?? {}) } };
        const prefix = `${n.id}/`;
        for (const [k, v] of Object.entries(overrides)) if (k.startsWith(prefix)) nested.overrides![k.slice(prefix.length)] = v;
        const r = resolveInstance(nested, find, measureText, depth + 1);
        if (r) return { ...r, id: n.id, name: n.name, x: n.x, y: n.y, width: n.width, height: n.height, sizing: n.sizing, absolute: n.absolute, visible: n.visible, rotation: n.rotation };
        return n;
      }
      if ('children' in n) n.children = resolveChildren(n.children);
      return n;
    });
  tree.children = resolveChildren(tree.children);

  // Ajuste ao tamanho da instância
  const ctx = { measureText, changes: [] };
  const oldW = tree.width, oldH = tree.height;
  tree.width = inst.width;
  tree.height = inst.height;
  if (tree.layout) {
    tree.sizing = { horizontal: 'fixed', vertical: 'fixed' };
    layoutNode(tree, ctx, true, true);
  } else applyConstraints(tree, oldW, oldH, ctx);

  // Prefixa os ids para não colidirem com os do documento
  walk(tree.children, (n) => {
    n.id = innerId(inst.id, n.id);
  });

  return {
    ...tree,
    id: inst.id,
    type: 'frame',
    name: inst.name,
    x: inst.x,
    y: inst.y,
    rotation: inst.rotation,
    opacity: inst.opacity ?? tree.opacity,
    visible: inst.visible,
    blendMode: inst.blendMode ?? tree.blendMode,
    fills: inst.fills ?? tree.fills,
    strokes: inst.strokes ?? tree.strokes,
    effects: inst.effects ?? tree.effects,
    cornerRadius: inst.cornerRadius ?? tree.cornerRadius,
  };
}

/** Lista os textos de um componente (para editar overrides de texto no painel). */
export function overridableTexts(main: ContainerNode): { id: string; name: string; text: string }[] {
  const out: { id: string; name: string; text: string }[] = [];
  walk(main.children, (n) => {
    if (n.type === 'text') out.push({ id: n.id, name: n.name, text: n.text });
  });
  return out;
}

/** "Desanexar": transforma a instância numa cópia editável (frame comum). */
export function detachInstance(inst: InstanceNode, find: FindComponent, measureText?: MeasureText): ContainerNode | null {
  const r = resolveInstance(inst, find, measureText);
  if (!r) return null;
  const copy = clone(r);
  walk(copy.children, (n) => {
    n.id = uid();
  });
  return { ...copy, type: 'frame' };
}
