import { describe, expect, it } from 'vitest';
import {
  Model,
  createDocument,
  createNode,
  serialize,
  parse,
  resolveInstance,
  componentFinder,
  buildLibrary,
  publishedComponents,
  variantAxes,
  findVariant,
  variantName,
  remapOverrides,
  propertyValues,
  stylePatch,
  propagateStyle,
  releaseStyle,
  styleUsage,
  textStyleOf,
  parsePath,
  serializePath,
  refitPath,
  scalePath,
  pathBounds,
  splitSegment,
  toggleSmooth,
  deletePoints,
  cubicAt,
  segmentPoints,
  nearestOnSegment,
  gridBands,
  gridLines,
  gridSnapEdges,
  defaultGrid,
  hotspots,
  prototypeLinks,
  startScreen,
  screenOf,
  buildPdf,
  splitRgba,
  deflate,
  nodeMatrix,
  apply,
  walk,
  type ContainerNode,
  type InstanceNode,
  type TextNode,
  type Style,
  type ZalDocument,
  type SceneNode,
} from '@zaliel/core';

function setup() {
  const doc = createDocument('Teste');
  const model = new Model(doc);
  return { doc, model, page: doc.pages[0] };
}

/** Botão com um texto e um ícone (instância de outro componente). */
function buttonSet() {
  const icon = createNode('component', { x: 0, y: 0, width: 16, height: 16 }, { name: 'Ícone A' });
  const icon2 = createNode('component', { x: 40, y: 0, width: 16, height: 16 }, { name: 'Ícone B' });
  const mk = (estado: string, x: number) => {
    const label = createNode('text', { x: 8, y: 8, width: 60, height: 20 }, { name: 'Rótulo', text: 'Enviar', propRefs: { text: 'p-label' } });
    const ico = createNode('instance', { x: 70, y: 8, width: 16, height: 16 }, { componentId: icon.id, name: 'Ícone', propRefs: { visible: 'p-icon', component: 'p-swap' } });
    return createNode('component', { x, y: 0, width: 100, height: 36 }, { name: variantName({ Estado: estado }), variant: { Estado: estado }, children: [label, ico] });
  };
  const padrao = mk('Padrão', 0);
  const hover = mk('Hover', 120);
  const set = createNode('component-set', { x: 0, y: 100, width: 240, height: 60 }, {
    name: 'Botão',
    children: [padrao, hover],
    properties: [
      { id: 'p-label', name: 'Rótulo', type: 'text', default: 'Enviar' },
      { id: 'p-icon', name: 'Mostrar ícone', type: 'boolean', default: true },
      { id: 'p-swap', name: 'Ícone', type: 'swap', default: icon.id },
    ],
  });
  return { icon, icon2, set, padrao, hover };
}

function finderFor(doc: ZalDocument) {
  const all = () => {
    const out: ContainerNode[] = [];
    for (const p of doc.pages) walk(p.children, (n) => void (n.type === 'component' && out.push(n)));
    return out;
  };
  const setOf = (id: string) => {
    let found: ContainerNode | undefined;
    for (const p of doc.pages) walk(p.children, (n) => {
      if (n.type === 'component-set' && n.children.some((c) => c.id === id)) found = n;
    });
    return found;
  };
  return componentFinder(doc, all, setOf);
}

describe('variantes e propriedades de componente', () => {
  it('lista os eixos e acha a variante pelos valores', () => {
    const { set, hover } = buttonSet();
    expect(variantAxes(set)).toEqual([{ name: 'Estado', values: ['Padrão', 'Hover'] }]);
    expect(findVariant(set, { Estado: 'Hover' })?.id).toBe(hover.id);
    expect(findVariant(set, { Estado: 'Não existe' }, 'Estado')).toBeUndefined();
    expect(variantName({ Estado: 'Hover', Tamanho: 'G' })).toBe('Estado=Hover, Tamanho=G');
  });

  it('aplica propriedades booleana, de texto e de troca de instância', () => {
    const { doc, page } = setup();
    const { icon, icon2, set, padrao } = buttonSet();
    page.children.push(icon, icon2, set);
    const find = finderFor(doc);
    expect(find.setOf?.(padrao.id)?.id).toBe(set.id);
    const inst = createNode('instance', { x: 0, y: 0, width: 100, height: 36 }, { componentId: padrao.id });
    const label = (r: ContainerNode) => r.children.find((c) => c.name === 'Rótulo') as TextNode;
    const ico = (r: ContainerNode) => r.children.find((c) => c.name === 'Ícone')!;

    let r = resolveInstance(inst, find)!;
    expect(label(r).text).toBe('Enviar');
    expect(ico(r).visible).not.toBe(false);
    expect(ico(r).name).toBe('Ícone');

    inst.props = { 'p-label': 'Comprar', 'p-icon': false, 'p-swap': icon2.id };
    r = resolveInstance(inst, find)!;
    expect(label(r).text).toBe('Comprar');
    expect(ico(r).visible).toBe(false);
    // a instância aninhada foi resolvida com o componente trocado
    expect(propertyValues(set.properties!, inst)['p-swap']).toBe(icon2.id);
    // override de texto continua valendo por cima da propriedade
    inst.overrides = { [label(padrao).id]: { text: 'Override' } };
    expect(label(resolveInstance(inst, find)!).text).toBe('Override');
  });

  it('troca de variante leva os overrides pelo nome das camadas', () => {
    const { padrao, hover } = buttonSet();
    const from = padrao.children[0].id, to = hover.children[0].id;
    expect(remapOverrides({ [from]: { text: 'Oi' } }, padrao, hover)).toEqual({ [to]: { text: 'Oi' } });
    expect(remapOverrides({ inexistente: { text: 'x' } }, padrao, hover)).toBeUndefined();
  });

  it('bibliotecas publicam o conjunto com as variantes dentro', () => {
    const { doc, page } = setup();
    const { icon, icon2, set, hover } = buttonSet();
    page.children.push(icon, icon2, set);
    const pub = publishedComponents(doc);
    expect(pub.map((c) => c.name)).toEqual(['Ícone A', 'Ícone B', 'Botão']);
    const lib = buildLibrary(doc, 'C:/lib.zal');
    const other = createDocument('Outro');
    other.libraries.push(lib);
    const find = componentFinder(other, () => []);
    expect(find(hover.id, lib.id)?.id).toBe(hover.id);
    expect(find.setOf?.(hover.id, lib.id)?.id).toBe(set.id);
    const inst = createNode('instance', { x: 0, y: 0, width: 100, height: 36 }, { componentId: hover.id, library: lib.id, props: { 'p-label': 'Da biblioteca' } });
    expect((resolveInstance(inst, find)!.children[0] as TextNode).text).toBe('Da biblioteca');
  });

  it('os novos tipos passam pela leitura do arquivo', () => {
    const { doc, page } = setup();
    const { icon, icon2, set } = buttonSet();
    const bool = createNode('boolean', { x: 0, y: 0, width: 10, height: 10 }, { booleanOp: 'subtract', children: [createNode('rect', { x: 0, y: 0, width: 10, height: 10 })] });
    page.children.push(icon, icon2, set, bool);
    const back = parse(serialize(doc));
    expect(back.pages[0].children.map((n) => n.type)).toEqual(['component', 'component', 'component-set', 'boolean']);
    expect((back.pages[0].children[3] as ContainerNode).booleanOp).toBe('subtract');
  });
});

describe('operação booleana (estrutura)', () => {
  it('a caixa da booleana envolve os filhos, como num grupo', () => {
    const { model, page } = setup();
    const a = createNode('rect', { x: 10, y: 10, width: 50, height: 50 });
    const b = createNode('ellipse', { x: 40, y: 30, width: 50, height: 50 });
    const bool = createNode('boolean', { x: 100, y: 100, width: 1, height: 1 }, { children: [a, b] });
    model.transact('Inserir', [{ op: 'insert', parent: page.id, index: 0, node: bool }]);
    const n = model.index.get(bool.id)!;
    expect([n.x, n.y, n.width, n.height]).toEqual([110, 110, 80, 70]);
    expect(model.index.get(a.id)!.x).toBe(0);
  });
});

describe('estilos', () => {
  const color: Style = { id: 's1', name: 'Marca/Primária', type: 'color', paints: [{ type: 'solid', color: '#b5822f' }] };
  const text: Style = { id: 's2', name: 'Título', type: 'text', text: { family: 'Inter', weight: 700, size: 32, lineHeight: 40 } };
  const fx: Style = { id: 's3', name: 'Sombra', type: 'effect', effects: [{ type: 'drop-shadow', color: '#00000040', x: 0, y: 2, blur: 8 }] };

  it('aplica estilo de cor, texto e efeito', () => {
    const r = createNode('rect', { x: 0, y: 0, width: 10, height: 10 });
    expect(stylePatch(r, color, 'fill')).toEqual({ fills: color.paints, styles: { fill: 's1' } });
    const s = stylePatch(r, color, 'stroke')!;
    expect((s.strokes as { paint: unknown; width: number }[])[0]).toMatchObject({ paint: color.paints[0], width: 1 });
    const t = createNode('text', { x: 0, y: 0, width: 10, height: 10 }, { style: { family: 'Inter', weight: 400, size: 16, align: 'center' } });
    const tp = stylePatch(t, text, 'text')!;
    expect(tp.style).toMatchObject({ weight: 700, size: 32, align: 'center' });
    expect(stylePatch(r, text, 'text')).toBeNull();
    expect(stylePatch(r, fx, 'effect')).toEqual({ effects: fx.effects, styles: { effect: 's3' } });
    expect(textStyleOf({ family: 'Inter', weight: 400, size: 12, align: 'right', verticalAlign: 'middle' })).toEqual({ family: 'Inter', weight: 400, size: 12 });
  });

  it('editar o estilo reescreve os nós ligados, com desfazer', () => {
    const { doc, model, page } = setup();
    const r = createNode('rect', { x: 0, y: 0, width: 10, height: 10 }, { fills: color.paints, styles: { fill: 's1' } });
    const other = createNode('rect', { x: 0, y: 0, width: 10, height: 10 });
    model.transact('Inserir', [
      { op: 'insert', parent: page.id, index: 0, node: r },
      { op: 'insert', parent: page.id, index: 1, node: other },
      { op: 'doc', key: 'styles', value: [color] },
    ]);
    expect(styleUsage(doc, 's1')).toBe(1);
    const edited: Style = { ...color, paints: [{ type: 'solid', color: '#123456' }] };
    model.transact('Editar estilo', [{ op: 'doc', key: 'styles', value: [edited] }, ...propagateStyle(doc, edited)]);
    expect(model.index.get(r.id)!.fills).toEqual(edited.paints);
    expect(model.index.get(other.id)!.fills).not.toEqual(edited.paints);
    model.undo();
    expect(model.index.get(r.id)!.fills).toEqual(color.paints);
    expect(doc.styles![0]).toEqual(color);
    model.transact('Excluir estilo', [{ op: 'doc', key: 'styles', value: [] }, ...releaseStyle(doc, 's1')]);
    expect(model.index.get(r.id)!.styles?.fill).toBeUndefined();
    expect(model.index.get(r.id)!.fills).toEqual(color.paints);
  });

  it('estilos são gravados no arquivo e vão para as bibliotecas', () => {
    const { doc } = setup();
    doc.styles = [color, text];
    const back = parse(serialize(doc));
    expect(back.styles).toEqual([color, text]);
    expect(buildLibrary(doc, 'x.zal').styles).toEqual([color, text]);
    expect(() => parse(serialize({ ...doc, styles: [{ id: '', name: 'x', type: 'color' } as unknown as Style] }))).toThrow();
  });
});

describe('vetores', () => {
  it('lê e grava caminhos com retas e curvas', () => {
    const d = 'M0 0 L10 0 C15 0 20 5 20 10 L0 10 Z';
    const s = parsePath(d);
    expect(s).toHaveLength(1);
    expect(s[0].closed).toBe(true);
    expect(s[0].points).toHaveLength(4);
    expect(s[0].points[1].out).toEqual({ x: 15, y: 0 });
    expect(s[0].points[2].in).toEqual({ x: 20, y: 5 });
    expect(serializePath(s)).toBe('M0 0 L10 0 C15 0 20 5 20 10 L0 10 Z');
  });

  it('entende comandos relativos, H/V, quadráticas, arcos e vários subcaminhos', () => {
    const s = parsePath('m10 10 h10 v10 h-10 z M30 30 q10 -10 20 0 t20 0 M0 50 A10 10 0 0 1 20 50');
    expect(s).toHaveLength(3);
    expect(s[0].points.map((p) => [p.x, p.y])).toEqual([[10, 10], [20, 10], [20, 20], [10, 20]]);
    expect(s[1].points[2]).toMatchObject({ x: 70, y: 30 });
    const arc = s[2].points;
    expect(arc[arc.length - 1]).toMatchObject({ x: 20, y: 50 });
    // meio círculo de raio 10 passa por y = 40
    expect(Math.min(...arc.flatMap((p) => [p.y, p.in?.y ?? 99, p.out?.y ?? 99]))).toBeLessThan(42);
    // caminho cortado no meio não trava
    expect(parsePath('M0 0 L10')).toHaveLength(1);
    // o formato que o Skia gera (toSVGString)
    expect(parsePath('M10 0L0 0L0 10L5 10L5 15L15 15L15 5L10 5L10 0Z')[0].points).toHaveLength(8);
  });

  it('reenquadra depois de editar e mantém o desenho no lugar, mesmo girado', () => {
    const node = { x: 100, y: 50, width: 20, height: 10, rotation: 30 };
    const s = parsePath('M0 0 L20 0 L20 10 L0 10 Z');
    const before = apply(nodeMatrix(node), { x: 20, y: 10 });
    s[0].points[2] = { x: 30, y: 15 }; // arrasta um canto para fora da caixa
    const fit = refitPath(node, s);
    expect([fit.width, fit.height]).toEqual([30, 15]);
    const after = parsePath(fit.d);
    expect(pathBounds(after)).toEqual({ x: 0, y: 0, width: 30, height: 15 });
    // um ponto que não mexeu continua no mesmo lugar da página
    const fixed = apply(nodeMatrix({ ...node, ...fit }), after[0].points[0]);
    const orig = apply(nodeMatrix(node), { x: 0, y: 0 });
    expect(fixed.x).toBeCloseTo(orig.x, 1);
    expect(fixed.y).toBeCloseTo(orig.y, 1);
    expect(before).toBeTruthy();
  });

  it('escala o caminho ao redimensionar', () => {
    expect(scalePath('M0 0 L10 0 C10 5 5 10 0 10 Z', 2, 3)).toBe('M0 0 L20 0 C20 15 10 30 0 30 Z');
  });
});

describe('grades de layout', () => {
  it('colunas esticadas com margem e espaçamento', () => {
    const g = { ...defaultGrid('columns'), count: 4, gutter: 20, margin: 10 };
    const b = gridBands(g, 440, 300);
    expect(b.map((r) => [r.x, r.width])).toEqual([[10, 90], [120, 90], [230, 90], [340, 90]]);
    expect(b[0].height).toBe(300);
  });

  it('linhas centralizadas com tamanho fixo e grade quadrada', () => {
    const rows = gridBands({ type: 'rows', count: 2, size: 50, gutter: 10, margin: 0, alignment: 'center', color: '#000' }, 100, 210);
    expect(rows.map((r) => r.y)).toEqual([50, 110]);
    expect(gridLines({ ...defaultGrid('grid'), size: 10 }, 35, 20)).toEqual({ xs: [10, 20, 30], ys: [10] });
    const edges = gridSnapEdges([{ ...defaultGrid('columns'), count: 2, gutter: 0, margin: 0 }, { ...defaultGrid('rows'), visible: false }], 100, 100);
    expect(edges).toEqual({ xs: [0, 50, 50, 100], ys: [] });
  });
});

describe('protótipo', () => {
  it('acha ligações, áreas clicáveis e a tela inicial', () => {
    const { page } = setup();
    const a = createNode('frame', { x: 0, y: 0, width: 300, height: 600 }, { name: 'Início' });
    const b = createNode('frame', { x: 400, y: 0, width: 300, height: 600 }, { name: 'Detalhe' });
    const btn = createNode('rect', { x: 20, y: 500, width: 100, height: 40 }, { interactions: [{ trigger: 'click', action: 'navigate', target: b.id, transition: 'slide-left', duration: 300 }] });
    const back = createNode('rect', { x: 10, y: 10, width: 30, height: 30 }, { interactions: [{ trigger: 'click', action: 'back' }] });
    a.children.push(btn);
    b.children.push(back);
    page.children.push(a, b);
    expect(startScreen(page)?.id).toBe(a.id);
    page.flowStart = b.id;
    expect(startScreen(page)?.id).toBe(b.id);
    expect(prototypeLinks(page)).toEqual([{ from: btn.id, to: b.id, interaction: btn.interactions![0] }]);
    const hs = hotspots(a);
    expect(hs).toHaveLength(1);
    expect(hs[0].rect).toEqual({ x: 20, y: 500, width: 100, height: 40 });
    const parents = new Map<string, string>([[btn.id, a.id], [a.id, page.id]]);
    expect(screenOf(page, btn.id, (id) => parents.get(id))?.id).toBe(a.id);
  });

  it('as interações vão e voltam do arquivo', () => {
    const { doc, page } = setup();
    const n = createNode('rect', { x: 0, y: 0, width: 1, height: 1 }, { interactions: [{ trigger: 'click', action: 'back' }] }) as SceneNode;
    page.children.push(n);
    page.flowStart = n.id;
    const back = parse(serialize(doc));
    expect(back.pages[0].children[0].interactions).toEqual([{ trigger: 'click', action: 'back' }]);
    expect(back.pages[0].flowStart).toBe(n.id);
  });
});

describe('PDF', () => {
  it('monta um PDF válido com uma página por imagem', async () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]);
    const split = splitRgba(rgba, 2, 1);
    expect(Array.from(split.rgb)).toEqual([255, 0, 0, 0, 255, 0]);
    expect(Array.from(split.alpha!)).toEqual([255, 128]);
    expect(splitRgba(new Uint8Array([1, 2, 3, 255]), 1, 1).alpha).toBeUndefined();
    const rgb = await deflate(split.rgb);
    expect(rgb[0]).toBe(0x78); // cabeçalho zlib
    const pdf = buildPdf(
      [
        { width: 200, height: 100, image: { width: 2, height: 1, rgb, alpha: await deflate(split.alpha!), deflated: true } },
        { width: 50.5, height: 50, image: { width: 1, height: 1, rgb: new Uint8Array([0, 0, 0]) } },
      ],
      { title: 'Tela (1) — ação', producer: 'Zaliel' },
    );
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/MediaBox [0 0 200 100]');
    expect(text).toContain('/MediaBox [0 0 50.5 50]');
    expect(text).toContain('/SMask');
    expect(text).toContain('/Title (Tela \\(1\\) ? a\\347\\343o)');
    // a tabela xref aponta exatamente para o início de cada objeto
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const entries = text.slice(start).split('\n').slice(3).filter((l) => / n $/.test(l));
    expect(entries).toHaveLength(11);
    entries.forEach((l, i) => expect(text.startsWith(`${i + 1} 0 obj\n`, Number(l.slice(0, 10)))).toBe(true));
  });
});

describe('instâncias de variantes no Model', () => {
  it('mudar componentId e props da instância entra no histórico', () => {
    const { doc, model, page } = setup();
    const { icon, icon2, set, padrao, hover } = buttonSet();
    model.transact('Inserir', [{ op: 'insert', parent: page.id, index: 0, node: icon }, { op: 'insert', parent: page.id, index: 1, node: icon2 }, { op: 'insert', parent: page.id, index: 2, node: set }]);
    const inst = createNode('instance', { x: 0, y: 300, width: 100, height: 36 }, { componentId: padrao.id }) as InstanceNode;
    model.transact('Inserir', [{ op: 'insert', parent: page.id, index: 3, node: inst }]);
    model.transact('Variante', [{ op: 'set', id: inst.id, key: 'componentId', value: hover.id }, { op: 'set', id: inst.id, key: 'props.p-label', value: 'Ok' }]);
    const cur = model.index.get(inst.id) as InstanceNode;
    expect(cur.componentId).toBe(hover.id);
    expect(cur.props).toEqual({ 'p-label': 'Ok' });
    model.undo();
    expect((model.index.get(inst.id) as InstanceNode).props?.['p-label']).toBeUndefined();
    expect(finderFor(doc)(hover.id)?.variant).toEqual({ Estado: 'Hover' });
  });
});

describe('edição de pontos', () => {
  it('divide segmentos retos e curvos', () => {
    const line = parsePath('M0 0 L10 0');
    const s = splitSegment(line, 0, 0, 0.5);
    expect(s[0].points.map((p) => [p.x, p.y])).toEqual([[0, 0], [5, 0], [10, 0]]);
    const curve = parsePath('M0 0 C0 10 10 10 10 0');
    const c = splitSegment(curve, 0, 0, 0.5);
    expect(c[0].points).toHaveLength(3);
    expect(c[0].points[1]).toMatchObject({ x: 5, y: 7.5 });
    // a curva dividida passa pelos mesmos lugares
    const before = cubicAt(segmentPoints(curve[0], 0)!, 0.25);
    const after = cubicAt(segmentPoints(c[0], 0)!, 0.5);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    // o segmento que fecha o caminho também pode ser dividido
    const closed = splitSegment(parsePath('M0 0 L10 0 L10 10 Z'), 0, 2, 0.5);
    expect(closed[0].points[3]).toMatchObject({ x: 5, y: 5 });
    expect(nearestOnSegment(segmentPoints(line[0], 0)!, { x: 3, y: 2 }).dist).toBeCloseTo(2, 0);
  });

  it('alterna canto/suave e apaga pontos', () => {
    const sq = parsePath('M0 0 L10 0 L10 10 L0 10 Z');
    const smooth = toggleSmooth(sq, 0, 1);
    expect(smooth[0].points[1].in).toBeDefined();
    expect(smooth[0].points[1].out).toBeDefined();
    expect(toggleSmooth(smooth, 0, 1)[0].points[1].in).toBeUndefined();
    const del = deletePoints(sq, [{ sub: 0, index: 1 }]);
    expect(serializePath(del)).toBe('M0 0 L10 10 L0 10 Z');
    expect(deletePoints(parsePath('M0 0 L1 1'), [{ sub: 0, index: 0 }])).toEqual([]);
  });
});

describe('auto layout: abraçar com filhos que esticam', () => {
  it('um pai que abraça a largura e só tem filhos esticados mantém a largura atual', () => {
    const { model, page } = setup();
    const kid = createNode('frame', { x: 0, y: 0, width: 10, height: 30 }, { sizing: { horizontal: 'fill', vertical: 'fixed' } });
    const parent = createNode('frame', { x: 0, y: 0, width: 400, height: 100 }, {
      layout: { direction: 'vertical', gap: 0, padding: [0, 10, 0, 10], justify: 'start', align: 'start' },
      sizing: { horizontal: 'hug', vertical: 'hug' },
      children: [kid],
    });
    model.transact('Inserir', [{ op: 'insert', parent: page.id, index: 0, node: parent }]);
    expect(model.index.get(parent.id)!.width).toBe(400);
    expect(model.index.get(kid.id)!.width).toBe(380);
  });
});

describe('overrides de layout em instâncias', () => {
  it('tamanho, dimensionamento, redimensionamento do texto, contorno e opacidade por instância', () => {
    const { doc, page } = setup();
    const label = createNode('text', { x: 0, y: 0, width: 31, height: 20 }, { text: 'user', autoResize: 'height' });
    const comp = createNode('component', { x: 0, y: 0, width: 200, height: 40 }, {
      layout: { direction: 'horizontal', gap: 0, padding: [0, 0, 0, 0], justify: 'start', align: 'start' },
      children: [label],
    });
    page.children.push(comp);
    const inst = createNode('instance', { x: 0, y: 100, width: 200, height: 40 }, {
      componentId: comp.id,
      overrides: { [label.id]: { text: 'password', sizing: { horizontal: 'fill', vertical: 'fixed' }, autoResize: 'height', opacity: 0.5, strokes: [{ paint: { type: 'solid', color: '#ff0000' }, width: 2, align: 'inside' }] } },
    });
    const r = resolveInstance(inst, componentFinder(doc, () => [comp]))!;
    const t = r.children[0] as TextNode;
    expect(t.text).toBe('password');
    expect(t.width).toBe(200); // preenche a largura em vez de ficar com 31 px
    expect(t.opacity).toBe(0.5);
    expect(t.strokes?.[0].width).toBe(2);
  });
});
