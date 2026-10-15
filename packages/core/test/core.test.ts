import { describe, expect, it } from 'vitest';
import {
  Model,
  createDocument,
  createNode,
  serialize,
  parse,
  FileFormatError,
  resolveInstance,
  componentFinder,
  buildLibrary,
  exportSvg,
  normalizeHex,
  parseHex,
  toHex,
  invert,
  multiply,
  nodeMatrix,
  apply,
  reidentify,
  type ContainerNode,
  type TextNode,
  type InstanceNode,
} from '@zaliel/core';

const measure = (n: TextNode, max: number) => {
  const w = n.text.length * n.style.size * 0.5;
  if (max === Infinity || w <= max) return { width: w, height: n.style.size * 1.25 };
  return { width: max, height: Math.ceil(w / max) * n.style.size * 1.25 };
};

function setup() {
  const doc = createDocument('Teste');
  const model = new Model(doc);
  model.measureText = measure;
  const page = doc.pages[0];
  return { doc, model, page };
}

describe('operações e histórico', () => {
  it('insere, altera, desfaz e refaz', () => {
    const { model, page } = setup();
    const rect = createNode('rect', { x: 10, y: 10, width: 100, height: 50 });
    model.transact('Inserir', [{ op: 'insert', parent: page.id, index: 0, node: rect }]);
    expect(page.children).toHaveLength(1);
    model.transact('Mover', [{ op: 'set', id: rect.id, key: 'x', value: 40 }]);
    expect(model.index.get(rect.id)!.x).toBe(40);
    model.undo();
    expect(model.index.get(rect.id)!.x).toBe(10);
    model.undo();
    expect(page.children).toHaveLength(0);
    expect(model.index.get(rect.id)).toBeUndefined();
    model.redo();
    model.redo();
    expect(model.index.get(rect.id)!.x).toBe(40);
  });

  it('sabe quando há alterações não salvas, inclusive ao desfazer até o ponto salvo', () => {
    const { model, page } = setup();
    expect(model.dirty).toBe(false);
    const r = createNode('rect', { x: 0, y: 0, width: 10, height: 10 });
    model.transact('Inserir', [{ op: 'insert', parent: page.id, index: 0, node: r }]);
    expect(model.dirty).toBe(true);
    model.markSaved();
    expect(model.dirty).toBe(false);
    model.transact('Mover', [{ op: 'set', id: r.id, key: 'x', value: 5 }], { merge: 'm' });
    expect(model.dirty).toBe(true);
    model.undo();
    expect(model.dirty).toBe(false);
    model.markDirty();
    expect(model.dirty).toBe(true);
  });

  it('altera caminhos aninhados (style.size)', () => {
    const { model, page } = setup();
    const t = createNode('text', { x: 0, y: 0, width: 10, height: 10 });
    model.transact('Inserir', [{ op: 'insert', parent: page.id, index: 0, node: t }]);
    model.transact('Tamanho', [{ op: 'set', id: t.id, key: 'style.size', value: 32 }]);
    expect((model.index.get(t.id) as TextNode).style.size).toBe(32);
    model.undo();
    expect((model.index.get(t.id) as TextNode).style.size).toBe(16);
  });

  it('junta passos com a mesma chave de merge', () => {
    const { model, page } = setup();
    const r = createNode('rect', { x: 0, y: 0, width: 10, height: 10 });
    model.transact('Inserir', [{ op: 'insert', parent: page.id, index: 0, node: r }]);
    for (let i = 1; i <= 5; i++) model.transact('Arrastar', [{ op: 'set', id: r.id, key: 'x', value: i * 10 }], { merge: 'drag' });
    expect(model.past).toHaveLength(2);
    model.undo();
    expect(model.index.get(r.id)!.x).toBe(0);
  });

  it('não deixa mover um nó para dentro de si mesmo', () => {
    const { model, page } = setup();
    const f = createNode('frame', { x: 0, y: 0, width: 100, height: 100 });
    const inner = createNode('frame', { x: 0, y: 0, width: 50, height: 50 });
    f.children.push(inner);
    model.transact('Inserir', [{ op: 'insert', parent: page.id, index: 0, node: f }]);
    expect(() => model.transact('Mover', [{ op: 'move', id: f.id, parent: inner.id, index: 0 }])).toThrow();
    expect(page.children[0].id).toBe(f.id);
  });

  it('desfaz tudo se uma operação do lote falhar', () => {
    const { model, page } = setup();
    const r = createNode('rect', { x: 0, y: 0, width: 10, height: 10 });
    expect(() =>
      model.transact('Lote', [
        { op: 'insert', parent: page.id, index: 0, node: r },
        { op: 'set', id: 'nao-existe', key: 'x', value: 1 },
      ]),
    ).toThrow();
    expect(page.children).toHaveLength(0);
    expect(model.index.get(r.id)).toBeUndefined();
  });
});

describe('auto layout', () => {
  function stack(direction: 'horizontal' | 'vertical') {
    const { model, page } = setup();
    const f = createNode('frame', { x: 0, y: 0, width: 300, height: 100 }, {
      layout: { direction, gap: 10, padding: [8, 12, 8, 12], justify: 'start', align: 'start' },
      sizing: { horizontal: 'hug', vertical: 'hug' },
    });
    const a = createNode('rect', { x: 0, y: 0, width: 40, height: 20 });
    const b = createNode('rect', { x: 0, y: 0, width: 60, height: 30 });
    f.children.push(a, b);
    model.transact('Inserir', [{ op: 'insert', parent: page.id, index: 0, node: f }]);
    return { model, f: model.index.get(f.id) as ContainerNode, a: model.index.get(a.id)!, b: model.index.get(b.id)! };
  }

  it('hug horizontal soma filhos, gap e padding', () => {
    const { f, a, b } = stack('horizontal');
    expect(f.width).toBe(12 + 40 + 10 + 60 + 12);
    expect(f.height).toBe(8 + 30 + 8);
    expect([a.x, a.y, b.x, b.y]).toEqual([12, 8, 62, 8]);
  });

  it('hug vertical empilha', () => {
    const { f, b } = stack('vertical');
    expect(f.height).toBe(8 + 20 + 10 + 30 + 8);
    expect(b.y).toBe(8 + 20 + 10);
  });

  it('fill divide o espaço livre e o layout é desfeito junto', () => {
    const { model, f, a, b } = stack('horizontal');
    model.transact('Fixar', [{ op: 'set', id: f.id, key: 'sizing', value: { horizontal: 'fixed', vertical: 'hug' } }, { op: 'set', id: f.id, key: 'width', value: 400 }]);
    model.transact('Fill', [{ op: 'set', id: a.id, key: 'sizing', value: { horizontal: 'fill', vertical: 'fixed' } }]);
    expect(a.width).toBe(400 - 24 - 10 - 60);
    model.undo();
    expect(a.width).toBe(40);
    expect(b.x).toBe(62);
  });

  it('centraliza e usa space-between', () => {
    const { model, f, a, b } = stack('horizontal');
    model.transact('Fixar', [
      { op: 'set', id: f.id, key: 'sizing', value: { horizontal: 'fixed', vertical: 'fixed' } },
      { op: 'set', id: f.id, key: 'width', value: 300 },
      { op: 'set', id: f.id, key: 'height', value: 100 },
      { op: 'set', id: f.id, key: 'layout.justify', value: 'space-between' },
      { op: 'set', id: f.id, key: 'layout.align', value: 'center' },
    ]);
    expect(a.x).toBe(12);
    expect(b.x + b.width).toBe(300 - 12);
    expect(a.y).toBe(8 + (84 - 20) / 2);
  });

  it('mede textos com largura automática', () => {
    const { model, page } = setup();
    const t = createNode('text', { x: 0, y: 0, width: 1, height: 1 }, { text: 'Olá mundo' });
    model.transact('Texto', [{ op: 'insert', parent: page.id, index: 0, node: t }]);
    const n = model.index.get(t.id)!;
    expect(n.width).toBe(9 * 8);
    expect(n.height).toBe(20);
  });

  it('grupo envolve os filhos', () => {
    const { model, page } = setup();
    const g = createNode('group', { x: 0, y: 0, width: 0, height: 0 });
    g.children.push(createNode('rect', { x: 20, y: 30, width: 10, height: 10 }), createNode('rect', { x: 50, y: 40, width: 10, height: 20 }));
    model.transact('Agrupar', [{ op: 'insert', parent: page.id, index: 0, node: g }]);
    const n = model.index.get(g.id) as ContainerNode;
    expect([n.x, n.y, n.width, n.height]).toEqual([20, 30, 40, 30]);
    expect([n.children[0].x, n.children[0].y]).toEqual([0, 0]);
  });
});

describe('arquivo .zal', () => {
  it('ida e volta mantém o documento', () => {
    const { doc, model, page } = setup();
    model.transact('Inserir', [{ op: 'insert', parent: page.id, index: 0, node: createNode('ellipse', { x: 1, y: 2, width: 3, height: 4 }) }]);
    const text = serialize(doc);
    expect(text.startsWith('{\n  "format": "zaliel"')).toBe(true);
    expect(text.indexOf('"assets"')).toBeGreaterThan(text.indexOf('"pages"'));
    expect(parse(text)).toEqual(JSON.parse(text));
  });

  it('erros humanos para arquivos inválidos', () => {
    expect(() => parse('{oops')).toThrow(FileFormatError);
    expect(() => parse('{"format":"outro"}')).toThrow(/não é um documento do Zaliel/);
    expect(() => parse(JSON.stringify({ ...createDocument(), version: 999 }))).toThrow(/versão mais nova/);
    const bad = createDocument();
    (bad.pages[0] as unknown as { background: string }).background = 'azul';
    expect(() => parse(JSON.stringify(bad))).toThrow(/danificado/);
  });

  it('recusa ids repetidos', () => {
    const d = createDocument();
    const r = createNode('rect', { x: 0, y: 0, width: 1, height: 1 });
    d.pages[0].children.push(r, { ...r });
    expect(() => parse(JSON.stringify(d))).toThrow(/ids repetidos/);
  });

  it('aceita BOM do Bloco de Notas', () => {
    expect(parse('\uFEFF' + serialize(createDocument())).format).toBe('zaliel');
  });
});

describe('componentes e bibliotecas', () => {
  function withComponent() {
    const { doc, model, page } = setup();
    const comp = createNode('component', { x: 0, y: 0, width: 120, height: 40 }, {
      name: 'Botão',
      layout: { direction: 'horizontal', gap: 0, padding: [10, 16, 10, 16], justify: 'center', align: 'center' },
      sizing: { horizontal: 'fixed', vertical: 'fixed' },
    });
    const label = createNode('text', { x: 0, y: 0, width: 1, height: 1 }, { text: 'Enviar', name: 'Rótulo' });
    comp.children.push(label);
    model.transact('Componente', [{ op: 'insert', parent: page.id, index: 0, node: comp }]);
    const inst = createNode('instance', { x: 200, y: 0, width: 200, height: 40 }, { componentId: comp.id, overrides: { [label.id]: { text: 'Comprar agora' } } });
    model.transact('Instância', [{ op: 'insert', parent: page.id, index: 1, node: inst }]);
    return { doc, model, comp, label, inst: model.index.get(inst.id) as InstanceNode };
  }

  it('resolve a instância com override e layout no tamanho dela', () => {
    const { doc, model, label, inst } = withComponent();
    const find = componentFinder(doc, () => model.index.components());
    const r = resolveInstance(inst, find, measure)!;
    expect(r.width).toBe(200);
    const t = r.children[0] as TextNode;
    expect(t.id).toBe(`${inst.id}/${label.id}`);
    expect(t.text).toBe('Comprar agora');
    expect(t.x).toBe((200 - t.width) / 2);
  });

  it('mudanças no componente aparecem na instância', () => {
    const { doc, model, comp, inst } = withComponent();
    model.transact('Cor', [{ op: 'set', id: comp.id, key: 'fills', value: [{ type: 'solid', color: '#ff0000' }] }]);
    const r = resolveInstance(inst, componentFinder(doc, () => model.index.components()))!;
    expect(r.fills).toEqual([{ type: 'solid', color: '#ff0000' }]);
  });

  it('gera biblioteca com hash que muda quando o componente muda', () => {
    const { doc, model, comp } = withComponent();
    const a = buildLibrary(doc, 'C:/lib.zal');
    expect(a.components.map((c) => c.name)).toEqual(['Botão']);
    model.transact('Raio', [{ op: 'set', id: comp.id, key: 'cornerRadius', value: 8 }]);
    expect(buildLibrary(doc, 'C:/lib.zal').hash).not.toBe(a.hash);
  });

  it('instância de componente que não existe não quebra', () => {
    const { doc, model } = withComponent();
    const ghost = createNode('instance', { x: 0, y: 0, width: 10, height: 10 }, { componentId: 'sumiu' });
    expect(resolveInstance(ghost, componentFinder(doc, () => model.index.components()))).toBeNull();
  });
});

describe('utilitários', () => {
  it('cores', () => {
    expect(normalizeHex('fff')).toBe('#ffffff');
    expect(normalizeHex('#FF000080')).toBe('#ff000080');
    expect(normalizeHex('xyz')).toBeNull();
    expect(toHex(parseHex('#12345678'))).toBe('#12345678');
  });

  it('matrizes: inversa e rotação em torno do centro', () => {
    const m = nodeMatrix({ x: 10, y: 20, width: 100, height: 50, rotation: 90 });
    const id = multiply(m, invert(m));
    expect(id.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0, 1, 0, 0]);
    const c = apply(m, { x: 50, y: 25 });
    expect([Math.round(c.x), Math.round(c.y)]).toEqual([60, 45]);
  });

  it('reidentify troca todos os ids', () => {
    const f = createNode('frame', { x: 0, y: 0, width: 1, height: 1 });
    f.children.push(createNode('rect', { x: 0, y: 0, width: 1, height: 1 }));
    const map = new Map<string, string>();
    const c = reidentify(f, map);
    expect(c.id).not.toBe(f.id);
    expect(c.children[0].id).not.toBe(f.children[0].id);
    expect(map.size).toBe(2);
  });

  it('exporta SVG', () => {
    const doc = createDocument();
    const f = createNode('frame', { x: 0, y: 0, width: 100, height: 50 }, { cornerRadius: 8 });
    f.children.push(createNode('text', { x: 10, y: 10, width: 50, height: 20 }, { text: 'A & B' }));
    const svg = exportSvg(doc, f);
    expect(svg).toContain('viewBox="0 0 100 50"');
    expect(svg).toContain('A &amp; B');
    expect(svg).toContain('rx="8"');
  });
});
