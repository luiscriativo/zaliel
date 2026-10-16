import { beforeAll, describe, expect, it } from 'vitest';
import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';
import { createDocument, createNode, type Stroke } from '@zaliel/core';
import { Renderer } from '../src/renderer';
import { FontRegistry } from '../src/fonts';

let ck: CanvasKit;
let r: Renderer;
beforeAll(async () => {
  ck = await CanvasKitInit();
  r = new Renderer(ck, new FontRegistry(ck));
});

const red = { type: 'solid', color: '#ff0000' } as const;

/** Desenha um frame branco 40×20 com o contorno e devolve a cor (r, g, b, a) de um ponto. */
function render(stroke: Stroke, cornerRadius = 0) {
  const doc = createDocument('t');
  const node = createNode('frame', { x: 0, y: 0, width: 40, height: 20 }, { fills: [{ type: 'solid', color: '#ffffff' }], strokes: [stroke], cornerRadius });
  const out = r.exportPixels(doc, node, (n) => n)!;
  return (x: number, y: number) => Array.from(out.rgba.slice((y * out.width + x) * 4, (y * out.width + x) * 4 + 4));
}

describe('renderizador: contorno por lado', () => {
  it('só a borda de baixo aparece', () => {
    const px = render({ paint: red, width: 2, align: 'inside', sides: { top: 0, right: 0, bottom: 2, left: 0 } });
    expect(px(20, 19)).toEqual([255, 0, 0, 255]);
    expect(px(20, 18)).toEqual([255, 0, 0, 255]);
    expect(px(20, 17)).toEqual([255, 255, 255, 255]);
    expect(px(20, 0)).toEqual([255, 255, 255, 255]);
    expect(px(0, 10)).toEqual([255, 255, 255, 255]);
    expect(px(39, 10)).toEqual([255, 255, 255, 255]);
  });

  it('lados diferentes e tracejado com cantos não quebram o desenho', () => {
    const px = render({ paint: red, width: 1, align: 'inside', sides: { top: 0, right: 3, bottom: 1, left: 0 } });
    expect(px(38, 5)).toEqual([255, 0, 0, 255]);
    expect(px(36, 5)).toEqual([255, 255, 255, 255]);
    const dashed = render({ paint: red, width: 2, align: 'inside', dash: [4, 4], sides: { top: 0, right: 0, bottom: 2, left: 0 } }, 6);
    const row = Array.from({ length: 28 }, (_, i) => dashed(6 + i, 19)[1]);
    expect(row.some((g) => g < 100)).toBe(true); // traço vermelho
    expect(row.some((g) => g > 200)).toBe(true); // vão do tracejado
    expect(dashed(20, 0)).toEqual([255, 255, 255, 255]);
  });
});
