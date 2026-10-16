// Componentes e instâncias. Uma instância guarda só o id do componente e os
// overrides; a árvore que aparece na tela é "resolvida" a partir do componente.
import type { ComponentProperty, ContainerNode, InstanceNode, InstanceOverride, SceneNode, ZalDocument } from './types';
import { applyConstraints, layoutNode, type MeasureText } from './layout';
import { clone, uid } from './util';
import { walk } from './document';

export type FindComponent = ((id: string, library?: string) => ContainerNode | undefined) & {
  /** Conjunto de variantes que contém o componente (se ele for uma variante). */
  setOf?: (id: string, library?: string) => ContainerNode | undefined;
};

/** Procura um componente numa lista que pode ter conjuntos de variantes. */
function findIn(list: ContainerNode[], id: string): { comp: ContainerNode; set?: ContainerNode } | undefined {
  for (const c of list) {
    if (c.id === id && c.type === 'component') return { comp: c };
    if (c.type === 'component-set') {
      const v = c.children.find((k) => k.id === id && k.type === 'component') as ContainerNode | undefined;
      if (v) return { comp: v, set: c };
    }
  }
  return undefined;
}

/**
 * Localiza componentes do arquivo (`local`) e das bibliotecas ligadas.
 * `localSet` diz qual conjunto de variantes contém um componente do arquivo.
 */
export function componentFinder(doc: ZalDocument, local: () => ContainerNode[], localSet?: (id: string) => ContainerNode | undefined): FindComponent {
  const inLibraries = (id: string, library?: string) => {
    for (const lib of doc.libraries) {
      if (library && lib.id !== library) continue;
      const r = findIn(lib.components, id);
      if (r) return r;
    }
    return undefined;
  };
  const find: FindComponent = (id, library) => {
    if (library) return inLibraries(id, library)?.comp;
    return local().find((c) => c.id === id) ?? inLibraries(id)?.comp;
  };
  find.setOf = (id, library) => {
    if (library) return inLibraries(id, library)?.set;
    if (local().some((c) => c.id === id)) return localSet?.(id);
    return inLibraries(id)?.set;
  };
  return find;
}

// ── Propriedades e variantes ─────────────────────────────────────────────────

/** Propriedades que valem para o componente (as do conjunto, se ele for uma variante). */
export function propertyDefs(main: ContainerNode, find: FindComponent, library?: string): ComponentProperty[] {
  const set = find.setOf?.(main.id, library);
  return (set ?? main).properties ?? [];
}

/** Valor de cada propriedade numa instância (o padrão quando ela não mudou). */
export function propertyValues(defs: ComponentProperty[], inst: Pick<InstanceNode, 'props'>): Record<string, boolean | string> {
  const out: Record<string, boolean | string> = {};
  for (const d of defs) {
    const v = inst.props?.[d.id];
    out[d.id] = d.type === 'boolean' ? (typeof v === 'boolean' ? v : d.default) : typeof v === 'string' ? v : d.default;
  }
  return out;
}

/** Eixos de variante de um conjunto, na ordem em que aparecem (ex.: Tamanho → [P, M, G]). */
export function variantAxes(set: ContainerNode): { name: string; values: string[] }[] {
  const axes: { name: string; values: string[] }[] = [];
  for (const c of set.children) {
    if (c.type !== 'component') continue;
    for (const [k, v] of Object.entries(c.variant ?? {})) {
      let a = axes.find((x) => x.name === k);
      if (!a) axes.push((a = { name: k, values: [] }));
      if (!a.values.includes(v)) a.values.push(v);
    }
  }
  return axes;
}

/** Nome padrão de uma variante: "Estado=Hover, Tamanho=G". */
export function variantName(variant: Record<string, string>): string {
  return Object.entries(variant).map(([k, v]) => `${k}=${v}`).join(', ');
}

/**
 * Variante do conjunto que tem os valores pedidos. Sem uma exata, a que mais combina
 * (sempre respeitando o eixo que acabou de mudar, `changed`).
 */
export function findVariant(set: ContainerNode, wanted: Record<string, string>, changed?: string): ContainerNode | undefined {
  let best: ContainerNode | undefined;
  let score = -1;
  for (const c of set.children) {
    if (c.type !== 'component') continue;
    const v = c.variant ?? {};
    if (changed && v[changed] !== wanted[changed]) continue;
    const s = Object.entries(wanted).filter(([k, val]) => v[k] === val).length;
    if (s > score) {
      best = c;
      score = s;
    }
  }
  return best;
}

/** Caminho de nomes de um nó dentro do componente (para achar o "mesmo" nó em outra variante). */
function namePath(root: ContainerNode, id: string): string[] | null {
  const visit = (list: SceneNode[], trail: string[]): string[] | null => {
    for (const n of list) {
      const t = [...trail, n.name];
      if (n.id === id) return t;
      if ('children' in n) {
        const r = visit(n.children, t);
        if (r) return r;
      }
    }
    return null;
  };
  return visit(root.children, []);
}

function idAtPath(root: ContainerNode, path: string[]): string | null {
  let list: SceneNode[] = root.children;
  let found: SceneNode | undefined;
  for (const name of path) {
    found = list.find((n) => n.name === name);
    if (!found) return null;
    list = 'children' in found ? found.children : [];
  }
  return found?.id ?? null;
}

/** Ao trocar de variante, leva os overrides para os nós de mesmo nome na outra variante. */
export function remapOverrides(overrides: Record<string, InstanceOverride> | undefined, from: ContainerNode, to: ContainerNode): Record<string, InstanceOverride> | undefined {
  if (!overrides) return undefined;
  const out: Record<string, InstanceOverride> = {};
  for (const [key, value] of Object.entries(overrides)) {
    const [head, ...rest] = key.split('/');
    const path = namePath(from, head);
    const id = path && idAtPath(to, path);
    if (id) out[[id, ...rest].join('/')] = value;
  }
  return Object.keys(out).length ? out : undefined;
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
  const props = propertyValues(propertyDefs(main, find, inst.library), inst);

  // Troca o componente de uma instância aninhada. Se ela estava no tamanho do componente
  // antigo, passa para o tamanho do novo (variantes de larguras diferentes não ficam cortadas).
  const swapTo = (n: InstanceNode, id: string, library?: string) => {
    const before = find(n.componentId, n.library);
    const after = find(id, library);
    n.componentId = id;
    n.library = library;
    if (before && after && Math.abs(n.width - before.width) < 0.5 && Math.abs(n.height - before.height) < 0.5) {
      n.width = after.width;
      n.height = after.height;
    }
  };

  // Propriedades, overrides e instâncias aninhadas
  const resolveChildren = (list: SceneNode[]): SceneNode[] =>
    list.map((n) => {
      const refs = n.propRefs;
      if (refs) {
        if (refs.visible && refs.visible in props && !props[refs.visible]) n.visible = false;
        if (refs.text && refs.text in props && n.type === 'text') n.text = String(props[refs.text]);
        const swap = refs.component && props[refs.component];
        if (swap && typeof swap === 'string' && n.type === 'instance') swapTo(n, swap);
      }
      const o = overrides[n.id];
      if (o) {
        if (o.text !== undefined && n.type === 'text') n.text = o.text;
        if (o.fills) n.fills = clone(o.fills);
        if (o.visible !== undefined) n.visible = o.visible;
        if (o.componentId && n.type === 'instance') swapTo(n, o.componentId, n.library);
        if (o.strokes) n.strokes = clone(o.strokes);
        if (o.opacity !== undefined) n.opacity = o.opacity;
        if (o.sizing) n.sizing = { ...o.sizing };
        if (o.width !== undefined) n.width = o.width;
        if (o.height !== undefined) n.height = o.height;
        if (o.autoResize && n.type === 'text') n.autoResize = o.autoResize;
      }
      if (n.type === 'instance') {
        // overrides do pai para nós dentro da instância aninhada: "<idAninhada>/<idInterno>"
        const nested: InstanceNode = { ...n, overrides: { ...(n.overrides ?? {}) } };
        const prefix = `${n.id}/`;
        for (const [k, v] of Object.entries(overrides)) if (k.startsWith(prefix)) nested.overrides![k.slice(prefix.length)] = v;
        const r = resolveInstance(nested, find, measureText, depth + 1);
        if (r) return { ...r, id: n.id, name: n.name, x: n.x, y: n.y, width: n.width, height: n.height, sizing: n.sizing, absolute: n.absolute, visible: n.visible, rotation: n.rotation, flipX: n.flipX, flipY: n.flipY };
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
    flipX: inst.flipX,
    flipY: inst.flipY,
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
