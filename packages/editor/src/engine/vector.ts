// Edição de pontos de um vetor: arrastar pontos e alças, adicionar ponto clicando
// na linha, alternar canto/suave com duplo clique e apagar pontos selecionados.
import {
  apply,
  invert,
  parsePath,
  refitPath,
  splitSegment,
  toggleSmooth,
  deletePoints,
  segmentPoints,
  nearestOnSegment,
  type Mat,
  type Op,
  type PathNode,
  type Point,
  type Subpath,
} from '@zaliel/core';
import type { Editor } from '../editor';

export interface PointRef {
  sub: number;
  index: number;
}

export type VectorHit =
  | { kind: 'anchor'; sub: number; index: number }
  | { kind: 'in' | 'out'; sub: number; index: number }
  | { kind: 'segment'; sub: number; index: number; t: number };

interface VectorDrag {
  hit: VectorHit;
  start: Point; // local (espaço do nó no início)
  base: Subpath[];
  node0: Pick<PathNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>;
  world: Mat; // matriz do nó no início
  moved: boolean;
}

const same = (a: PointRef, b: PointRef) => a.sub === b.sub && a.index === b.index;

export class VectorTool {
  selected: PointRef[] = [];
  drag: VectorDrag | null = null;
  hover: VectorHit | null = null;

  constructor(private editor: Editor) {}

  clear(): void {
    this.selected = [];
    this.drag = null;
    this.hover = null;
  }

  node(): PathNode | null {
    const id = this.editor.vectorEdit;
    const n = id ? this.editor.model.index.get(id) : undefined;
    return n?.type === 'path' ? n : null;
  }

  subpaths(): Subpath[] {
    const n = this.node();
    return n ? parsePath(n.d) : [];
  }

  matrix(): Mat {
    const n = this.node();
    return n ? this.editor.model.index.worldMatrix(n.id) : [1, 0, 0, 1, 0, 0];
  }

  isSelected(sub: number, index: number): boolean {
    return this.selected.some((s) => s.sub === sub && s.index === index);
  }

  /** O que está embaixo do cursor (em px de tela). */
  hitTest(screen: Point): VectorHit | null {
    const ed = this.editor;
    const subs = this.subpaths();
    const m = this.matrix();
    const toScreen = (p: Point) => ed.worldToScreen(apply(m, p));
    const near = (p: Point, r: number) => {
      const s = toScreen(p);
      return Math.hypot(s.x - screen.x, s.y - screen.y) <= r;
    };
    // alças dos pontos selecionados (e dos vizinhos) primeiro
    for (const ref of this.handleOwners(subs)) {
      const p = subs[ref.sub]?.points[ref.index];
      if (!p) continue;
      if (p.in && near(p.in, 6)) return { kind: 'in', ...ref };
      if (p.out && near(p.out, 6)) return { kind: 'out', ...ref };
    }
    for (const [si, s] of subs.entries()) for (const [i, p] of s.points.entries()) if (near(p, 6)) return { kind: 'anchor', sub: si, index: i };
    // linha: distância medida no espaço do nó, convertida para px de tela
    const local = apply(invert(m), ed.screenToWorld(screen));
    const scale = ed.viewport.zoom * Math.hypot(m[0], m[1]);
    for (const [si, s] of subs.entries()) {
      for (let i = 0; i < s.points.length; i++) {
        const seg = segmentPoints(s, i);
        if (!seg) continue;
        const r = nearestOnSegment(seg, local);
        if (r.dist * scale <= 5 && r.t > 0.02 && r.t < 0.98) return { kind: 'segment', sub: si, index: i, t: r.t };
      }
    }
    return null;
  }

  /** Pontos que mostram alças: os selecionados e os vizinhos deles. */
  handleOwners(subs = this.subpaths()): PointRef[] {
    const out: PointRef[] = [];
    for (const s of this.selected) {
      const sp = subs[s.sub];
      if (!sp) continue;
      const n = sp.points.length;
      for (const d of [-1, 0, 1]) {
        let i = s.index + d;
        if (i < 0 || i >= n) {
          if (!sp.closed) continue;
          i = (i + n) % n;
        }
        if (!out.some((o) => o.sub === s.sub && o.index === i)) out.push({ sub: s.sub, index: i });
      }
    }
    return out;
  }

  /** Clique no modo de pontos. Devolve false se o clique foi fora do vetor (para sair do modo). */
  down(screen: Point, world: Point, shift: boolean): boolean {
    const n = this.node();
    if (!n) return false;
    let hit = this.hitTest(screen);
    let subs = this.subpaths();
    const m = this.matrix();
    if (hit?.kind === 'segment') {
      // clicar na linha cria um ponto ali
      subs = splitSegment(subs, hit.sub, hit.index, hit.t);
      this.commit(n, subs, 'Adicionar ponto');
      hit = { kind: 'anchor', sub: hit.sub, index: hit.index + 1 };
      this.selected = [{ sub: hit.sub, index: hit.index }];
      subs = this.subpaths();
    }
    if (!hit) {
      const local = apply(invert(m), world);
      const inside = local.x >= -4 && local.y >= -4 && local.x <= n.width + 4 && local.y <= n.height + 4;
      if (!inside) return false;
      this.selected = [];
      this.editor.emit('view');
      return true;
    }
    if (hit.kind === 'anchor') {
      const ref = { sub: hit.sub, index: hit.index };
      if (shift) this.selected = this.isSelected(ref.sub, ref.index) ? this.selected.filter((s) => !same(s, ref)) : [...this.selected, ref];
      else if (!this.isSelected(ref.sub, ref.index)) this.selected = [ref];
    }
    const node = this.node()!;
    this.drag = { hit, start: apply(invert(this.matrix()), world), base: subs, node0: { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation }, world: this.matrix(), moved: false };
    this.editor.emit('view');
    return true;
  }

  move(world: Point, alt: boolean, shift: boolean): void {
    const d = this.drag;
    const n = this.node();
    if (!d || !n) return;
    const p = apply(invert(d.world), world);
    let dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (shift && d.hit.kind === 'anchor') {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    if (!d.moved && Math.hypot(dx, dy) * this.editor.viewport.zoom < 1) return;
    d.moved = true;
    const subs = d.base.map((s) => ({ closed: s.closed, points: s.points.map((q) => ({ ...q, in: q.in && { ...q.in }, out: q.out && { ...q.out } })) }));
    const hit = d.hit;
    if (hit.kind === 'anchor') {
      for (const ref of this.selected) {
        const q = subs[ref.sub]?.points[ref.index];
        if (!q) continue;
        q.x += dx;
        q.y += dy;
        if (q.in) q.in = { x: q.in.x + dx, y: q.in.y + dy };
        if (q.out) q.out = { x: q.out.x + dx, y: q.out.y + dy };
      }
    } else if (hit.kind === 'in' || hit.kind === 'out') {
      const q = subs[hit.sub].points[hit.index];
      const h = { x: (q[hit.kind] ?? q).x + dx, y: (q[hit.kind] ?? q).y + dy };
      q[hit.kind] = h;
      // a alça oposta acompanha o ângulo (Alt solta as duas)
      const other = hit.kind === 'in' ? 'out' : 'in';
      const o = q[other];
      if (o && !alt) {
        const len = Math.hypot(o.x - q.x, o.y - q.y);
        const ang = Math.atan2(q.y - h.y, q.x - h.x);
        q[other] = { x: q.x + Math.cos(ang) * len, y: q.y + Math.sin(ang) * len };
      }
    }
    const fit = refitPath(d.node0, subs);
    this.apply(n.id, fit, 'Editar pontos', 'vector');
  }

  up(): void {
    if (this.drag) this.editor.model.seal();
    this.drag = null;
  }

  /** Duplo clique: alterna canto/suave no ponto. Devolve false se não acertou nada. */
  double(screen: Point): boolean {
    const n = this.node();
    const hit = this.hitTest(screen);
    if (!n || !hit || hit.kind !== 'anchor') return false;
    this.commit(n, toggleSmooth(this.subpaths(), hit.sub, hit.index), 'Alternar ponto');
    this.selected = [{ sub: hit.sub, index: hit.index }];
    return true;
  }

  deleteSelected(): boolean {
    const n = this.node();
    if (!n || !this.selected.length) return false;
    const next = deletePoints(this.subpaths(), this.selected);
    this.selected = [];
    if (!next.length) {
      // sem pontos não sobra vetor
      this.editor.exitVectorEdit();
      this.editor.run('Excluir', [{ op: 'remove', id: n.id }]);
      return true;
    }
    this.commit(n, next, 'Apagar pontos');
    return true;
  }

  /** Setas: movem os pontos selecionados. */
  nudge(dx: number, dy: number): boolean {
    const n = this.node();
    if (!n || !this.selected.length) return false;
    const inv = invert(this.matrix());
    const o = apply(inv, { x: 0, y: 0 }), v = apply(inv, { x: dx, y: dy });
    const lx = v.x - o.x, ly = v.y - o.y;
    const subs = this.subpaths();
    for (const ref of this.selected) {
      const q = subs[ref.sub]?.points[ref.index];
      if (!q) continue;
      q.x += lx;
      q.y += ly;
      if (q.in) q.in = { x: q.in.x + lx, y: q.in.y + ly };
      if (q.out) q.out = { x: q.out.x + lx, y: q.out.y + ly };
    }
    this.apply(n.id, refitPath(n, subs), 'Mover pontos', 'vector-nudge');
    return true;
  }

  private commit(n: PathNode, subs: Subpath[], label: string): void {
    this.apply(n.id, refitPath(n, subs), label);
    this.editor.model.seal();
  }

  private apply(id: string, fit: ReturnType<typeof refitPath>, label: string, merge?: string): void {
    const ops: Op[] = Object.entries(fit).map(([key, value]) => ({ op: 'set', id, key, value }) as Op);
    this.editor.model.transact(label, ops, { merge });
  }
}
