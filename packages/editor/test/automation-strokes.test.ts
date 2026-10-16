import { describe, expect, it } from 'vitest';
import type { Stroke } from '@zaliel/core';
import { BuildContext, Converter, SpecError, type NodeSpec } from '../src/automation/spec';

const conv = new Converter({} as BuildContext);
const gray = { type: 'solid', color: '#e5e7eb' } as const;
const spec = (p: Partial<NodeSpec>) => ({ type: 'frame', ...p }) as NodeSpec;

describe('automação: contorno por lado', () => {
  it('stroke com "sides" em objeto, lista de nomes e números', () => {
    expect(conv.strokes({ color: '#e5e7eb', width: 1, sides: { bottom: 1 } }, false)[0]).toEqual({ paint: gray, width: 1, align: 'inside', sides: { top: 0, right: 0, bottom: 1, left: 0 } });
    expect(conv.strokes({ color: '#e5e7eb', width: 2, sides: ['bottom', 'right'] }, false)[0].sides).toEqual({ top: 0, right: 2, bottom: 2, left: 0 });
    expect(conv.strokes({ color: '#e5e7eb', sides: [0, 1] }, false)[0].sides).toEqual({ top: 0, right: 1, bottom: 0, left: 1 });
    expect(() => conv.strokes({ color: '#000', sides: { baixo: 1 } }, false)).toThrow(SpecError);
  });

  it('atalho strokeBottom como border-bottom do CSS', () => {
    expect(conv.sideStrokes([], spec({ strokeBottom: '1px solid #e5e7eb' }), false)).toEqual([{ paint: gray, width: 1, align: 'inside', sides: { top: 0, right: 0, bottom: 1, left: 0 } }]);
    // mesma cor em dois lados: um contorno só
    const two = conv.sideStrokes([], spec({ strokeBottom: '1px solid #e5e7eb', strokeRight: '1px solid #e5e7eb' }), false)!;
    expect(two).toHaveLength(1);
    expect(two[0].sides).toEqual({ top: 0, right: 1, bottom: 1, left: 0 });
    // cores diferentes: um contorno por cor
    expect(conv.sideStrokes([], spec({ strokeBottom: '#e5e7eb', strokeTop: '2px dashed #ff0000' }), false)).toHaveLength(2);
    expect(conv.sideStrokes([], spec({}), false)).toBeNull();
  });

  it('atalho por cima de um contorno inteiro troca só aquele lado', () => {
    const all: Stroke[] = [{ paint: gray, width: 1, align: 'inside' }];
    // borda de baixo mais grossa na mesma cor
    expect(conv.sideStrokes(all, spec({ strokeBottom: 3 }), false)).toEqual([{ ...all[0], sides: { top: 1, right: 1, bottom: 3, left: 1 } }]);
    // tira um lado
    expect(conv.sideStrokes(all, spec({ strokeTop: 'none' }), false)![0].sides).toEqual({ top: 0, right: 1, bottom: 1, left: 1 });
    // devolver o lado deixa o contorno uniforme de novo
    const back = conv.sideStrokes([{ ...all[0], sides: { top: 0, right: 1, bottom: 1, left: 1 } }], spec({ strokeTop: '1px solid #e5e7eb' }), false)!;
    expect(back).toEqual(all);
    // tirar todos os lados remove o contorno
    expect(conv.sideStrokes([{ ...all[0], sides: { top: 0, right: 0, bottom: 1, left: 0 } }], spec({ strokeBottom: 'none' }), false)).toEqual([]);
  });
});
