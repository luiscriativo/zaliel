import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import {
  decodeSchema,
  decodeMessage,
  readFigContainer,
  readZip,
  figToDocument,
  penToDocument,
  penDependencies,
  placement,
  imageSize,
  svgShapeToPath,
  commandsToPath,
  vectorNetworkToPath,
  serialize,
  parse,
  parsePath,
  pathBounds,
  resolveInstance,
  componentFinder,
  walk,
  type ContainerNode,
  type InstanceNode,
  type PathNode,
  type SceneNode,
  type TextNode,
  type ZalDocument,
} from '@zaliel/core';
import { defs, encodeMessage, encodeSchema } from './kiwi-writer';

// ── Esquema com os mesmos nomes de campo de um .fig real ──
const SCHEMA = defs({
  NodeType: ['ENUM', [['DOCUMENT', ''], ['CANVAS', ''], ['FRAME', ''], ['RECTANGLE', ''], ['TEXT', ''], ['VECTOR', ''], ['SYMBOL', ''], ['INSTANCE', ''], ['ELLIPSE', ''], ['BOOLEAN_OPERATION', ''], ['VARIABLE_SET', ''], ['VARIABLE', ''], ['STICKY', '']]],
  StackMode: ['ENUM', [['NONE', ''], ['HORIZONTAL', ''], ['VERTICAL', '']]],
  StackSize: ['ENUM', [['FIXED', ''], ['RESIZE_TO_FIT', '']]],
  AlignSelf: ['ENUM', [['AUTO', ''], ['STRETCH', '']]],
  PaintType: ['ENUM', [['SOLID', ''], ['GRADIENT_LINEAR', ''], ['IMAGE', '']]],
  StrokeAlign: ['ENUM', [['CENTER', ''], ['INSIDE', ''], ['OUTSIDE', '']]],
  TextAutoResize: ['ENUM', [['NONE', ''], ['WIDTH_AND_HEIGHT', ''], ['HEIGHT', '']]],
  WindingRule: ['ENUM', [['NONZERO', ''], ['ODD', '']]],
  BooleanOperation: ['ENUM', [['UNION', ''], ['INTERSECT', ''], ['SUBTRACT', ''], ['XOR', '']]],
  InteractionType: ['ENUM', [['ON_CLICK', ''], ['ON_HOVER', '']]],
  ConnectionType: ['ENUM', [['NONE', ''], ['INTERNAL_NODE', ''], ['BACK', '']]],
  TransitionType: ['ENUM', [['INSTANT_TRANSITION', ''], ['DISSOLVE', ''], ['SLIDE_FROM_RIGHT', '']]],
  VariableResolvedType: ['ENUM', [['BOOLEAN', ''], ['FLOAT', ''], ['STRING', ''], ['COLOR', '']]],
  StyleType: ['ENUM', [['NONE', ''], ['FILL', ''], ['TEXT', ''], ['EFFECT', '']]],
  LineHeightUnits: ['ENUM', [['PIXELS', ''], ['PERCENT', ''], ['RAW', '']]],
  ComponentPropType: ['ENUM', [['BOOL', ''], ['TEXT', ''], ['INSTANCE_SWAP', ''], ['VARIANT', '']]],
  ComponentPropNodeField: ['ENUM', [['VISIBLE', ''], ['TEXT_DATA', ''], ['OVERRIDDEN_SYMBOL_ID', '']]],
  GUID: ['STRUCT', [['sessionID', 'uint'], ['localID', 'uint']]],
  Color: ['STRUCT', [['r', 'float'], ['g', 'float'], ['b', 'float'], ['a', 'float']]],
  Vector: ['STRUCT', [['x', 'float'], ['y', 'float']]],
  Matrix: ['STRUCT', [['m00', 'float'], ['m01', 'float'], ['m02', 'float'], ['m10', 'float'], ['m11', 'float'], ['m12', 'float']]],
  ParentIndex: ['MESSAGE', [['guid', 'GUID'], ['position', 'string']]],
  Ref: ['MESSAGE', [['guid', 'GUID']]],
  VarValue: ['MESSAGE', [['alias', 'Ref'], ['colorValue', 'Color'], ['floatValue', 'float']]],
  VarData: ['MESSAGE', [['value', 'VarValue']]],
  Image: ['MESSAGE', [['hash', 'byte', true]]],
  Paint: ['MESSAGE', [['type', 'PaintType'], ['color', 'Color'], ['opacity', 'float'], ['visible', 'bool'], ['colorVar', 'VarData'], ['image', 'Image']]],
  TextData: ['MESSAGE', [['characters', 'string']]],
  FontName: ['MESSAGE', [['family', 'string'], ['style', 'string']]],
  LineHeight: ['MESSAGE', [['value', 'float'], ['units', 'LineHeightUnits']]],
  Path: ['MESSAGE', [['windingRule', 'WindingRule'], ['commandsBlob', 'uint']]],
  Blob: ['MESSAGE', [['bytes', 'byte', true]]],
  Event: ['MESSAGE', [['interactionType', 'InteractionType']]],
  Action: ['MESSAGE', [['transitionNodeID', 'GUID'], ['connectionType', 'ConnectionType'], ['transitionType', 'TransitionType'], ['transitionDuration', 'float']]],
  Interaction: ['MESSAGE', [['event', 'Event'], ['actions', 'Action', true]]],
  GuidPath: ['MESSAGE', [['guids', 'GUID', true]]],
  SymbolOverride: ['MESSAGE', [['guidPath', 'GuidPath'], ['textData', 'TextData']]],
  SymbolData: ['MESSAGE', [['symbolID', 'GUID'], ['symbolOverrides', 'SymbolOverride', true]]],
  PropValue: ['MESSAGE', [['boolValue', 'bool'], ['textValue', 'TextData'], ['guidValue', 'GUID']]],
  PropDef: ['MESSAGE', [['id', 'GUID'], ['name', 'string'], ['type', 'ComponentPropType'], ['initialValue', 'PropValue']]],
  PropRef: ['MESSAGE', [['defID', 'GUID'], ['componentPropNodeField', 'ComponentPropNodeField']]],
  PropAssign: ['MESSAGE', [['defID', 'GUID'], ['value', 'PropValue']]],
  Mode: ['MESSAGE', [['id', 'GUID'], ['name', 'string']]],
  VarEntry: ['MESSAGE', [['modeID', 'GUID'], ['variableData', 'VarData']]],
  VarDataValues: ['MESSAGE', [['entries', 'VarEntry', true]]],
  NodeChange: ['MESSAGE', [
    ['guid', 'GUID'], ['parentIndex', 'ParentIndex'], ['type', 'NodeType'], ['name', 'string'], ['visible', 'bool'], ['opacity', 'float'],
    ['size', 'Vector'], ['transform', 'Matrix'], ['fillPaints', 'Paint', true], ['strokePaints', 'Paint', true], ['strokeWeight', 'float'], ['strokeAlign', 'StrokeAlign'],
    ['borderStrokeWeightsIndependent', 'bool'], ['borderTopWeight', 'float'], ['borderRightWeight', 'float'], ['borderBottomWeight', 'float'], ['borderLeftWeight', 'float'],
    ['cornerRadius', 'float'], ['stackMode', 'StackMode'], ['stackSpacing', 'float'], ['stackHorizontalPadding', 'float'], ['stackVerticalPadding', 'float'],
    ['stackPrimarySizing', 'StackSize'], ['stackCounterSizing', 'StackSize'], ['stackChildPrimaryGrow', 'float'], ['stackChildAlignSelf', 'AlignSelf'],
    ['textData', 'TextData'], ['derivedTextData', 'TextData'], ['fontName', 'FontName'], ['fontSize', 'float'], ['lineHeight', 'LineHeight'], ['textAutoResize', 'TextAutoResize'],
    ['fillGeometry', 'Path', true], ['symbolData', 'SymbolData'], ['prototypeInteractions', 'Interaction', true], ['componentPropDefs', 'PropDef', true],
    ['componentPropRefs', 'PropRef', true], ['componentPropAssignments', 'PropAssign', true], ['isStateGroup', 'bool'], ['booleanOperation', 'BooleanOperation'],
    ['variableSetModes', 'Mode', true], ['variableSetID', 'Ref'], ['variableResolvedType', 'VariableResolvedType'], ['variableDataValues', 'VarDataValues'],
    ['styleType', 'StyleType'], ['styleIdForFill', 'Ref'], ['overrideKey', 'GUID'], ['frameMaskDisabled', 'bool'], ['internalOnly', 'bool'], ['editInfo', 'uint64'],
  ]],
  Message: ['MESSAGE', [['type', 'uint'], ['nodeChanges', 'NodeChange', true], ['blobs', 'Blob', true]]],
});

const g = (s: number, l: number) => ({ sessionID: s, localID: l });
const at = (x: number, y: number, deg = 0) => {
  const r = (deg * Math.PI) / 180;
  return { m00: Math.cos(r), m01: -Math.sin(r), m02: x, m10: Math.sin(r), m11: Math.cos(r), m12: y };
};
const solid = (r: number, gg: number, b: number) => ({ type: 'SOLID', color: { r, g: gg, b, a: 1 }, opacity: 1, visible: true });
const node = (gid: [number, number], parent: [number, number], pos: string, type: string, name: string, extra: Record<string, unknown> = {}) => ({
  guid: g(...gid), parentIndex: { guid: g(...parent), position: pos }, type, name, visible: true, opacity: 1, ...extra,
});

/** Blob de geometria: comando + floats little-endian. */
function blob(cmds: (number | [number, ...number[]])[]): Uint8Array {
  const bytes: number[] = [];
  for (const c of cmds) {
    const [cmd, ...nums] = Array.isArray(c) ? c : [c];
    bytes.push(cmd);
    for (const v of nums) bytes.push(...new Uint8Array(new Float32Array([v]).buffer));
  }
  return new Uint8Array(bytes);
}

function sampleMessage() {
  const square = blob([[1, 0, 0], [2, 10, 0], [2, 10, 10], [2, 0, 10], 0]);
  const nodes = [
    { guid: g(0, 0), type: 'DOCUMENT', name: 'Documento', visible: true, editInfo: 2n ** 63n + 5n },
    node([0, 1], [0, 0], '!', 'CANVAS', 'Página A'),
    node([0, 2], [0, 0], '~', 'CANVAS', 'Interna', { internalOnly: true, visible: false }),
    // variáveis
    node([1, 1], [0, 2], '!', 'VARIABLE_SET', 'Tema', { variableSetModes: [{ id: g(1, 100), name: 'Claro' }, { id: g(1, 101), name: 'Escuro' }] }),
    node([1, 2], [0, 2], '"', 'VARIABLE', 'fundo', {
      variableSetID: { guid: g(1, 1) }, variableResolvedType: 'COLOR',
      variableDataValues: { entries: [{ modeID: g(1, 100), variableData: { value: { colorValue: { r: 1, g: 1, b: 1, a: 1 } } } }, { modeID: g(1, 101), variableData: { value: { colorValue: { r: 0, g: 0, b: 0, a: 1 } } } }] },
    }),
    // estilo de cor
    node([1, 3], [0, 2], '#', 'RECTANGLE', 'Marca/Vermelho', { styleType: 'FILL', fillPaints: [solid(1, 0, 0)] }),
    // tela com auto layout
    node([2, 1], [0, 1], '!', 'FRAME', 'Tela', {
      size: { x: 360, y: 640 }, transform: at(0, 0), stackMode: 'VERTICAL', stackSpacing: 8, stackHorizontalPadding: 16, stackVerticalPadding: 24,
      fillPaints: [{ ...solid(0.5, 0.5, 0.5), colorVar: { value: { alias: { guid: g(1, 2) } } } }],
    }),
    node([2, 2], [2, 1], '!', 'RECTANGLE', 'Barra', { size: { x: 100, y: 40 }, transform: at(0, 0), stackChildAlignSelf: 'STRETCH', cornerRadius: 6, fillPaints: [solid(1, 0, 0)], styleIdForFill: { guid: g(1, 3) } }),
    node([2, 3], [2, 1], '"', 'TEXT', 'Título', {
      size: { x: 40, y: 28 }, transform: at(0, 0), textData: { characters: 'Olá' }, derivedTextData: { characters: 'ignorado' }, fontName: { family: 'Inter', style: 'Bold Italic' },
      fontSize: 20, lineHeight: { value: 28, units: 'PIXELS' }, textAutoResize: 'WIDTH_AND_HEIGHT', fillPaints: [solid(0, 0, 0)],
    }),
    node([2, 4], [2, 1], '#', 'INSTANCE', 'Botão', {
      size: { x: 120, y: 40 }, transform: at(0, 0),
      symbolData: { symbolID: g(3, 2), symbolOverrides: [{ guidPath: { guids: [g(9, 9)] }, textData: { characters: 'Comprar' } }] },
      componentPropAssignments: [{ defID: g(3, 11), value: { boolValue: false } }],
      prototypeInteractions: [{ event: { interactionType: 'ON_CLICK' }, actions: [{ transitionNodeID: g(2, 21), connectionType: 'INTERNAL_NODE', transitionType: 'DISSOLVE', transitionDuration: 0.4 }] }],
    }),
    node([2, 5], [2, 1], '$', 'VECTOR', 'Seta', { size: { x: 10, y: 10 }, transform: at(10, 0, 90), fillPaints: [solid(0, 0, 1)], fillGeometry: [{ windingRule: 'NONZERO', commandsBlob: 0 }] }),
    node([2, 6], [2, 1], '%', 'BOOLEAN_OPERATION', 'Furo', { size: { x: 20, y: 20 }, transform: at(0, 0), booleanOperation: 'SUBTRACT', fillPaints: [solid(0, 0, 0)] }),
    node([2, 7], [2, 6], '!', 'RECTANGLE', 'Base', { size: { x: 20, y: 20 }, transform: at(0, 0) }),
    node([2, 8], [2, 6], '"', 'ELLIPSE', 'Círculo', { size: { x: 10, y: 10 }, transform: at(5, 5) }),
    node([2, 9], [2, 1], '&', 'STICKY', 'Nota', { size: { x: 10, y: 10 }, transform: at(0, 0) }),
    node([2, 20], [0, 1], '"', 'FRAME', 'Detalhe', { size: { x: 360, y: 640 }, transform: at(500, 0), fillPaints: [solid(1, 1, 1)] }),
    node([2, 21], [2, 20], '!', 'RECTANGLE', 'Cartão', { size: { x: 100, y: 100 }, transform: at(20, 20) }),
    node([2, 22], [2, 20], '"', 'FRAME', 'Linha da tabela', {
      size: { x: 300, y: 40 }, transform: at(0, 200), strokePaints: [solid(0.9, 0.9, 0.92)], strokeWeight: 1, strokeAlign: 'INSIDE',
      borderStrokeWeightsIndependent: true, borderTopWeight: 0, borderRightWeight: 0, borderBottomWeight: 1, borderLeftWeight: 0,
    }),
    // conjunto de variantes
    node([3, 1], [0, 1], '#', 'FRAME', 'Botão', {
      size: { x: 300, y: 80 }, transform: at(0, 800), isStateGroup: true,
      componentPropDefs: [{ id: g(3, 10), name: 'Estado', type: 'VARIANT' }, { id: g(3, 11), name: 'Ícone', type: 'BOOL', initialValue: { boolValue: true } }],
    }),
    node([3, 2], [3, 1], '!', 'SYMBOL', 'Estado=Padrão', { size: { x: 120, y: 40 }, transform: at(0, 0), fillPaints: [solid(0.2, 0.2, 0.8)] }),
    node([3, 3], [3, 2], '!', 'TEXT', 'Rótulo', { size: { x: 60, y: 20 }, transform: at(10, 10), overrideKey: g(9, 9), textData: { characters: 'Enviar' }, fontName: { family: 'Inter', style: 'Regular' }, fontSize: 14, fillPaints: [solid(1, 1, 1)] }),
    node([3, 4], [3, 2], '"', 'RECTANGLE', 'Ícone', { size: { x: 10, y: 10 }, transform: at(100, 15), componentPropRefs: [{ defID: g(3, 11), componentPropNodeField: 'VISIBLE' }] }),
    node([3, 5], [3, 1], '"', 'SYMBOL', 'Estado=Hover', { size: { x: 120, y: 40 }, transform: at(140, 0) }),
  ];
  return { nodes, blobs: [{ bytes: square }] };
}

/** ZIP sem compressão (como o "guardado"), só para o teste. */
function zipStored(files: Record<string, Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const local: number[] = [], central: number[] = [];
  const u16 = (a: number[], v: number) => a.push(v & 255, (v >> 8) & 255);
  const u32 = (a: number[], v: number) => a.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  let count = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = enc.encode(name);
    const off = local.length;
    u32(local, 0x04034b50); u16(local, 20); u16(local, 0); u16(local, 0); u16(local, 0); u16(local, 0); u32(local, 0); u32(local, data.length); u32(local, data.length); u16(local, n.length); u16(local, 0);
    local.push(...n, ...data);
    u32(central, 0x02014b50); u16(central, 20); u16(central, 20); u16(central, 0); u16(central, 0); u16(central, 0); u16(central, 0); u32(central, 0); u32(central, data.length); u32(central, data.length);
    u16(central, n.length); u16(central, 0); u16(central, 0); u16(central, 0); u16(central, 0); u32(central, 0); u32(central, off);
    central.push(...n);
    count++;
  }
  const end: number[] = [];
  u32(end, 0x06054b50); u16(end, 0); u16(end, 0); u16(end, count); u16(end, count); u32(end, central.length); u32(end, local.length); u16(end, 0);
  return new Uint8Array([...local, ...central, ...end]);
}

const inflateRaw = (b: Uint8Array) => new Uint8Array(zlib.inflateRawSync(b));

function figFile(): Uint8Array {
  const m = sampleMessage();
  const schema = zlib.deflateRawSync(encodeSchema(SCHEMA));
  const data = zlib.deflateRawSync(encodeMessage(SCHEMA, 'Message', { type: 1, nodeChanges: m.nodes, blobs: m.blobs }));
  const head = new TextEncoder().encode('fig-kiwi');
  const u32 = (v: number) => new Uint8Array(new Uint32Array([v]).buffer);
  return new Uint8Array([...head, ...u32(15), ...u32(schema.length), ...schema, ...u32(data.length), ...data]);
}

const find = (doc: ZalDocument, name: string): SceneNode => {
  let out: SceneNode | undefined;
  for (const p of doc.pages) walk(p.children, (n) => void (n.name === name && !out && (out = n)));
  if (!out) throw new Error(`sem ${name}`);
  return out;
};

describe('Kiwi', () => {
  it('lê o esquema e a mensagem, pulando campos que não interessam', () => {
    const bytes = encodeMessage(SCHEMA, 'Message', { type: 1, nodeChanges: sampleMessage().nodes, blobs: [] });
    const schema = decodeSchema(encodeSchema(SCHEMA));
    const all = decodeMessage(schema, bytes, 'Message') as { nodeChanges: Record<string, unknown>[] };
    expect(all.nodeChanges[0].editInfo).toBe(2n ** 63n + 5n); // inteiro de 64 bits com o 9º byte cheio
    const text = all.nodeChanges.find((n) => n.name === 'Título')!;
    expect(text.derivedTextData).toEqual({ characters: 'ignorado' });
    expect((text.fontName as { style: string }).style).toBe('Bold Italic');
    const fast = decodeMessage(schema, bytes, 'Message', ['derivedTextData', 'editInfo']) as { nodeChanges: Record<string, unknown>[] };
    expect(fast.nodeChanges.find((n) => n.name === 'Título')!.derivedTextData).toBeUndefined();
    expect(fast.nodeChanges.length).toBe(all.nodeChanges.length);
  });
});

describe('importação de .fig (simulada)', () => {
  const zipped = zipStored({ 'canvas.fig': figFile(), 'meta.json': new TextEncoder().encode('{"client_meta":{"background_color":{"r":0.1,"g":0.1,"b":0.1,"a":1}}}') });
  const container = readFigContainer(zipped, { inflateRaw }, readZip);
  const { doc, report } = figToDocument(container, 'Simulado');

  it('abre o ZIP e os blocos comprimidos', () => {
    expect(container.schema.length).toBeGreaterThan(100);
    expect(container.background).toBe('#1a1a1a');
    expect(() => readFigContainer(new TextEncoder().encode('não é um arquivo de design'), { inflateRaw }, readZip)).toThrow();
  });

  it('páginas, telas e o arquivo resultante é um .zal válido', () => {
    expect(doc.pages.map((p) => p.name)).toEqual(['Página A']);
    expect(doc.pages[0].children.map((n) => n.name)).toEqual(['Tela', 'Detalhe', 'Botão']);
    const back = parse(serialize(doc));
    expect(back.pages[0].children).toHaveLength(3);
    expect(report.counts.total).toBeGreaterThan(10);
    expect(report.warnings.some((w) => /sticky/.test(w))).toBe(true);
  });

  it('auto layout, variáveis com modos, estilos e texto', () => {
    const tela = find(doc, 'Tela') as ContainerNode;
    expect(tela.layout).toMatchObject({ direction: 'vertical', gap: 8, padding: [24, 16, 24, 16] });
    expect(tela.fills?.[0]).toMatchObject({ type: 'solid', variable: '1:2' });
    expect(doc.variables[0]).toMatchObject({ name: 'Tema', modes: [{ name: 'Claro' }, { name: 'Escuro' }] });
    expect(doc.variables[0].variables[0].values).toEqual({ '1:100': '#ffffff', '1:101': '#000000' });
    const barra = find(doc, 'Barra');
    expect(barra.sizing).toEqual({ horizontal: 'fill', vertical: 'fixed' });
    expect(barra.styles).toEqual({ fill: '1:3' });
    expect(doc.styles?.[0]).toMatchObject({ name: 'Marca/Vermelho', type: 'color' });
    const t = find(doc, 'Título') as TextNode;
    expect(t.text).toBe('Olá');
    expect(t.style).toMatchObject({ family: 'Inter', weight: 700, italic: true, size: 20, lineHeight: 28 });
    expect(t.autoResize).toBe('width');
    expect(report.fonts).toContain('Inter');
  });

  it('vetores com rotação, booleanas e protótipo', () => {
    const seta = find(doc, 'Seta') as PathNode;
    expect(seta.type).toBe('path');
    expect(pathBounds(parsePath(seta.d))).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(seta.rotation).toBe(90);
    // girado 90° em torno do canto (10, 0): a caixa ocupa x 0..10, y 0..10
    expect([seta.x, seta.y]).toEqual([0, 0]);
    const furo = find(doc, 'Furo') as ContainerNode;
    expect(furo).toMatchObject({ type: 'boolean', booleanOp: 'subtract' });
    expect(furo.children.map((c) => c.type)).toEqual(['rect', 'ellipse']);
    const botao = find(doc, 'Botão') as InstanceNode;
    expect(botao.interactions).toEqual([{ trigger: 'click', action: 'navigate', target: '2:20', transition: 'dissolve', duration: 400 }]);
  });

  it('variantes, propriedades e overrides de instância funcionam no Zaliel', () => {
    const set = doc.pages[0].children.find((n) => n.type === 'component-set') as ContainerNode;
    expect(set.children.map((c) => c.name)).toEqual(['Estado=Padrão', 'Estado=Hover']);
    expect((set.children[0] as ContainerNode).variant).toEqual({ Estado: 'Padrão' });
    expect(set.properties).toEqual([{ id: '3:11', name: 'Ícone', type: 'boolean', default: true }]);
    expect(find(doc, 'Ícone').propRefs).toEqual({ visible: '3:11' });
    const inst = doc.pages[0].children[0] as ContainerNode;
    const btn = inst.children.find((c) => c.type === 'instance') as InstanceNode;
    expect(btn.overrides).toEqual({ '3:3': { text: 'Comprar' } });
    expect(btn.props).toEqual({ '3:11': false });
    const comps: ContainerNode[] = [];
    walk(doc.pages[0].children, (n) => void (n.type === 'component' && comps.push(n)));
    const finder = componentFinder(doc, () => comps, (cid) => (set.children.some((c) => c.id === cid) ? set : undefined));
    const r = resolveInstance(btn, finder)!;
    expect((r.children.find((c) => c.name === 'Rótulo') as TextNode).text).toBe('Comprar');
    expect(r.children.find((c) => c.name === 'Ícone')!.visible).toBe(false);
  });

  it('contornos individuais por lado (Individual strokes)', () => {
    const row = find(doc, 'Linha da tabela');
    expect(row.strokes).toHaveLength(1);
    expect(row.strokes![0]).toMatchObject({ width: 1, align: 'inside', sides: { top: 0, right: 0, bottom: 1, left: 0 } });
    expect(find(doc, 'Cartão').strokes?.[0]?.sides).toBeUndefined();
  });

  it('blobs de geometria e redes de vetores viram caminhos', () => {
    expect(commandsToPath(blob([[1, 0, 0], [4, 1, 2, 3, 4, 5, 6], [3, 1, 1, 2, 2], 0]))).toBe('M0 0 C1 2 3 4 5 6 Q1 1 2 2 Z');
    // rede: 2 vértices, 1 segmento reto
    const net = new Uint8Array(12 + 2 * 12 + 28);
    const v = new DataView(net.buffer);
    v.setUint32(0, 2, true);
    v.setUint32(4, 1, true);
    v.setFloat32(12 + 4, 0, true); v.setFloat32(12 + 8, 0, true);
    v.setFloat32(24 + 4, 8, true); v.setFloat32(24 + 8, 4, true);
    v.setUint32(36 + 4, 0, true);
    v.setUint32(36 + 16, 1, true);
    expect(vectorNetworkToPath(net, 2, 2)).toBe('M0 0 L16 8');
  });
});

describe('importação de .pen (simulada)', () => {
  const lib = {
    version: '2.17',
    themes: { Modo: ['Claro', 'Escuro'] },
    variables: {
      fundo: { type: 'color', value: [{ value: '#FFFFFF', theme: { Modo: 'Claro' } }, { value: '#111111', theme: { Modo: 'Escuro' } }] },
      raio: { type: 'number', value: 8 },
      fonte: { type: 'string', value: 'Inter' },
    },
    children: [
      {
        type: 'frame', id: 'btn', name: 'Botão', reusable: true, width: 'fit_content', height: 40, fill: '$fundo', cornerRadius: '$raio', padding: [8, 16], gap: 6, alignItems: 'center',
        children: [
          { type: 'icon', id: 'ico', name: 'Ícone', width: 16, height: 16, icon: 'check', library: 'lucide', fill: '#000000' },
          { type: 'text', id: 'lbl', name: 'Rótulo', content: 'Ok', fontFamily: '$fonte', fontSize: 14, fontWeight: '600', fill: '#000000' },
        ],
      },
      { type: 'frame', id: 'card', name: 'Cartão', reusable: true, width: 200, height: 100, layout: 'vertical', children: [{ type: 'frame', id: 'slot', name: 'Conteúdo', width: 'fill_container', height: 40, layout: 'vertical' }] },
    ],
  };
  const main = {
    version: '2.17',
    imports: { L: 'lib.pen' },
    children: [
      {
        type: 'frame', id: 'tela', name: 'Tela', x: 0, y: 0, width: 360, height: 640, layout: 'vertical', gap: 12, padding: 24, fill: '#F4F4F4',
        children: [
          { type: 'ref', id: 'b1', ref: 'L:btn', name: 'Salvar', descendants: { 'L:lbl': { content: 'Salvar' }, 'L:ico': { enabled: false } } },
          { type: 'ref', id: 'c1', ref: 'L:card', name: 'Cartão', descendants: { 'L:slot': { type: 'frame', children: [{ type: 'text', id: 't1', name: 'Texto', content: '$ npm test' }, { type: 'ref', id: 'b2', ref: 'L:btn' }] } } },
          { type: 'ref', id: 'b3', ref: 'L:btn', theme: { 'L:Modo': 'Escuro' } },
          { type: 'path', id: 'p1', name: 'Seta', width: 48, height: 48, viewBox: [0, 0, 24, 24], geometry: 'M0 0L24 24', stroke: '#000', strokeWidth: 2 },
          { type: 'icon', id: 'm1', name: 'Casa', width: 24, height: 24, icon: 'home', library: 'Material Symbols Outlined', fill: '#333' },
          { type: 'prompt', id: 'x', model: 'qualquer', content: 'texto' },
          { type: 'frame', id: 'row', name: 'Linha', width: 300, height: 40, stroke: '#E5E7EB', strokeWidth: [0, 1, 1, 0], strokeAlignment: 'inside' },
          { type: 'frame', id: 'row2', name: 'Linha 2', width: 300, height: 40, stroke: '#E5E7EB', strokeWidth: { bottom: 2 } },
        ],
      },
    ],
  };
  const icons = (library: string, name: string) => (library === 'lucide' && name === 'check' ? { d: 'M4 12 L10 18 L20 6', size: 24, stroke: true, strokeWidth: 2 } : null);
  const { doc, report } = penToDocument({ text: JSON.stringify(main), imports: { L: { name: 'lib', text: JSON.stringify(lib) } }, icons }, 'Teste');

  it('espessura por lado vira contorno individual', () => {
    const [a, b] = [find(doc, 'Linha'), find(doc, 'Linha 2')];
    expect(a.strokes![0]).toMatchObject({ width: 1, align: 'inside', sides: { top: 0, right: 1, bottom: 1, left: 0 } });
    expect(b.strokes![0]).toMatchObject({ width: 2, sides: { top: 0, right: 0, bottom: 2, left: 0 } });
    expect(report.warnings.join(' ')).not.toMatch(/maior espessura/);
  });

  it('lista dependências para o sistema ler antes', () => {
    const deps = penDependencies(JSON.stringify({ imports: { Q: 'a.pen' }, children: [{ type: 'frame', fill: { type: 'image', url: 'img/a.png' } }, { type: 'ref', descendants: { x: { icon: 'bell' } } }] }));
    expect(deps).toEqual({ imports: { Q: 'a.pen' }, images: ['img/a.png'], icons: [{ library: 'lucide', name: 'bell' }] });
  });

  it('páginas para o arquivo e para a biblioteca, e é um .zal válido', () => {
    expect(doc.pages.map((p) => p.name)).toEqual(['Página 1', 'Biblioteca: lib']);
    expect(() => parse(serialize(doc))).not.toThrow();
    expect(report.warnings).toEqual([]);
  });

  it('variáveis com temas viram coleções com modos', () => {
    const modo = doc.variables.find((c) => c.name.startsWith('Modo'))!;
    expect(modo.modes.map((m) => m.name)).toEqual(['Claro', 'Escuro']);
    expect(Object.values(modo.variables[0].values)).toEqual(['#ffffff', '#111111']);
    const btn = doc.pages[1].children.find((n) => n.name === 'Botão') as ContainerNode;
    expect(btn.type).toBe('component');
    expect(btn.fills?.[0]).toMatchObject({ variable: 'L:fundo' });
    expect(btn.cornerRadius).toBe(8);
    expect(btn.layout).toMatchObject({ direction: 'horizontal', padding: [8, 16, 8, 16], align: 'center' });
    expect(btn.sizing).toEqual({ horizontal: 'hug', vertical: 'fixed' });
  });

  it('ref simples vira instância com overrides; ref que muda estrutura ou tema vira cópia', () => {
    const tela = doc.pages[0].children[0] as ContainerNode;
    const [salvar, cartao, escuro] = tela.children;
    expect(salvar).toMatchObject({ type: 'instance', componentId: 'L:btn', overrides: { 'L:lbl': { text: 'Salvar' }, 'L:ico': { visible: false } } });
    expect(cartao.type).toBe('frame');
    const slot = (cartao as ContainerNode).children[0] as ContainerNode;
    expect(slot.children.map((c) => c.type)).toEqual(['text', 'instance']);
    expect((slot.children[0] as TextNode).text).toBe('$ npm test'); // "$" de texto não é variável
    expect(slot.children[1]).toMatchObject({ componentId: 'L:btn' });
    // tema escuro: cor resolvida e sem ligação com a variável
    expect((escuro as ContainerNode).fills?.[0]).toEqual({ type: 'solid', color: '#111111' });
    const ids = new Set<string>();
    walk(doc.pages[0].children, (n) => {
      expect(ids.has(n.id)).toBe(false);
      ids.add(n.id);
    });
  });

  it('ícones, caminhos com viewBox e fontes de ícones', () => {
    const ico = find(doc, 'Ícone') as PathNode;
    expect(ico.type).toBe('path');
    expect(ico.strokes?.[0]).toMatchObject({ width: 1.33, cap: 'round' });
    const seta = find(doc, 'Seta') as PathNode;
    expect(pathBounds(parsePath(seta.d))).toEqual({ x: 0, y: 0, width: 48, height: 48 });
    const casa = find(doc, 'Casa') as TextNode;
    expect(casa).toMatchObject({ type: 'text', text: 'home', style: { family: 'Material Symbols Outlined' } });
    expect(report.fonts).toContain('Material Symbols Outlined');
    expect(() => find(doc, 'prompt')).toThrow();
  });
});

describe('utilitários da importação', () => {
  it('posição com rotação em torno do canto vira rotação em torno do centro', () => {
    expect(placement([1, 0, 0, 1, 5, 6], 10, 20)).toEqual({ x: 5, y: 6, flipped: false });
    const p = placement([0, 1, -1, 0, 10, 0], 10, 10); // 90°
    expect(p).toMatchObject({ x: 0, y: 0, rotation: 90, flipped: false });
    expect(placement([-1, 0, 0, 1, 0, 0], 10, 10).flipped).toBe(true);
  });

  it('lê o tamanho de imagens pelo cabeçalho', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    new DataView(png.buffer).setUint32(16, 640);
    new DataView(png.buffer).setUint32(20, 480);
    expect(imageSize(png)).toEqual({ width: 640, height: 480 });
  });

  it('elementos SVG simples viram caminhos', () => {
    expect(svgShapeToPath('line', { x1: '2', y1: '3', x2: '4', y2: '5' })).toBe('M2 3 L4 5');
    expect(svgShapeToPath('polygon', { points: '0,0 10,0 5,8' })).toBe('M0 0 L10 0 L5 8 Z');
    expect(pathBounds(parsePath(svgShapeToPath('circle', { cx: '12', cy: '12', r: '10' })))).toMatchObject({ x: 2, width: 20 });
    const rb = pathBounds(parsePath(svgShapeToPath('rect', { x: '2', y: '5', width: '20', height: '14', rx: '2' })));
    expect([rb.x, rb.y, rb.width, rb.height].map((v) => Math.round(v * 1000) / 1000)).toEqual([2, 5, 20, 14]);
  });
});
