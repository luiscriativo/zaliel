// Contornos das formas como caminhos do Skia: usados pelo desenho, pelas
// operações booleanas (Path.MakeFromOp) e para converter formas em vetores.
import type { CanvasKit, Path as SkPath, PathOp } from 'canvaskit-wasm';
import { nodeMatrix, polygonPath, radii, type BooleanOp, type ContainerNode, type Mat, type SceneNode } from '@zaliel/core';

/** Matriz 2D do core no formato 3×3 do Skia. */
export function toSkMatrix(m: Mat): number[] {
  return [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1];
}

/** Caminho da forma no espaço do próprio nó (0..largura, 0..altura). Quem chama apaga. */
export function localShapePath(ck: CanvasKit, n: SceneNode): SkPath | null {
  const w = n.width, h = n.height;
  switch (n.type) {
    case 'ellipse': {
      const b = new ck.PathBuilder();
      b.addOval(ck.LTRBRect(0, 0, w, h));
      return b.detachAndDelete();
    }
    case 'line': {
      const b = new ck.PathBuilder();
      b.moveTo(0, 0).lineTo(w, h);
      return b.detachAndDelete();
    }
    case 'polygon':
    case 'star':
      return ck.Path.MakeFromSVGString(polygonPath(n, w, h));
    case 'path': {
      const p = n.d ? ck.Path.MakeFromSVGString(n.d) : null;
      if (p && n.fillRule === 'evenodd') p.setFillType(ck.FillType.EvenOdd);
      return p;
    }
    case 'text':
      return null;
    default: {
      const [tl, tr, br, bl] = radii(n);
      const b = new ck.PathBuilder();
      if (tl || tr || br || bl) b.addRRect(Float32Array.of(0, 0, w, h, tl, tl, tr, tr, br, br, bl, bl));
      else b.addRect(ck.LTRBRect(0, 0, w, h));
      return b.detachAndDelete();
    }
  }
}

function transformed(ck: CanvasKit, p: SkPath, m: Mat): SkPath {
  const b = new ck.PathBuilder();
  b.addPath(p, ...toSkMatrix(m));
  const out = b.detachAndDelete();
  out.setFillType(p.getFillType());
  return out;
}

function combine(ck: CanvasKit, paths: SkPath[], op: PathOp): SkPath | null {
  let acc: SkPath | null = paths[0].copy();
  for (const p of paths.slice(1)) {
    if (!acc) break;
    const next: SkPath | null = ck.Path.MakeFromOp(acc, p, op);
    acc.delete();
    acc = next;
  }
  return acc;
}

/** Contorno de um nó no espaço do pai (já com posição e rotação). */
function outline(ck: CanvasKit, raw: SceneNode, resolve: (n: SceneNode) => SceneNode): SkPath | null {
  if (raw.visible === false) return null;
  const n = resolve(raw);
  let local: SkPath | null;
  if (n.type === 'boolean') local = booleanPath(ck, n, resolve);
  else if (n.type === 'group') {
    const parts = n.children.map((c) => outline(ck, c, resolve)).filter(Boolean) as SkPath[];
    local = parts.length ? combine(ck, parts, ck.PathOp.Union) : null;
    parts.forEach((p) => p.delete());
  } else local = localShapePath(ck, n);
  if (!local) return null;
  const out = transformed(ck, local, nodeMatrix(n));
  local.delete();
  return out;
}

const OPS: Record<BooleanOp, keyof CanvasKit['PathOp']> = { union: 'Union', subtract: 'Difference', intersect: 'Intersect', exclude: 'XOR' };

/**
 * Resultado da operação booleana no espaço da própria camada booleana.
 * Subtrair: a camada de baixo menos todas as outras.
 */
export function booleanPath(ck: CanvasKit, node: ContainerNode, resolve: (n: SceneNode) => SceneNode = (n) => n): SkPath | null {
  const paths = node.children.map((c) => outline(ck, c, resolve)).filter(Boolean) as SkPath[];
  if (!paths.length) return null;
  const op = node.booleanOp ?? 'union';
  let result: SkPath | null;
  if (op === 'subtract' && paths.length > 1) {
    const rest = combine(ck, paths.slice(1), ck.PathOp.Union);
    result = rest ? ck.Path.MakeFromOp(paths[0], rest, ck.PathOp.Difference) : paths[0].copy();
    rest?.delete();
  } else result = combine(ck, paths, ck.PathOp[OPS[op]] as PathOp);
  paths.forEach((p) => p.delete());
  return result;
}

/**
 * Comandos do caminho em SVG. Cônicas (arcos que o Skia usa em elipses e cantos) viram uma
 * cúbica cada — o `toSVGString` do Skia as quebra em dezenas de quadráticas, o que deixa
 * o vetor com pontos demais para editar.
 */
function toSvg(ck: CanvasKit, p: SkPath): string {
  const c = p.toCmds();
  const f = (v: number) => String(Math.round(v * 1000) / 1000);
  const out: string[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < c.length; ) {
    const verb = c[i++];
    if (verb === ck.MOVE_VERB) {
      x = c[i++];
      y = c[i++];
      out.push(`M${f(x)} ${f(y)}`);
    } else if (verb === ck.LINE_VERB) {
      x = c[i++];
      y = c[i++];
      out.push(`L${f(x)} ${f(y)}`);
    } else if (verb === ck.QUAD_VERB) {
      out.push(`Q${f(c[i])} ${f(c[i + 1])} ${f(c[i + 2])} ${f(c[i + 3])}`);
      x = c[i + 2];
      y = c[i + 3];
      i += 4;
    } else if (verb === ck.CONIC_VERB) {
      const [px, py, ex, ey, w] = [c[i], c[i + 1], c[i + 2], c[i + 3], c[i + 4]];
      const k = (4 * w) / (3 * (1 + w)); // w = cos(45°) dá a constante clássica do círculo (0,5523)
      out.push(`C${f(x + k * (px - x))} ${f(y + k * (py - y))} ${f(ex + k * (px - ex))} ${f(ey + k * (py - ey))} ${f(ex)} ${f(ey)}`);
      x = ex;
      y = ey;
      i += 5;
    } else if (verb === ck.CUBIC_VERB) {
      out.push(`C${f(c[i])} ${f(c[i + 1])} ${f(c[i + 2])} ${f(c[i + 3])} ${f(c[i + 4])} ${f(c[i + 5])}`);
      x = c[i + 4];
      y = c[i + 5];
      i += 6;
    } else if (verb === ck.CLOSE_VERB) out.push('Z');
    else break;
  }
  return out.join(' ');
}

/** Caminho SVG e a regra de preenchimento (as operações do Skia costumam dar "par-ímpar"). */
export interface PathData {
  d: string;
  fillRule: 'nonzero' | 'evenodd';
}

function svgData(ck: CanvasKit, p: SkPath): PathData {
  const out: PathData = { d: toSvg(ck, p), fillRule: p.getFillType() === ck.FillType.EvenOdd ? 'evenodd' : 'nonzero' };
  p.delete();
  return out;
}

/** O mesmo resultado como caminho SVG (para gravar como vetor ou exportar). */
export function booleanPathData(ck: CanvasKit, node: ContainerNode, resolve?: (n: SceneNode) => SceneNode): PathData {
  const p = booleanPath(ck, node, resolve);
  return p ? svgData(ck, p) : { d: '', fillRule: 'nonzero' };
}

/** Contorno de qualquer forma como caminho SVG no espaço do nó (para "Converter em vetor"). */
export function outlineData(ck: CanvasKit, n: SceneNode, resolve?: (n: SceneNode) => SceneNode): PathData {
  if (n.type === 'boolean') return booleanPathData(ck, n, resolve);
  const p = localShapePath(ck, n);
  return p ? svgData(ck, p) : { d: '', fillRule: 'nonzero' };
}

/**
 * Caminho SVG levado por uma matriz e normalizado (só M/L/Q/C/Z: arcos viram curvas),
 * já começando em 0,0. Devolve também onde a caixa dele ficou. null = caminho inválido.
 */
export function normalizePath(ck: CanvasKit, d: string, m: Mat = [1, 0, 0, 1, 0, 0], evenOdd = false, keepOrigin = false): { d: string; x: number; y: number; width: number; height: number } | null {
  const src = ck.Path.MakeFromSVGString(d);
  if (!src) return null;
  const moved = transformed(ck, src, m);
  src.delete();
  try {
    const b = moved.computeTightBounds();
    if (![b[0], b[1], b[2], b[3]].every(Number.isFinite)) return null;
    const at0 = keepOrigin ? transformed(ck, moved, [1, 0, 0, 1, 0, 0]) : transformed(ck, moved, [1, 0, 0, 1, -b[0], -b[1]]);
    if (evenOdd) at0.setFillType(ck.FillType.EvenOdd);
    const out = { d: toSvg(ck, at0), x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] };
    at0.delete();
    return out;
  } finally {
    moved.delete();
  }
}
