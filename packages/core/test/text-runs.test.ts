import { describe, expect, it } from 'vitest';
import {
  createDocument, createNode, serialize, parse, exportSvg, resolveInstance, componentFinder, penToDocument,
  normalizeRuns, spliceRuns, runsAfterEdit, applyRunStyle, clearRunAttr, textSegments, segmentsIn, runsToSpans, spansToRuns,
  type ContainerNode, type InstanceNode, type TextNode, type TextRun, type TextStyle,
} from '../src';

const base: TextStyle = { family: 'Inter', weight: 400, size: 14 };
const frase = 'Tem certeza que deseja excluir 2 registros selecionados?';
const negrito = (s: string) => ({ start: frase.indexOf(s), end: frase.indexOf(s) + s.length, weight: 700 });

describe('trechos de estilo: normalização', () => {
  it('ordena, corta no tamanho do texto, une vizinhos iguais e tira o que é igual ao estilo do texto', () => {
    const runs: TextRun[] = [
      { start: 2, end: 3, weight: 400, italic: false },
      { start: 8, end: 20, weight: 700 },
      { start: 0, end: 4, weight: 700 },
      { start: 4, end: 8, weight: 700 },
      { start: 15, end: 99, color: '#FF0000' },
      { start: 5, end: 5, weight: 900 },
    ];
    expect(normalizeRuns(runs, 18, base)).toEqual([
      { start: 0, end: 15, weight: 700 },
      { start: 15, end: 18, weight: 700, color: '#ff0000' },
    ]);
  });

  it('o último trecho da lista ganha onde há sobreposição', () => {
    const runs: TextRun[] = [{ start: 0, end: 10, weight: 700 }, { start: 3, end: 6, weight: 300 }];
    expect(normalizeRuns(runs, 10, base)).toEqual([
      { start: 0, end: 3, weight: 700 },
      { start: 3, end: 6, weight: 300 },
      { start: 6, end: 10, weight: 700 },
    ]);
  });

  it('pedaços cobrem o texto inteiro com o estilo final', () => {
    const segs = textSegments('abcdef', base, [{ start: 2, end: 4, weight: 700, color: '#112233' }]);
    expect(segs.map((g) => [g.start, g.end, g.style.weight, g.color ?? null, g.styled])).toEqual([
      [0, 2, 400, null, false],
      [2, 4, 700, '#112233', true],
      [4, 6, 400, null, false],
    ]);
  });
});

describe('trechos de estilo: ajuste ao digitar e apagar', () => {
  const runs: TextRun[] = [{ start: 4, end: 8, weight: 700 }]; // "aaaaBBBBcccc"

  it('digitar antes do trecho empurra, dentro ou no fim estende', () => {
    expect(spliceRuns(runs, 0, 0, 2, 14)).toEqual([{ start: 6, end: 10, weight: 700 }]);
    expect(spliceRuns(runs, 6, 0, 3, 15)).toEqual([{ start: 4, end: 11, weight: 700 }]);
    // no fim do trecho: herda o estilo da letra anterior
    expect(spliceRuns(runs, 8, 0, 1, 13)).toEqual([{ start: 4, end: 9, weight: 700 }]);
    // logo antes do trecho: herda da letra anterior (sem estilo)
    expect(spliceRuns(runs, 4, 0, 1, 13)).toEqual([{ start: 5, end: 9, weight: 700 }]);
  });

  it('no começo do texto herda da primeira letra', () => {
    expect(spliceRuns([{ start: 0, end: 3, italic: true }], 0, 0, 2, 7)).toEqual([{ start: 0, end: 5, italic: true }]);
  });

  it('apagar encolhe, e apagar o trecho inteiro some com ele', () => {
    expect(spliceRuns(runs, 2, 4, 0, 8)).toEqual([{ start: 2, end: 4, weight: 700 }]);
    expect(spliceRuns(runs, 4, 4, 0, 8)).toEqual([]);
    expect(spliceRuns(runs, 0, 2, 0, 10)).toEqual([{ start: 2, end: 6, weight: 700 }]);
  });

  it('substituir uma seleção dentro do trecho mantém o estilo', () => {
    expect(spliceRuns(runs, 5, 2, 1, 11)).toEqual([{ start: 4, end: 7, weight: 700 }]);
  });

  it('edição livre (antes/depois) acha onde o texto mudou', () => {
    expect(runsAfterEdit(runs, 'aaaaBBBBcccc', 'aaaaBBxBBcccc')).toEqual([{ start: 4, end: 9, weight: 700 }]);
    expect(runsAfterEdit(runs, 'aaaaBBBBcccc', 'aaBBBBcccc')).toEqual([{ start: 2, end: 6, weight: 700 }]);
    expect(runsAfterEdit(runs, 'aaaaBBBBcccc', 'aaaaBBBBcc')).toEqual(runs);
  });
});

describe('trechos de estilo: aplicar à seleção', () => {
  it('aplica, sobrepõe e desfaz', () => {
    let runs = applyRunStyle(undefined, frase.length, negrito('2 registros selecionados').start, negrito('2 registros selecionados').end, { weight: 700 }, base);
    expect(runs).toEqual([negrito('2 registros selecionados')]);
    const r = frase.indexOf('registros');
    runs = applyRunStyle(runs, frase.length, r, r + 9, { color: '#C00000' }, base);
    expect(runs).toEqual([
      { start: r - 2, end: r, weight: 700 },
      { start: r, end: r + 9, weight: 700, color: '#c00000' },
      { start: r + 9, end: negrito('2 registros selecionados').end, weight: 700 },
    ]);
    // voltar ao estilo do texto
    runs = applyRunStyle(runs, frase.length, 0, frase.length, { weight: undefined, color: undefined }, base);
    expect(runs).toEqual([]);
  });

  it('o que vale para o texto inteiro sai dos trechos', () => {
    const runs: TextRun[] = [{ start: 0, end: 3, weight: 700, color: '#ff0000' }];
    expect(clearRunAttr(runs, 5, ['weight'], base)).toEqual([{ start: 0, end: 3, color: '#ff0000' }]);
    expect(clearRunAttr(runs, 5, ['weight', 'color'], base)).toEqual([]);
  });

  it('pedaços da seleção (para saber se já está em negrito)', () => {
    const runs = [negrito('2 registros')];
    const s = frase.indexOf('2 registros');
    expect(segmentsIn(frase, base, runs, s, s + 5).every((g) => g.style.weight === 700)).toBe(true);
    expect(segmentsIn(frase, base, runs, s - 3, s + 5).every((g) => g.style.weight === 700)).toBe(false);
  });
});

describe('trechos de estilo: spans (automação)', () => {
  it('ida e volta', () => {
    const { text, runs } = spansToRuns([{ text: 'Tem certeza que deseja excluir ' }, { text: '2 registros selecionados', weight: 700 }, { text: '?' }], base);
    expect(text).toBe(frase);
    expect(runs).toEqual([negrito('2 registros selecionados')]);
    expect(runsToSpans(text, runs)).toEqual([{ text: 'Tem certeza que deseja excluir ' }, { text: '2 registros selecionados', weight: 700 }, { text: '?' }]);
  });
});

function textNode(runs?: TextRun[]): TextNode {
  return createNode('text', { x: 0, y: 0, width: 400, height: 20 }, { text: frase, style: { ...base }, runs, fills: [{ type: 'solid', color: '#333333' }] });
}

describe('trechos de estilo no arquivo .zal', () => {
  it('gravam e voltam iguais', () => {
    const doc = createDocument('T');
    const t = textNode([negrito('2 registros selecionados')]);
    doc.pages[0].children.push(t);
    const back = parse(serialize(doc)).pages[0].children[0] as TextNode;
    expect(back.runs).toEqual([negrito('2 registros selecionados')]);
  });

  it('arquivos antigos (sem trechos) abrem como antes', () => {
    const doc = createDocument('T');
    doc.pages[0].children.push(textNode());
    const back = parse(serialize(doc)).pages[0].children[0] as TextNode;
    expect(back.runs).toBeUndefined();
  });

  it('trechos fora do lugar são ajustados ao abrir; tipos errados são recusados', () => {
    const doc = createDocument('T');
    doc.pages[0].children.push(textNode([{ start: 50, end: 500, weight: 700 }, { start: 0, end: 3, weight: 400 }]));
    const back = parse(serialize(doc)).pages[0].children[0] as TextNode;
    expect(back.runs).toEqual([{ start: 50, end: frase.length, weight: 700 }]);

    const bad = JSON.parse(serialize(doc));
    bad.pages[0].children[0].runs = [{ start: 0, end: 3, color: 'vermelho' }];
    expect(() => parse(JSON.stringify(bad))).toThrow(/danificado/);
  });
});

describe('trechos de estilo no SVG', () => {
  it('trecho em negrito e cor viram <tspan> dentro da linha', () => {
    const doc = createDocument('T');
    const t = textNode([{ ...negrito('2 registros selecionados'), color: '#c00000' }]);
    const svg = exportSvg(doc, t);
    expect(svg).toContain('Tem certeza que deseja excluir <tspan font-weight="700" fill="rgb(192,0,0)">2 registros selecionados</tspan>?');
  });

  it('quebras de linha dividem o trecho entre as linhas', () => {
    const doc = createDocument('T');
    const t = createNode('text', { x: 0, y: 0, width: 100, height: 40 }, { text: 'ab\ncd', style: { ...base }, runs: [{ start: 1, end: 4, italic: true }], fills: [{ type: 'solid', color: '#000000' }] });
    const svg = exportSvg(doc, t);
    expect(svg).toMatch(/<tspan x="0" y="[\d.]+">a<tspan font-style="italic">b<\/tspan><\/tspan><tspan x="0" y="[\d.]+"><tspan font-style="italic">c<\/tspan>d<\/tspan>/);
  });

  it('sem trechos o SVG fica como antes', () => {
    const svg = exportSvg(createDocument('T'), textNode());
    expect(svg).toContain(`>${frase}</tspan>`);
  });
});

describe('trechos de estilo em componentes', () => {
  const comp = createNode('component', { x: 0, y: 0, width: 400, height: 20 }) as ContainerNode;
  const t = textNode([negrito('2 registros selecionados')]);
  comp.children.push(t);
  const find = componentFinder(createDocument('x'), () => [comp]);
  const inst = (overrides?: InstanceNode['overrides']): InstanceNode => ({ ...createNode('instance', { x: 0, y: 0, width: 400, height: 20 }, { componentId: comp.id }), overrides } as InstanceNode);
  const inner = (r: ContainerNode | null) => r!.children[0] as TextNode;

  it('a instância herda os trechos do componente', () => {
    expect(inner(resolveInstance(inst(), find)).runs).toEqual([negrito('2 registros selecionados')]);
  });

  it('texto trocado sem trechos perde os do componente; com trechos usa os seus', () => {
    expect(inner(resolveInstance(inst({ [t.id]: { text: 'Outro texto' } }), find)).runs).toBeUndefined();
    expect(inner(resolveInstance(inst({ [t.id]: { text: 'Outro texto', runs: [{ start: 0, end: 5, italic: true }] } }), find)).runs).toEqual([{ start: 0, end: 5, italic: true }]);
  });
});

describe('trechos de estilo na importação do .pen', () => {
  it('conteúdo em pedaços vira texto com trechos', () => {
    const pen = {
      version: '2.6',
      children: [{
        type: 'frame', id: 'f', name: 'Tela', x: 0, y: 0, width: 300, height: 100,
        children: [{ type: 'text', id: 't', name: 'Aviso', fontSize: 14, fill: '#333333', content: ['Excluir ', { content: '2 registros', fontWeight: 'bold', fill: '#cc0000' }, '?'] }],
      }],
    };
    const res = penToDocument({ text: JSON.stringify(pen) }, 'teste');
    const frame = res.doc.pages[0].children[0] as ContainerNode;
    const t = frame.children[0] as TextNode;
    expect(t.text).toBe('Excluir 2 registros?');
    expect(t.runs).toEqual([{ start: 8, end: 19, weight: 700, color: '#cc0000' }]);
  });
});
