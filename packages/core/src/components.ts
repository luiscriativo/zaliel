// Componentes e instâncias. Uma instância guarda só o id do componente e os
// overrides; a árvore que aparece na tela é "resolvida" a partir do componente.
import type { AutoLayout, ComponentProperty, ContainerNode, InstanceNode, InstanceOverride, SceneNode, ZalDocument } from './types';
import { applyConstraints, layoutNode, type MeasureText } from './layout';
import { clone, uid } from './util';
import { reidentify, walk, type DocIndex } from './document';
import type { Op } from './ops';

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
export function resolveInstance(inst: InstanceNode, find: FindComponent, measureText?: MeasureText, depth = 0, natural = false): ContainerNode | null {
  const main = find(inst.componentId, inst.library);
  if (!main || depth > 12) return null;
  const tree = clone(main) as ContainerNode;
  const overrides = inst.overrides ?? {};
  const props = propertyValues(propertyDefs(main, find, inst.library), inst);
  const swappedFrom = new Map<string, ContainerNode>();
  // conteúdo próprio dos slots (camadas reais da instância: mantêm os ids)
  const own = new Map((inst.slots ?? []).map((h) => [h.slotOf, h]));
  const injected = new Set<SceneNode>();

  // Troca o componente de uma instância aninhada. Se ela estava no tamanho do componente
  // antigo, passa para o tamanho do novo (variantes de larguras diferentes não ficam cortadas).
  const swapTo = (n: InstanceNode, id: string, library?: string) => {
    const before = find(n.componentId, n.library);
    const after = find(id, library);
    if (before && !swappedFrom.has(n.id)) swappedFrom.set(n.id, before);
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
        // a propriedade manda nos dois sentidos: esconde, e também mostra o que está oculto no componente
        if (refs.visible && refs.visible in props) n.visible = props[refs.visible] !== false;
        if (refs.text && refs.text in props && n.type === 'text' && n.text !== String(props[refs.text])) {
          // texto trocado: os trechos de estilo do componente não valem mais para ele
          n.text = String(props[refs.text]);
          delete n.runs;
        }
        const swap = refs.component && props[refs.component];
        if (swap && typeof swap === 'string' && n.type === 'instance') swapTo(n, swap);
      }
      const o = overrides[n.id];
      if (o) {
        if (o.text !== undefined && n.type === 'text') {
          if (o.runs) n.runs = clone(o.runs);
          else if (o.text !== n.text) delete n.runs;
          n.text = o.text;
        }
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
        // componente trocado: os overrides apontavam para o antigo; seguem para as camadas de mesmo nome
        const from = swappedFrom.get(n.id);
        const to = from && find(nested.componentId, nested.library);
        if (from && to) nested.overrides = remapOverrides(nested.overrides, from, to) ?? {};
        const size = naturalInstanceSize(nested, find, measureText, depth + 1);
        if (size) {
          nested.width = size.width;
          nested.height = size.height;
        }
        const r = resolveInstance(nested, find, measureText, depth + 1);
        if (r) return { ...r, id: n.id, name: n.name, x: n.x, y: n.y, width: nested.width, height: nested.height, sizing: n.sizing, absolute: n.absolute, visible: n.visible, rotation: n.rotation, flipX: n.flipX, flipY: n.flipY };
        return n;
      }
      if ('children' in n) {
        const holder = n.slot ? own.get(n.id) : undefined;
        if (holder) {
          n.children = clone(holder.children);
          for (const c of n.children) injected.add(c);
          applySlotLook(n, holder);
        } else n.children = resolveChildren(n.children);
      }
      return n;
    });
  tree.children = resolveChildren(tree.children);

  // Tamanho natural: os eixos que abraçam o conteúdo se medem; os outros ficam no tamanho da instância
  if (natural) {
    const hug = instanceHug(inst, main);
    if (!tree.layout || (!hug.horizontal && !hug.vertical)) return null;
    if (!hug.horizontal) tree.width = inst.width;
    if (!hug.vertical) tree.height = inst.height;
    tree.sizing = { horizontal: hug.horizontal ? 'hug' : 'fixed', vertical: hug.vertical ? 'hug' : 'fixed' };
    layoutNode(tree, { measureText, changes: [] });
    return tree;
  }

  // Ajuste ao tamanho da instância
  const ctx = { measureText, changes: [] };
  const oldW = tree.width, oldH = tree.height;
  tree.width = inst.width;
  tree.height = inst.height;
  if (tree.layout) {
    tree.sizing = { horizontal: 'fixed', vertical: 'fixed' };
    layoutNode(tree, ctx, true, true);
  } else {
    // conteúdo de slot é novo para o componente: os frames com auto layout de dentro se arrumam
    if (injected.size) for (const c of tree.children) layoutNode(c, ctx);
    applyConstraints(tree, oldW, oldH, ctx);
  }

  // Prefixa os ids para não colidirem com os do documento (o conteúdo dos slots é da instância e fica como está)
  walk(tree.children, (n) => {
    if (injected.has(n)) return false;
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

/** Em que eixos a instância abraça o conteúdo: o que ela definiu, senão o que o componente define. */
function instanceHug(inst: InstanceNode, main: ContainerNode): { horizontal: boolean; vertical: boolean } {
  const own = inst.sizing;
  const base = main.layout ? main.sizing : undefined;
  return {
    horizontal: (own?.horizontal ?? base?.horizontal) === 'hug',
    vertical: (own?.vertical ?? base?.vertical) === 'hug',
  };
}

/**
 * Tamanho que uma instância teria abraçando o conteúdo (textos e propriedades dela), como no
 * componente. null quando ela não abraça em nenhum eixo — aí vale o tamanho gravado.
 */
export function naturalInstanceSize(inst: InstanceNode, find: FindComponent, measureText?: MeasureText, depth = 0): { width: number; height: number } | null {
  const main = find(inst.componentId, inst.library);
  if (!main?.layout) return null;
  const hug = instanceHug(inst, main);
  if (!hug.horizontal && !hug.vertical) return null;
  const tree = resolveInstance(inst, find, measureText, depth, true);
  return tree ? { width: tree.width, height: tree.height } : null;
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
  // ids novos em tudo, inclusive no conteúdo de slots de instâncias que estavam dentro
  const copy = reidentify(r);
  copy.id = uid();
  // fora de um componente a marca de slot não significa nada
  walk(copy.children, (n) => {
    if ('children' in n) delete n.slot;
  });
  return { ...copy, type: 'frame' };
}

// ── Slots ────────────────────────────────────────────────────────────────────

/** Aparência do frame-slot que a instância pode mudar (como no Figma: preenchimento, contorno, efeitos, opacidade). */
function applySlotLook(n: ContainerNode, holder: ContainerNode): void {
  if (holder.fills) n.fills = clone(holder.fills);
  if (holder.strokes) n.strokes = clone(holder.strokes);
  if (holder.effects) n.effects = clone(holder.effects);
  if (holder.opacity !== undefined) n.opacity = holder.opacity;
  if (holder.visible === false) n.visible = false;
}

/** Slots de um componente (frames marcados), na ordem da árvore. Não entra em instâncias aninhadas. */
export function componentSlots(main: ContainerNode): ContainerNode[] {
  const out: ContainerNode[] = [];
  walk(main.children, (n) => {
    if (n.type === 'frame' && n.slot) out.push(n);
  });
  return out;
}

/** Frame-slot do componente pelo id. */
export function findSlot(main: ContainerNode, slotId: string): ContainerNode | undefined {
  return componentSlots(main).find((s) => s.id === slotId);
}

/**
 * Conteúdo padrão de um slot, como camadas novas da instância (ids novos), já com os overrides
 * simples que a instância tinha nelas (texto, cores, visibilidade).
 */
export function slotDefaultContent(inst: InstanceNode, slot: ContainerNode): SceneNode[] {
  const overrides = inst.overrides ?? {};
  const kids = clone(slot.children);
  walk(kids, (n) => {
    const o = overrides[n.id];
    if (!o) return;
    if (o.text !== undefined && n.type === 'text') {
      n.text = o.text;
      if (o.runs) n.runs = clone(o.runs);
      else delete n.runs;
    }
    if (o.fills) n.fills = clone(o.fills);
    if (o.strokes) n.strokes = clone(o.strokes);
    if (o.visible !== undefined) n.visible = o.visible;
    if (o.opacity !== undefined) n.opacity = o.opacity;
    if (o.componentId && n.type === 'instance') n.componentId = o.componentId;
  });
  return kids.map((k) => reidentify(k));
}

/** Onde cada slot com conteúdo próprio fica dentro da instância (para gravar nas camadas reais). */
export interface SlotPlacement {
  /** Id do frame da instância que guarda o conteúdo. */
  holder: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layout?: AutoLayout;
  clip?: boolean;
  /** Posição e tamanho de cada camada do conteúdo, depois do layout do slot. */
  children: { id: string; x: number; y: number; width: number; height: number }[];
}

export function placeSlots(inst: InstanceNode, find: FindComponent, measureText?: MeasureText): SlotPlacement[] {
  if (!inst.slots?.length) return [];
  const r = resolveInstance(inst, find, measureText);
  if (!r) return [];
  const byKey = new Map(inst.slots.map((h) => [innerId(inst.id, h.slotOf ?? ''), h]));
  const out: SlotPlacement[] = [];
  const visit = (list: SceneNode[], ox: number, oy: number) => {
    for (const n of list) {
      if (!('children' in n)) continue;
      const holder = byKey.get(n.id);
      if (holder) {
        out.push({
          holder: holder.id,
          x: ox + n.x,
          y: oy + n.y,
          width: n.width,
          height: n.height,
          layout: n.layout,
          clip: n.clip,
          children: n.children.map((c) => ({ id: c.id, x: c.x, y: c.y, width: c.width, height: c.height })),
        });
        continue;
      }
      visit(n.children, ox + n.x, oy + n.y);
    }
  };
  visit(r.children, 0, 0);
  return out;
}

/** Ao trocar de variante, cada conteúdo de slot vai para o slot de mesmo nome na outra variante. */
export function remapSlots(slots: ContainerNode[] | undefined, from: ContainerNode, to: ContainerNode): { holder: string; slotOf: string | null }[] {
  return (slots ?? []).map((h) => {
    const path = h.slotOf ? namePath(from, h.slotOf) : null;
    const id = path && idAtPath(to, path);
    const target = id ? findSlot(to, id) : undefined;
    return { holder: h.id, slotOf: target ? target.id : null };
  });
}

/** Id (de instância) do slot vazio: "instância/slot". Serve de destino antes de o slot ter conteúdo próprio. */
export function slotTarget(instanceId: string, slotId: string): string {
  return innerId(instanceId, slotId);
}

/** Frame da instância que guarda o conteúdo de um slot. */
export function slotHolder(inst: InstanceNode, slotId: string): ContainerNode | undefined {
  return inst.slots?.find((h) => h.slotOf === slotId);
}

/** Frame novo para o conteúdo de um slot (começa com o conteúdo padrão do componente). */
export function createSlotHolder(inst: InstanceNode, slot: ContainerNode, withDefaults = true): ContainerNode {
  return {
    id: uid(),
    type: 'frame',
    name: slot.name,
    slotOf: slot.id,
    x: 0,
    y: 0,
    width: slot.width,
    height: slot.height,
    ...(slot.layout ? { layout: clone(slot.layout) } : {}),
    ...(slot.clip ? { clip: true } : {}),
    children: withDefaults ? slotDefaultContent(inst, slot) : [],
  };
}

/**
 * Operações que inserem ou movem para "instância/slot" (um slot ainda sem conteúdo próprio):
 * cria antes o frame do slot na instância (com o conteúdo padrão) e manda a camada para ele.
 */
export function materializeSlots(index: DocIndex, find: FindComponent, ops: Op[]): Op[] {
  if (!ops.some((o) => (o.op === 'insert' || o.op === 'move') && o.parent.includes('/'))) return ops;
  const created = new Map<string, string>(); // "instância/slot" → frame criado
  const out: Op[] = [];
  for (const op of ops) {
    if ((op.op !== 'insert' && op.op !== 'move') || !op.parent.includes('/')) {
      out.push(op);
      continue;
    }
    let holderId = created.get(op.parent);
    if (!holderId) {
      const [instId, ...rest] = op.parent.split('/');
      const slotId = rest.join('/');
      const inst = index.get(instId);
      const main = inst?.type === 'instance' ? find(inst.componentId, inst.library) : undefined;
      const slot = main && !rest.slice(1).length ? findSlot(main, slotId) : undefined;
      if (!inst || inst.type !== 'instance' || !slot) {
        out.push(op); // não é um slot: deixa a operação falhar com a mensagem de sempre
        continue;
      }
      const existing = slotHolder(inst, slotId);
      if (existing) holderId = existing.id;
      else {
        const holder = createSlotHolder(inst, slot);
        out.push({ op: 'insert', parent: inst.id, index: (inst.slots?.length ?? 0) + created.size, node: holder });
        holderId = holder.id;
      }
      created.set(op.parent, holderId);
    }
    // quem mirou "instância/slot" não conhecia a lista do slot: a camada entra no fim (depois do padrão)
    out.push({ ...op, parent: holderId, index: 1e9 });
  }
  return out;
}
