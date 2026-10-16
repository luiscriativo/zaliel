import { describe, expect, it } from 'vitest';
import {
  Model,
  createDocument,
  createNode,
  serialize,
  parse,
  resolveInstance,
  naturalInstanceSize,
  componentFinder,
  placeSlots,
  materializeSlots,
  slotTarget,
  detachInstance,
  remapSlots,
  reidentify,
  penToDocument,
  type ContainerNode,
  type InstanceNode,
  type TextNode,
} from '../src';

const measure = (n: TextNode) => ({ width: n.text.length * 10, height: 20 });

/** Cartão com título fixo e um slot "Conteúdo" (auto layout vertical, abraça a altura). */
function setup() {
  const doc = createDocument('Slots');
  const model = new Model(doc);
  const page = doc.pages[0];
  const titulo = createNode('text', { x: 0, y: 0, width: 60, height: 20 }, { name: 'Título', text: 'Título', autoResize: 'width' });
  const padrao = createNode('text', { x: 0, y: 0, width: 50, height: 20 }, { name: 'Vazio', text: 'Vazio', autoResize: 'width' });
  const slot = createNode('frame', { x: 0, y: 0, width: 200, height: 40 }, {
    name: 'Conteúdo',
    fills: [],
    layout: { direction: 'vertical', gap: 8, padding: [0, 0, 0, 0], justify: 'start', align: 'start' },
    sizing: { horizontal: 'fill', vertical: 'hug' },
    slot: { description: 'Coloque o que quiser' },
    children: [padrao],
  });
  const card = createNode('component', { x: 0, y: 0, width: 240, height: 100 }, {
    name: 'Cartão',
    layout: { direction: 'vertical', gap: 10, padding: [20, 20, 20, 20], justify: 'start', align: 'start' },
    sizing: { horizontal: 'fixed', vertical: 'hug' },
    children: [titulo, slot],
  });
  const pill = createNode('component', { x: 0, y: 300, width: 80, height: 24 }, { name: 'Selo' });
  model.measureText = measure;
  model.transact('Componentes', [
    { op: 'insert', parent: page.id, index: 0, node: card },
    { op: 'insert', parent: page.id, index: 1, node: pill },
  ]);
  const find = componentFinder(doc, () => model.index.components());
  model.measureInstance = (n) => naturalInstanceSize(n, find, measure);
  model.placeSlots = (n) => placeSlots(n, find, measure);
  model.prepare = (ops) => materializeSlots(model.index, find, ops);
  const inst = createNode('instance', { x: 400, y: 0, width: 240, height: 100 }, { componentId: card.id, name: 'Cartão' });
  model.transact('Inserir', [{ op: 'insert', parent: page.id, index: 2, node: inst }]);
  return { doc, model, page, card, slot, pill, padrao, inst: () => model.index.get(inst.id) as InstanceNode, find };
}

describe('slots', () => {
  it('sem conteúdo próprio, a instância mostra o conteúdo padrão do slot', () => {
    const { inst, find, padrao, slot } = setup();
    const r = resolveInstance(inst(), find, measure)!;
    const area = r.children[1] as ContainerNode;
    expect(area.id).toBe(slotTarget(inst().id, slot.id));
    expect(area.children.map((c) => c.id)).toEqual([`${inst().id}/${padrao.id}`]);
    expect(inst().slots).toBeUndefined();
  });

  it('inserir no slot cria o frame do slot com o padrão e a camada nova entra como camada real', () => {
    const { model, inst, slot, find } = setup();
    const texto = createNode('text', { x: 0, y: 0, width: 10, height: 20 }, { text: 'Linha extra', autoResize: 'width' });
    model.transact('Inserir', [{ op: 'insert', parent: slotTarget(inst().id, slot.id), index: 99, node: texto }]);
    const holder = inst().slots![0];
    expect(holder.slotOf).toBe(slot.id);
    expect(holder.children.map((c) => (c as TextNode).text)).toEqual(['Vazio', 'Linha extra']);
    // camada real: está no índice, com pai = frame do slot, e com a posição que o auto layout do slot dá
    expect(model.index.parentId(texto.id)).toBe(holder.id);
    expect(holder.x).toBe(20);
    expect(holder.y).toBe(50); // 20 de margem + título (20) + 10 de espaço
    expect(model.index.get(texto.id)!.y).toBe(28); // depois do "Vazio" (20) + 8
    // a instância cresce com o conteúdo do slot (abraça a altura)
    expect(inst().height).toBe(20 + 20 + 10 + 48 + 20);
    // a árvore exibida usa o conteúdo da instância, com os ids reais
    const r = resolveInstance(inst(), find, measure)!;
    const area = r.children[1] as ContainerNode;
    expect(area.children.map((c) => c.id)).toEqual(holder.children.map((c) => c.id));
  });

  it('desfazer remove o frame do slot e volta ao padrão', () => {
    const { model, inst, slot } = setup();
    const texto = createNode('text', { x: 0, y: 0, width: 10, height: 20 }, { text: 'Oi' });
    model.transact('Inserir', [{ op: 'insert', parent: slotTarget(inst().id, slot.id), index: 0, node: texto }]);
    expect(inst().slots).toHaveLength(1);
    model.undo();
    expect(inst().slots).toBeUndefined();
    expect(model.index.get(texto.id)).toBeUndefined();
    model.redo();
    expect(model.index.get(texto.id)).toBeDefined();
  });

  it('editar o componente atualiza a instância e mantém o conteúdo do slot', () => {
    const { model, inst, slot, card } = setup();
    const selo = createNode('instance', { x: 0, y: 0, width: 80, height: 24 }, { componentId: setup().pill.id });
    const texto = createNode('text', { x: 0, y: 0, width: 10, height: 20 }, { text: 'Meu' });
    model.transact('Inserir', [{ op: 'insert', parent: slotTarget(inst().id, slot.id), index: 0, node: texto }]);
    // mais espaço no topo do componente: o slot desce, e o conteúdo vai junto
    model.transact('Editar', [{ op: 'set', id: card.id, key: 'layout.padding', value: [40, 20, 20, 20] }]);
    const holder = inst().slots![0];
    expect(holder.y).toBe(70);
    expect(holder.children.some((c) => c.id === texto.id)).toBe(true);
    expect(selo.componentId).toBeTruthy();
  });

  it('mover uma camada da página para o slot e de volta', () => {
    const { model, inst, slot, page } = setup();
    const r = createNode('rect', { x: 900, y: 900, width: 30, height: 30 });
    model.transact('Criar', [{ op: 'insert', parent: page.id, index: 9, node: r }]);
    model.transact('Mover', [{ op: 'move', id: r.id, parent: slotTarget(inst().id, slot.id), index: 0 }]);
    expect(model.index.parentId(r.id)).toBe(inst().slots![0].id);
    model.transact('Mover', [{ op: 'move', id: r.id, parent: page.id, index: 0 }]);
    expect(model.index.parentId(r.id)).toBe(page.id);
    // o frame continua (o slot ficou só com o padrão copiado), como no Figma: o slot segue alterado
    expect(inst().slots).toHaveLength(1);
  });

  it('remover o frame do slot restaura o padrão', () => {
    const { model, inst, slot } = setup();
    model.transact('Inserir', [{ op: 'insert', parent: slotTarget(inst().id, slot.id), index: 0, node: createNode('rect', { x: 0, y: 0, width: 5, height: 5 }) }]);
    model.transact('Restaurar', [{ op: 'remove', id: inst().slots![0].id }]);
    expect(inst().slots).toBeUndefined();
  });

  it('slot limpo (sem padrão) fica vazio e encolhe', () => {
    const { model, inst, slot } = setup();
    const holder = { id: 'h1', type: 'frame' as const, name: 'Conteúdo', slotOf: slot.id, x: 0, y: 0, width: 200, height: 40, children: [] };
    model.transact('Limpar', [{ op: 'insert', parent: inst().id, index: 0, node: holder }]);
    expect(inst().height).toBe(20 + 20 + 10 + 0 + 20);
  });

  it('o arquivo guarda o conteúdo dos slots e abre igual', () => {
    const { model, inst, slot, doc } = setup();
    model.transact('Inserir', [{ op: 'insert', parent: slotTarget(inst().id, slot.id), index: 0, node: createNode('rect', { x: 0, y: 0, width: 5, height: 5 }) }]);
    const again = parse(serialize(doc));
    const m2 = new Model(again);
    const i2 = m2.index.get(inst().id) as InstanceNode;
    expect(i2.slots![0].children).toHaveLength(2);
    expect(m2.index.parentId(i2.slots![0].children[0].id)).toBe(i2.slots![0].id);
  });

  it('desanexar leva o conteúdo do slot e dá ids novos', () => {
    const { model, inst, slot, find } = setup();
    const r = createNode('rect', { x: 0, y: 0, width: 5, height: 5 });
    model.transact('Inserir', [{ op: 'insert', parent: slotTarget(inst().id, slot.id), index: 0, node: r }]);
    const frame = detachInstance(inst(), find, measure)!;
    const area = frame.children[1] as ContainerNode;
    expect(area.children).toHaveLength(2);
    expect(area.children.some((c) => c.id === r.id)).toBe(false);
    expect(area.slot).toBeUndefined();
  });

  it('duplicar a instância duplica o conteúdo com ids novos', () => {
    const { model, inst, slot } = setup();
    model.transact('Inserir', [{ op: 'insert', parent: slotTarget(inst().id, slot.id), index: 0, node: createNode('rect', { x: 0, y: 0, width: 5, height: 5 }) }]);
    const copy = reidentify(inst());
    expect(copy.slots![0].id).not.toBe(inst().slots![0].id);
    expect(copy.slots![0].children[0].id).not.toBe(inst().slots![0].children[0].id);
    expect(copy.slots![0].slotOf).toBe(slot.id);
  });

  it('trocar de variante leva o conteúdo para o slot de mesmo nome', () => {
    const a = createNode('component', { x: 0, y: 0, width: 100, height: 100 }, { children: [createNode('frame', { x: 0, y: 0, width: 50, height: 50 }, { name: 'Conteúdo', slot: {} })] });
    const b = createNode('component', { x: 0, y: 0, width: 100, height: 100 }, { children: [createNode('frame', { x: 10, y: 10, width: 50, height: 50 }, { name: 'Conteúdo', slot: {} })] });
    const holder = createNode('frame', { x: 0, y: 0, width: 50, height: 50 }, { slotOf: a.children[0].id });
    const [m] = remapSlots([holder], a, b);
    expect(m.slotOf).toBe(b.children[0].id);
  });

  it('as instâncias são independentes', () => {
    const { model, inst, slot, page, card } = setup();
    const outra = createNode('instance', { x: 800, y: 0, width: 240, height: 100 }, { componentId: card.id });
    model.transact('Inserir', [{ op: 'insert', parent: page.id, index: 3, node: outra }]);
    model.transact('Inserir', [{ op: 'insert', parent: slotTarget(inst().id, slot.id), index: 0, node: createNode('rect', { x: 0, y: 0, width: 5, height: 5 }) }]);
    expect((model.index.get(outra.id) as InstanceNode).slots).toBeUndefined();
  });
});

describe('slots vindos do .pen', () => {
  it('frame com "slot" vira slot com sugeridos, e o conteúdo da ref fica na instância (sem desanexar)', () => {
    const lib = {
      version: '2.17',
      children: [
        { type: 'frame', id: 'btn', name: 'Botão', reusable: true, width: 80, height: 32 },
        {
          type: 'frame', id: 'card', name: 'Cartão', reusable: true, width: 200, height: 100, layout: 'vertical',
          children: [{ type: 'frame', id: 'corpo', name: 'Corpo', width: 'fill_container', height: 'fit_content', layout: 'vertical', slot: ['btn'] }],
        },
      ],
    };
    const main = {
      version: '2.17',
      imports: { L: 'lib.pen' },
      children: [
        { type: 'ref', id: 'c1', ref: 'L:card', descendants: { 'L:corpo': { children: [{ type: 'text', id: 't1', content: 'Oi' }, { type: 'ref', id: 'b1', ref: 'L:btn' }] } } },
      ],
    };
    const { doc } = penToDocument({ text: JSON.stringify(main), imports: { L: { name: 'lib', text: JSON.stringify(lib) } } }, 'Teste');
    const inst = doc.pages[0].children[0] as InstanceNode;
    expect(inst.type).toBe('instance');
    expect(inst.slots).toHaveLength(1);
    expect(inst.slots![0].slotOf).toBe('L:corpo');
    expect(inst.slots![0].children.map((c) => c.type)).toEqual(['text', 'instance']);
    const corpo = (doc.pages[1].children.find((n) => n.name === 'Cartão') as ContainerNode).children[0] as ContainerNode;
    expect(corpo.slot).toEqual({ preferred: [{ componentId: 'L:btn' }] });
    // o arquivo abre com o índice certo (conteúdo do slot como camada real)
    const m = new Model(parse(serialize(doc)));
    expect(m.index.parentId(inst.slots![0].children[0].id)).toBe(inst.slots![0].id);
  });
});
