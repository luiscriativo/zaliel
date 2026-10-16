import { beforeAll, describe, expect, it } from 'vitest';
import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';
import { createNode, parsePath, pathBounds, type ContainerNode } from '@zaliel/core';
import { booleanPath, booleanPathData, outlineData, type PathData } from '../src/geometry';

let ck: CanvasKit;
beforeAll(async () => {
  ck = await CanvasKitInit();
});

function squares(op: ContainerNode['booleanOp']) {
  const a = createNode('rect', { x: 0, y: 0, width: 10, height: 10 });
  const b = createNode('rect', { x: 5, y: 5, width: 10, height: 10 });
  return createNode('boolean', { x: 0, y: 0, width: 15, height: 15 }, { booleanOp: op, children: [a, b] });
}

/** Lê o caminho gerado como um leitor de SVG leria (com a regra de preenchimento). */
const read = (data: PathData) => {
  const p = ck.Path.MakeFromSVGString(data.d)!;
  if (data.fillRule === 'evenodd') p.setFillType(ck.FillType.EvenOdd);
  return p;
};

const area = (d: string) => {
  // área pela fórmula do laço (os resultados aqui são só retas)
  let total = 0;
  for (const s of parsePath(d)) {
    const p = s.points;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      total += p[i].x * q.y - q.x * p[i].y;
    }
  }
  return Math.abs(total / 2);
};

describe('operações booleanas com Path.MakeFromOp', () => {
  it('unir, subtrair, interseção e excluir', () => {
    const union = booleanPathData(ck, squares('union')).d;
    expect(area(union)).toBeCloseTo(175);
    expect(pathBounds(parsePath(union))).toEqual({ x: 0, y: 0, width: 15, height: 15 });
    expect(area(booleanPathData(ck, squares('subtract')).d)).toBeCloseTo(75);
    const inter = booleanPathData(ck, squares('intersect')).d;
    expect(pathBounds(parsePath(inter))).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    // excluir: duas peças em L (sem o miolo)
    const xor = booleanPath(ck, squares('exclude'))!;
    expect(xor.contains(2, 2)).toBe(true);
    expect(xor.contains(7, 7)).toBe(false);
    expect(xor.contains(12, 12)).toBe(true);
    xor.delete();
    // o caminho gravado (com a regra de preenchimento) mantém o miolo vazio
    const svg = read(booleanPathData(ck, squares('exclude')));
    expect(svg.contains(7, 7)).toBe(false);
    expect(svg.contains(2, 2)).toBe(true);
    svg.delete();
  });

  it('respeita posição, rotação e camadas ocultas dos filhos', () => {
    const a = createNode('rect', { x: 0, y: 0, width: 10, height: 10 });
    const b = createNode('rect', { x: 20, y: 0, width: 10, height: 10 }, { rotation: 45 });
    const hidden = createNode('rect', { x: 100, y: 100, width: 10, height: 10 }, { visible: false });
    const n = createNode('boolean', { x: 0, y: 0, width: 30, height: 10 }, { children: [a, b, hidden] });
    const p = booleanPath(ck, n)!;
    expect(p.contains(25, 5)).toBe(true);
    expect(p.contains(21, 0.5)).toBe(false); // canto que saiu com a rotação
    expect(p.contains(105, 105)).toBe(false);
    p.delete();
  });

  it('subtrai de uma elipse e aninha booleanas e grupos', () => {
    const disc = createNode('ellipse', { x: 0, y: 0, width: 20, height: 20 });
    const hole = createNode('ellipse', { x: 5, y: 5, width: 10, height: 10 });
    const inner = createNode('boolean', { x: 0, y: 0, width: 20, height: 20 }, { booleanOp: 'subtract', children: [disc, hole] });
    const g = createNode('group', { x: 30, y: 0, width: 10, height: 10 }, { children: [createNode('rect', { x: 0, y: 0, width: 10, height: 10 })] });
    const outer = createNode('boolean', { x: 0, y: 0, width: 40, height: 20 }, { children: [inner, g] });
    const p = booleanPath(ck, outer)!;
    expect(p.contains(2, 10)).toBe(true);
    expect(p.contains(10, 10)).toBe(false);
    expect(p.contains(35, 5)).toBe(true);
    p.delete();
  });

  it('arcos viram uma curva cada (poucos pontos para editar)', () => {
    const rr = createNode('rect', { x: 0, y: 0, width: 40, height: 40 }, { cornerRadius: 10 });
    const sub = createNode('boolean', { x: 0, y: 0, width: 40, height: 40 }, { booleanOp: 'subtract', children: [rr, createNode('ellipse', { x: 10, y: 10, width: 20, height: 20 })] });
    const data = booleanPathData(ck, sub);
    const pts = parsePath(data.d).reduce((n, s) => n + s.points.length, 0);
    expect(pts).toBeLessThan(20);
    const p = read(data);
    expect(p.contains(5, 20)).toBe(true);
    expect(p.contains(20, 20)).toBe(false);
    expect(p.contains(0.5, 0.5)).toBe(false); // canto arredondado
    p.delete();
    const circle = parsePath(outlineData(ck, createNode('ellipse', { x: 0, y: 0, width: 20, height: 20 })).d);
    expect(circle[0].points).toHaveLength(4);
  });

  it('converte formas em caminho SVG', () => {
    const d = outlineData(ck, createNode('rect', { x: 0, y: 0, width: 8, height: 4 })).d;
    expect(pathBounds(parsePath(d))).toEqual({ x: 0, y: 0, width: 8, height: 4 });
    expect(outlineData(ck, createNode('text', { x: 0, y: 0, width: 8, height: 4 })).d).toBe('');
  });
});
