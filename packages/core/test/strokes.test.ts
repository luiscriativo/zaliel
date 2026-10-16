import { describe, expect, it } from 'vitest';
import {
  createDocument,
  createNode,
  exportSvg,
  parse,
  serialize,
  sideStrokeGeometry,
  strokeSides,
  strokeWeight,
  acceptsStrokeSides,
  normalizeSides,
  parsePath,
  pathBounds,
  type ContainerNode,
  type Stroke,
} from '@zaliel/core';

const gray = { type: 'solid', color: '#e5e7eb' } as const;
const bottom: Stroke = { paint: gray, width: 1, align: 'inside', sides: { top: 0, right: 0, bottom: 1, left: 0 } };

describe('contorno por lado', () => {
  it('lados, espessura máxima e tipos que aceitam', () => {
    expect(strokeSides(bottom)).toEqual({ top: 0, right: 0, bottom: 1, left: 0 });
    expect(strokeSides({ paint: gray, width: 2, align: 'inside', sides: { top: 2, right: 2, bottom: 2, left: 2 } })).toBeNull();
    expect(strokeSides({ paint: gray, width: 2, align: 'inside' })).toBeNull();
    expect(strokeWeight({ ...bottom, sides: { top: 0, right: 3, bottom: 1, left: 0 } })).toBe(3);
    expect(acceptsStrokeSides({ type: 'frame' })).toBe(true);
    expect(acceptsStrokeSides({ type: 'ellipse' })).toBe(false);
    expect(normalizeSides({ bottom: 2, left: -1, top: 'x' })).toEqual({ top: 0, right: 0, bottom: 2, left: 0 });
  });

  it('faixa só embaixo: por dentro, centralizada e por fora', () => {
    const d = { top: 0, right: 0, bottom: 1, left: 0 };
    const box = (path: string) => pathBounds(parsePath(path));
    // por dentro: a borda externa é a própria caixa e a interna sobe 1 px embaixo
    const inside = sideStrokeGeometry(100, 40, [0, 0, 0, 0], d, 'inside');
    const [outer, inner] = inside.ring.split('Z').filter(Boolean).map((p) => box(`${p}Z`));
    expect(outer).toMatchObject({ x: 0, y: 0, width: 100, height: 40 });
    expect(inner).toMatchObject({ x: 0, y: 0, width: 100, height: 39 });
    expect(inside.wedges.map((w) => w.side)).toEqual(['bottom']);
    // centralizada: meio pixel para cada lado da linha de baixo
    const center = sideStrokeGeometry(100, 40, [0, 0, 0, 0], d, 'center');
    expect(box(center.ring.split('Z')[0] + 'Z')).toMatchObject({ height: 40.5 });
    // por fora: a borda interna é a caixa
    const outside = sideStrokeGeometry(100, 40, [0, 0, 0, 0], d, 'outside');
    expect(box(outside.ring.split('Z')[1] + 'Z')).toMatchObject({ x: 0, y: 0, width: 100, height: 40 });
    expect(box(outside.ring.split('Z')[0] + 'Z')).toMatchObject({ height: 41 });
  });

  it('cantos arredondados acompanham a faixa', () => {
    const g = sideStrokeGeometry(100, 40, [8, 8, 8, 8], { top: 0, right: 0, bottom: 2, left: 0 }, 'inside');
    expect(g.ring).toContain('A8 8');
    // canto interno embaixo: raio vertical diminui pela espessura de baixo
    expect(g.ring).toContain('A8 6');
  });

  it('exporta SVG só com o lado pedido (liso e tracejado)', () => {
    const doc = createDocument('t');
    const row = createNode('frame', { x: 0, y: 0, width: 200, height: 40 }, { name: 'Linha', strokes: [bottom] }) as ContainerNode;
    const svg = exportSvg(doc, row);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('fill="rgb(229,231,235)"');
    expect(svg).not.toMatch(/<rect[^>]*stroke=/);
    const dashed = exportSvg(doc, { ...row, strokes: [{ ...bottom, dash: [4, 2] }] });
    expect(dashed.match(/<clipPath/g)).toHaveLength(1);
    expect(dashed).toContain('stroke-dasharray="4 2"');
    // contorno comum continua igual
    expect(exportSvg(doc, { ...row, strokes: [{ paint: gray, width: 1, align: 'inside' }] })).toMatch(/<rect[^>]*stroke-width="1"/);
  });

  it('grava e lê do .zal; lados incompletos são completados', () => {
    const doc = createDocument('t');
    const row = createNode('frame', { x: 0, y: 0, width: 200, height: 40 }, { name: 'Linha', strokes: [bottom] }) as ContainerNode;
    doc.pages[0].children.push(row);
    const back = parse(serialize(doc));
    expect((back.pages[0].children[0] as ContainerNode).strokes![0].sides).toEqual(bottom.sides);
    // arquivo escrito à mão: só "bottom"
    const raw = JSON.parse(serialize(doc));
    raw.pages[0].children[0].strokes[0].sides = { bottom: 1 };
    const hand = parse(JSON.stringify(raw));
    expect((hand.pages[0].children[0] as ContainerNode).strokes![0].sides).toEqual({ top: 0, right: 0, bottom: 1, left: 0 });
    // lixo em "sides" é descartado em vez de quebrar o arquivo
    raw.pages[0].children[0].strokes[0].sides = 'baixo';
    expect((parse(JSON.stringify(raw)).pages[0].children[0] as ContainerNode).strokes![0].sides).toBeUndefined();
  });
});
