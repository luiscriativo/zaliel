// Mouse e teclado no canvas: selecionar, mover, redimensionar, girar, desenhar, caneta, mão e zoom.
import {
  apply,
  invert,
  multiply,
  nodeMatrix,
  normalizeRect,
  rectCorners,
  unionRects,
  applyConstraints,
  clone,
  createNode,
  boundsOf,
  scalePath,
  gridSnapEdges,
  type ContainerNode,
  type Mat,
  type Op,
  type Point,
  type Rect,
  type SceneNode,
  type TextNode,
} from '@zaliel/core';
import type { Editor, Tool } from '../editor';
import { marqueeSelect, pickInside, pickTarget, hitPath } from './hit';
import { VectorTool } from './vector';

/** Largura das réguas, em px de tela. */
export const RULER = 20;

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLE_DIR: Record<Handle, [number, number]> = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

export interface Guide {
  axis: 'x' | 'y';
  at: number; // coordenada na página
  from: number;
  to: number;
}

export interface PenPoint {
  p: Point;
  in?: Point; // alça de entrada (absoluta)
  out?: Point; // alça de saída (absoluta)
}

type Drag =
  | { kind: 'pan'; start: Point; vx: number; vy: number }
  | { kind: 'marquee'; start: Point; parent: string; base: string[]; additive: boolean }
  | { kind: 'move'; start: Point; items: MoveItem[]; startBox: Rect; moved: boolean; duplicated: boolean; alt: boolean }
  | { kind: 'reorder'; id: string; parent: string; start: Point }
  | { kind: 'resize'; handle: Handle; start: Point; items: ResizeItem[]; box: Rect; single: boolean }
  | { kind: 'rotate'; id: string; center: Point; startAngle: number; rot0: number }
  | { kind: 'create'; tool: Tool; start: Point }
  | { kind: 'pen-handle'; index: number }
  | { kind: 'guide'; axis: 'x' | 'y'; index: number | null; at: number }
  | { kind: 'vector' };

interface MoveItem {
  id: string;
  x: number;
  y: number;
  inv: Mat; // inverso da matriz do pai (para converter deslocamentos)
}

interface ResizeItem {
  id: string;
  node: SceneNode;
  world: Mat; // matriz do pai
  bounds: Rect; // caixa na página
}

const CURSORS: Record<string, string> = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};

export class Interaction {
  drag: Drag | null = null;
  pointer: Point = { x: 0, y: 0 }; // tela
  world: Point = { x: 0, y: 0 };
  marquee: Rect | null = null;
  preview: Rect | null = null;
  linePreview: [Point, Point] | null = null;
  guides: Guide[] = [];
  reorderLine: [Point, Point] | null = null;
  dropTarget: string | null = null;
  pen: PenPoint[] = [];
  space = false;
  vector: VectorTool;
  private downAt: Point = { x: 0, y: 0 };

  constructor(private editor: Editor, private el: HTMLElement, private onTextEdit: (id: string) => void) {
    this.vector = new VectorTool(editor);
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('dblclick', this.onDouble);
    el.addEventListener('pointerleave', () => editor.setHover(null));
  }

  destroy(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onUp);
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('dblclick', this.onDouble);
  }

  private local(e: PointerEvent | WheelEvent | MouseEvent): Point {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private redraw() {
    this.editor.host?.invalidate();
    this.editor.emit('view');
  }

  // ── Alças de seleção ───────────────────────────────────────────────────────

  /** Quadrilátero da seleção em coordenadas de tela + se é de um nó só (com rotação). */
  selectionQuad(): { pts: Point[]; single: boolean } | null {
    const ed = this.editor;
    const ids = ed.selection.filter((id) => ed.model.index.get(id));
    if (!ids.length) return null;
    if (ids.length === 1) {
      const n = ed.model.index.get(ids[0])!;
      const m = ed.model.index.worldMatrix(ids[0]);
      return { pts: rectCorners({ x: 0, y: 0, width: n.width, height: n.height }).map((p) => ed.worldToScreen(apply(m, p))), single: true };
    }
    const b = ed.selectionBounds()!;
    return { pts: rectCorners(b).map((p) => ed.worldToScreen(p)), single: false };
  }

  handles(): { h: Handle; p: Point }[] {
    const q = this.selectionQuad();
    if (!q) return [];
    const [a, b, c, d] = q.pts;
    const mid = (p: Point, r: Point) => ({ x: (p.x + r.x) / 2, y: (p.y + r.y) / 2 });
    const all: { h: Handle; p: Point }[] = [
      { h: 'nw', p: a }, { h: 'n', p: mid(a, b) }, { h: 'ne', p: b }, { h: 'e', p: mid(b, c) },
      { h: 'se', p: c }, { h: 's', p: mid(c, d) }, { h: 'sw', p: d }, { h: 'w', p: mid(d, a) },
    ];
    // linhas não têm altura: só as pontas
    const n = this.editor.selection.length === 1 ? this.editor.model.index.get(this.editor.selection[0]) : null;
    if (n?.type === 'line') return all.filter((x) => x.h === 'w' || x.h === 'e');
    const w = Math.hypot(b.x - a.x, b.y - a.y), h = Math.hypot(d.x - a.x, d.y - a.y);
    // seleção muito pequena: esconde as alças do meio
    return all.filter((x) => (x.h.length === 2 ? true : (x.h === 'n' || x.h === 's' ? w > 24 : h > 24)));
  }

  private handleAt(p: Point): { handle?: Handle; rotate?: boolean } {
    if (this.editor.tool !== 'move' || this.editor.editingText || this.editor.vectorEdit) return {};
    const hs = this.handles();
    for (const h of hs) if (Math.abs(p.x - h.p.x) <= 5 && Math.abs(p.y - h.p.y) <= 5) return { handle: h.h };
    const q = this.selectionQuad();
    if (q?.single) {
      for (const h of hs) if (h.h.length === 2) {
        const d = Math.hypot(p.x - h.p.x, p.y - h.p.y);
        if (d > 5 && d < 18 && !this.insideQuad(p, q.pts)) return { rotate: true };
      }
    }
    return {};
  }

  private insideQuad(p: Point, pts: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  // ── Guias e réguas ─────────────────────────────────────────────────────────

  /** Régua embaixo do cursor: "y" na de cima (cria guia horizontal), "x" na da esquerda. */
  private rulerAt(p: Point): 'x' | 'y' | null {
    if (!this.editor.settings.rulers) return null;
    if (p.y < RULER && p.x >= RULER) return 'y';
    if (p.x < RULER && p.y >= RULER) return 'x';
    return null;
  }

  /** Guia da página perto do cursor (em px de tela). */
  guideAt(p: Point): number | null {
    const ed = this.editor;
    const guides = ed.page.guides ?? [];
    for (let i = guides.length - 1; i >= 0; i--) {
      const g = guides[i];
      const s = ed.worldToScreen({ x: g.at, y: g.at });
      if (Math.abs((g.axis === 'x' ? s.x : s.y) - (g.axis === 'x' ? p.x : p.y)) <= 3) return i;
    }
    return null;
  }

  private guideValue(axis: 'x' | 'y', w: Point): number {
    const v = axis === 'x' ? w.x : w.y;
    // com pouco zoom, a guia anda de 1 em 1; com muito zoom, em frações
    const step = this.editor.viewport.zoom >= 8 ? 0.1 : 1;
    return Math.round(v / step) * step;
  }

  private finishGuide(d: Extract<Drag, { kind: 'guide' }>, p: Point) {
    const ed = this.editor;
    const guides = [...(ed.page.guides ?? [])];
    // soltar em cima da régua apaga a guia
    const onRuler = d.axis === 'y' ? p.y < RULER : p.x < RULER;
    if (d.index !== null) {
      if (onRuler) guides.splice(d.index, 1);
      else guides[d.index] = { axis: d.axis, at: d.at };
      ed.setGuides(guides, onRuler ? 'Remover guia' : 'Mover guia');
    } else if (!onRuler) ed.setGuides([...guides, { axis: d.axis, at: d.at }], 'Adicionar guia');
  }

  // ── Eventos ────────────────────────────────────────────────────────────────

  /** Elementos por cima do canvas (comentários, campos) que não são cliques no desenho. */
  private outside(e: Event): boolean {
    return !!(e.target as HTMLElement | null)?.closest?.('[data-no-canvas]');
  }

  /** Nome de frame (em cima de cada frame do topo) embaixo do ponto, em px de tela. */
  private frameLabelAt(p: Point): string | null {
    const labels = this.editor.host?.frameLabels ?? [];
    for (let i = labels.length - 1; i >= 0; i--) {
      const l = labels[i];
      const a = (-l.angle * Math.PI) / 180;
      const dx = p.x - l.x, dy = p.y - l.y;
      const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a);
      if (x >= -2 && x <= l.width && y >= -20 && y <= 1) return l.id;
    }
    return null;
  }

  private onDown = (e: PointerEvent) => {
    const ed = this.editor;
    if (ed.home || this.outside(e)) return;
    this.el.focus();
    const p = this.local(e);
    const w = ed.screenToWorld(p);
    this.downAt = p;
    this.pointer = p;
    this.world = w;
    if (e.button === 2) return; // menu de contexto trata
    this.el.setPointerCapture(e.pointerId);

    if (ed.tool === 'comment' && e.button === 0 && !this.space) {
      ed.startComment(w);
      return;
    }
    if (e.button === 1 || this.space || ed.tool === 'hand') {
      this.drag = { kind: 'pan', start: p, vx: ed.viewport.x, vy: ed.viewport.y };
      this.el.style.cursor = 'grabbing';
      return;
    }

    if (ed.tool === 'pen') return this.penDown(w);

    // réguas e guias
    const ruler = this.rulerAt(p);
    if (ruler) {
      this.drag = { kind: 'guide', axis: ruler, index: null, at: this.guideValue(ruler, w) };
      return;
    }

    // pontos do vetor em edição
    if (ed.vectorEdit) {
      if (this.vector.down(p, w, e.shiftKey)) {
        if (this.vector.drag) this.drag = { kind: 'vector' };
        return;
      }
      ed.exitVectorEdit();
    }

    if (ed.tool === 'move' && !this.handleAt(p).handle) {
      const gi = this.guideAt(p);
      if (gi !== null) {
        const g = ed.page.guides![gi];
        this.drag = { kind: 'guide', axis: g.axis, index: gi, at: g.at };
        return;
      }
    }

    if (ed.tool !== 'move') {
      this.drag = { kind: 'create', tool: ed.tool, start: w };
      return;
    }

    const hz = this.handleAt(p);
    if (hz.handle) return this.startResize(hz.handle, w);
    // clique no nome do frame: seleciona o frame (e arrastar move)
    const label = this.frameLabelAt(p);
    if (label) {
      if (e.shiftKey) {
        ed.toggleSelect(label);
        if (!ed.selection.includes(label)) return;
      } else if (!ed.selection.includes(label)) ed.select([label]);
      this.startMove(w, e.altKey);
      return;
    }
    if (hz.rotate) return this.startRotate(w);

    const target = pickTarget(ed, w, e.ctrlKey || e.metaKey);
    if (target) {
      if (e.shiftKey) {
        ed.toggleSelect(target);
        if (!ed.selection.includes(target)) return;
      } else if (!ed.selection.includes(target)) ed.select([target]);
      this.startMove(w, e.altKey);
      return;
    }
    // vazio: seleção por retângulo dentro do frame clicado (ou na página)
    const parent = ed.containerAt(w);
    const level = parent !== ed.pageId && !(ed.model.index.get(parent) as ContainerNode).children.length ? ed.pageId : parent;
    this.drag = { kind: 'marquee', start: w, parent: level, base: e.shiftKey ? [...ed.selection] : [], additive: e.shiftKey };
    if (!e.shiftKey) ed.select([]);
  };

  private onMove = (e: PointerEvent) => {
    const ed = this.editor;
    const p = this.local(e);
    const w = ed.screenToWorld(p);
    this.pointer = p;
    this.world = w;
    const d = this.drag;
    if (!d) {
      this.updateHover(p, w);
      if (ed.tool === 'pen' && this.pen.length) this.redraw();
      ed.emit('view');
      return;
    }
    switch (d.kind) {
      case 'guide':
        d.at = this.guideValue(d.axis, w);
        this.redraw();
        break;
      case 'vector':
        this.vector.move(w, e.altKey, e.shiftKey);
        this.redraw();
        break;
      case 'pan':
        ed.setViewport({ zoom: ed.viewport.zoom, x: d.vx + (p.x - d.start.x), y: d.vy + (p.y - d.start.y) });
        break;
      case 'marquee': {
        this.marquee = normalizeRect(d.start, w);
        const hit = marqueeSelect(ed, this.marquee, d.parent);
        ed.select(d.additive ? [...new Set([...d.base, ...hit])] : hit);
        this.redraw();
        break;
      }
      case 'move':
        if (!d.moved && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) < 3) return;
        this.doMove(d, w, e);
        break;
      case 'reorder':
        this.doReorder(d, w);
        break;
      case 'resize':
        this.doResize(d, w, e);
        break;
      case 'rotate': {
        let a = (Math.atan2(w.y - d.center.y, w.x - d.center.x) * 180) / Math.PI - d.startAngle + d.rot0;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        a = ((a % 360) + 540) % 360 - 180;
        ed.setProp([d.id], 'rotation', Math.round(a * 10) / 10 || undefined, 'rotate');
        break;
      }
      case 'create': {
        let r = normalizeRect(d.start, w);
        if (d.tool === 'line') {
          let end = w;
          if (e.shiftKey) end = snapAngle(d.start, w);
          this.linePreview = [d.start, end];
        } else {
          if (e.shiftKey) {
            const s = Math.max(r.width, r.height);
            r = { x: w.x < d.start.x ? d.start.x - s : d.start.x, y: w.y < d.start.y ? d.start.y - s : d.start.y, width: s, height: s };
          }
          if (e.altKey) r = { x: d.start.x - r.width, y: d.start.y - r.height, width: r.width * 2, height: r.height * 2 };
          this.preview = r;
        }
        this.redraw();
        break;
      }
      case 'pen-handle': {
        const pt = this.pen[d.index];
        pt.out = w;
        pt.in = { x: 2 * pt.p.x - w.x, y: 2 * pt.p.y - w.y };
        this.redraw();
        break;
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    const ed = this.editor;
    if (!this.drag && this.outside(e)) return;
    const d = this.drag;
    this.drag = null;
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      /* já liberado */
    }
    this.el.style.cursor = '';
    if (!d) return;
    const w = ed.screenToWorld(this.local(e));
    if (d.kind === 'guide') this.finishGuide(d, this.local(e));
    if (d.kind === 'vector') this.vector.up();
    if (d.kind === 'create') this.finishCreate(d, w, e);
    if (d.kind === 'move' && d.moved) this.finishMove(d, w);
    if (d.kind === 'move' && !d.moved && !e.shiftKey) {
      // clique simples num nó de uma seleção múltipla: fica só ele
      const t = pickTarget(ed, w, e.ctrlKey || e.metaKey);
      if (t && ed.selection.length > 1) ed.select([t]);
    }
    this.marquee = null;
    this.preview = null;
    this.linePreview = null;
    this.guides = [];
    this.reorderLine = null;
    this.dropTarget = null;
    ed.model.seal();
    this.redraw();
  };

  private onDouble = (e: MouseEvent) => {
    const ed = this.editor;
    if (this.outside(e)) return;
    if (ed.tool === 'pen') return this.finishPen(false);
    if (ed.tool !== 'move') return;
    const p = this.local(e);
    const w = ed.screenToWorld(p);
    if (ed.vectorEdit) {
      if (!this.vector.double(p)) ed.exitVectorEdit();
      this.redraw();
      return;
    }
    if (this.guideAt(p) !== null) return;
    // duplo clique no nome do frame: renomear
    const label = this.frameLabelAt(p);
    if (label) {
      ed.select([label]);
      return ed.renameLayer();
    }
    const sel = ed.selection.length === 1 ? ed.model.index.get(ed.selection[0]) : null;
    if (sel?.type === 'text') return this.onTextEdit(sel.id);
    if (sel?.type === 'path' && pickTarget(ed, w, true) === sel.id) return ed.enterVectorEdit(sel.id);
    if (sel?.type === 'instance') {
      // texto dentro da instância: edita o override
      const path = hitPath(ed, w, 2 / ed.viewport.zoom);
      const inner = path[path.length - 1];
      if (inner && ed.isInner(inner)) {
        const n = findResolved(ed, sel.id, inner);
        if (n?.type === 'text') return this.onTextEdit(inner);
      }
      return;
    }
    if (sel && 'children' in sel) {
      const inside = pickInside(ed, w, sel.id);
      if (inside) {
        ed.scope = sel.id;
        ed.select([inside]);
      }
      return;
    }
    const t = pickTarget(ed, w, true);
    if (t && ed.model.index.get(t)?.type === 'text') {
      ed.select([t]);
      this.onTextEdit(t);
    }
  };

  private onWheel = (e: WheelEvent) => {
    const ed = this.editor;
    if (ed.home) return;
    e.preventDefault();
    const p = this.local(e);
    if (e.ctrlKey || e.metaKey) {
      // pinça do touchpad chega como ctrl+roda
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * (Math.abs(e.deltaY) > 50 ? 1 : 2));
      ed.zoomAt(factor, p);
    } else {
      const k = e.deltaMode === 1 ? 20 : 1;
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      ed.setViewport({ zoom: ed.viewport.zoom, x: ed.viewport.x - dx * k, y: ed.viewport.y - dy * k });
    }
  };

  private updateHover(p: Point, w: Point) {
    const ed = this.editor;
    const ruler = this.rulerAt(p);
    if (ruler && !this.space && ed.tool !== 'hand') {
      this.el.style.cursor = ruler === 'y' ? 'ns-resize' : 'ew-resize';
      ed.setHover(null);
      return;
    }
    if (ed.vectorEdit && ed.tool === 'move' && !this.space) {
      const hit = this.vector.hitTest(p);
      const before = JSON.stringify(this.vector.hover);
      this.vector.hover = hit;
      this.el.style.cursor = hit?.kind === 'segment' ? 'copy' : hit ? 'move' : 'default';
      if (JSON.stringify(hit) !== before) this.redraw();
      ed.setHover(null);
      return;
    }
    if (ed.tool !== 'move' || this.space) {
      this.el.style.cursor = this.space || ed.tool === 'hand' ? 'grab' : ed.tool === 'text' ? 'text' : 'crosshair';
      ed.setHover(null);
      return;
    }
    const hz = this.handleAt(p);
    if (hz.handle) {
      const n = ed.selection.length === 1 ? ed.model.index.get(ed.selection[0]) : null;
      this.el.style.cursor = rotatedCursor(hz.handle, n?.rotation ?? 0);
      ed.setHover(null);
      return;
    }
    const label = this.frameLabelAt(p);
    if (label) {
      this.el.style.cursor = '';
      ed.setHover(label);
      return;
    }
    const gi = this.guideAt(p);
    if (gi !== null && !hz.rotate) {
      this.el.style.cursor = ed.page.guides![gi].axis === 'x' ? 'ew-resize' : 'ns-resize';
      ed.setHover(null);
      return;
    }
    this.el.style.cursor = hz.rotate ? ROTATE_CURSOR : '';
    ed.setHover(pickTarget(ed, w, false));
  }

  // ── Mover ──────────────────────────────────────────────────────────────────

  private startMove(w: Point, alt: boolean) {
    const ed = this.editor;
    const ids = ed.topLevel(ed.selection).filter((id) => !ed.model.index.get(id)?.locked);
    if (!ids.length) return;
    // filho de auto layout: arrastar reordena
    if (ids.length === 1 && !alt) {
      const n = ed.model.index.get(ids[0])!;
      const parent = ed.model.index.parentId(ids[0])!;
      const pn = ed.model.index.get(parent);
      if (pn && 'layout' in pn && pn.layout && !n.absolute) {
        this.drag = { kind: 'reorder', id: n.id, parent, start: w };
        return;
      }
    }
    this.drag = { kind: 'move', start: w, items: this.moveItems(ids), startBox: unionRects(ids.map((id) => ed.worldBounds(id))), moved: false, duplicated: false, alt };
  }

  private moveItems(ids: string[]): MoveItem[] {
    const ed = this.editor;
    return ids.map((id) => {
      const n = ed.model.index.get(id)!;
      const pm = ed.model.index.parentMatrix(id);
      const inv = invert([pm[0], pm[1], pm[2], pm[3], 0, 0]);
      return { id, x: n.x, y: n.y, inv };
    });
  }

  private doMove(d: Extract<Drag, { kind: 'move' }>, w: Point, e: PointerEvent) {
    const ed = this.editor;
    if (!d.moved) {
      d.moved = true;
      if (d.alt && !d.duplicated) {
        // alt+arrastar duplica e move a cópia
        ed.duplicate(0);
        d.items = this.moveItems(ed.topLevel(ed.selection));
        d.duplicated = true;
      }
    }
    let dx = w.x - d.start.x, dy = w.y - d.start.y;
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    // encaixe nas bordas/centros dos vizinhos
    const box = { ...d.startBox, x: d.startBox.x + dx, y: d.startBox.y + dy };
    const snap = this.snap(box, new Set(d.items.map((i) => i.id)), e.ctrlKey || e.metaKey);
    dx += snap.dx;
    dy += snap.dy;
    this.guides = snap.guides;
    const ops: Op[] = [];
    for (const it of d.items) {
      const local = apply(it.inv, { x: dx, y: dy });
      ops.push({ op: 'set', id: it.id, key: 'x', value: Math.round((it.x + local.x) * 100) / 100 }, { op: 'set', id: it.id, key: 'y', value: Math.round((it.y + local.y) * 100) / 100 });
    }
    ed.model.transact('Mover', ops, { merge: 'move' });
    // destino ao soltar (para entrar/sair de frames)
    const exclude = new Set(d.items.map((i) => i.id));
    this.dropTarget = ed.containerAt(w, exclude);
    this.redraw();
  }

  private finishMove(d: Extract<Drag, { kind: 'move' }>, w: Point) {
    const ed = this.editor;
    const exclude = new Set(d.items.map((i) => i.id));
    const target = ed.containerAt(w, exclude);
    const ids = d.items.map((i) => i.id).filter((id) => ed.model.index.parentId(id) !== target);
    if (!ids.length) return;
    const tn = ed.model.index.get(target);
    if (ids.some((id) => id === target || ed.model.index.isAncestor(id, target))) return;
    const list = ed.model.index.siblings(target) ?? [];
    let index = list.length;
    if (tn && 'layout' in tn && tn.layout) index = this.layoutIndex(tn as ContainerNode, w, null);
    const ops: Op[] = [];
    ids.forEach((id, i) => {
      const b = ed.worldBounds(id);
      const n = ed.model.index.get(id)!;
      const local = ed.toLocal(target, { x: b.x, y: b.y });
      ops.push({ op: 'move', id, parent: target, index: index + i });
      if (!n.rotation) ops.push({ op: 'set', id, key: 'x', value: Math.round(local.x) }, { op: 'set', id, key: 'y', value: Math.round(local.y) });
    });
    ed.model.transact('Mover', ops, { merge: 'move' });
  }

  /** Índice de inserção dentro de um auto layout pela posição do cursor. */
  private layoutIndex(parent: ContainerNode, w: Point, skip: string | null): number {
    const ed = this.editor;
    const horiz = parent.layout!.direction === 'horizontal';
    const kids = parent.children.filter((c) => c.id !== skip && c.visible !== false && !c.absolute);
    let i = 0;
    for (const c of kids) {
      const b = ed.worldBounds(c.id);
      const mid = horiz ? b.x + b.width / 2 : b.y + b.height / 2;
      if ((horiz ? w.x : w.y) > mid) i++;
    }
    // converte para índice na lista completa (contando os ignorados)
    const target = kids[i];
    const full = parent.children.filter((c) => c.id !== skip);
    return target ? full.indexOf(target) : full.length;
  }

  private doReorder(d: Extract<Drag, { kind: 'reorder' }>, w: Point) {
    const ed = this.editor;
    const parent = ed.model.index.get(d.parent) as ContainerNode | undefined;
    if (!parent) return;
    const pb = ed.worldBounds(parent.id);
    const outside = w.x < pb.x - 8 || w.y < pb.y - 8 || w.x > pb.x + pb.width + 8 || w.y > pb.y + pb.height + 8;
    if (outside) {
      // saiu do auto layout: vira movimento livre
      const n = ed.model.index.get(d.id)!;
      const b = ed.worldBounds(d.id);
      const target = ed.containerAt(w, new Set([d.id]));
      const local = ed.toLocal(target, { x: w.x - b.width / 2, y: w.y - b.height / 2 });
      const tn = ed.model.index.get(target);
      if (tn && 'layout' in tn && tn.layout) return;
      ed.model.transact('Mover', [
        { op: 'move', id: n.id, parent: target, index: (ed.model.index.siblings(target) ?? []).length },
        { op: 'set', id: n.id, key: 'x', value: Math.round(local.x) },
        { op: 'set', id: n.id, key: 'y', value: Math.round(local.y) },
      ], { merge: 'move' });
      this.drag = { kind: 'move', start: w, items: this.moveItems([n.id]), startBox: ed.worldBounds(n.id), moved: true, duplicated: false, alt: false };
      this.redraw();
      return;
    }
    const index = this.layoutIndex(parent, w, d.id);
    const cur = parent.children.findIndex((c) => c.id === d.id);
    if (index !== cur) ed.model.transact('Reordenar', [{ op: 'move', id: d.id, parent: d.parent, index }], { merge: 'move' });
    this.redraw();
  }

  // ── Encaixe ────────────────────────────────────────────────────────────────

  snap(box: Rect, exclude: Set<string>, disabled = false): { dx: number; dy: number; guides: Guide[] } {
    const ed = this.editor;
    if (disabled || !ed.settings.snapping) return { dx: 0, dy: 0, guides: [] };
    const first = [...exclude][0];
    const parent = first ? ed.model.index.parentId(first) : ed.pageId;
    const others: Rect[] = [];
    const siblings = ((parent && ed.model.index.siblings(parent)) ?? []) as SceneNode[];
    for (const s of siblings) if (!exclude.has(s.id) && s.visible !== false) others.push(ed.worldBounds(s.id));
    if (parent && parent !== ed.pageId) others.push(ed.worldBounds(parent));
    // frames do topo também servem de referência
    if (parent === ed.pageId) for (const f of ed.page.children) if (!exclude.has(f.id) && 'children' in f) for (const c of f.children) others.push(ed.worldBounds(c.id));
    // guias da página e colunas/linhas da grade de layout do frame pai (só valem num eixo)
    const lineXs: number[] = [], lineYs: number[] = [];
    for (const g of ed.page.guides ?? []) (g.axis === 'x' ? lineXs : lineYs).push(g.at);
    const pn = parent ? ed.model.index.get(parent) : undefined;
    if (pn && 'grids' in pn && pn.grids?.length && ed.settings.layoutGrids && !pn.rotation) {
      const fb = ed.worldBounds(pn.id);
      const edges = gridSnapEdges(pn.grids, pn.width, pn.height);
      lineXs.push(...edges.xs.map((x) => fb.x + x));
      lineYs.push(...edges.ys.map((y) => fb.y + y));
    }
    const th = 6 / ed.viewport.zoom;
    const xs = [box.x, box.x + box.width / 2, box.x + box.width];
    const ys = [box.y, box.y + box.height / 2, box.y + box.height];
    let bestX: { d: number; at: number; r: Rect } | null = null;
    let bestY: { d: number; at: number; r: Rect } | null = null;
    for (const lx of lineXs) for (const x of xs) {
      const d = lx - x;
      if (Math.abs(d) <= th && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: lx, r: { x: lx, y: box.y, width: 0, height: box.height } };
    }
    for (const ly of lineYs) for (const y of ys) {
      const d = ly - y;
      if (Math.abs(d) <= th && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: ly, r: { x: box.x, y: ly, width: box.width, height: 0 } };
    }
    for (const r of others) {
      for (const cx of [r.x, r.x + r.width / 2, r.x + r.width]) for (const x of xs) {
        const d = cx - x;
        if (Math.abs(d) <= th && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: cx, r };
      }
      for (const cy of [r.y, r.y + r.height / 2, r.y + r.height]) for (const y of ys) {
        const d = cy - y;
        if (Math.abs(d) <= th && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: cy, r };
      }
    }
    const guides: Guide[] = [];
    const moved = { ...box, x: box.x + (bestX?.d ?? 0), y: box.y + (bestY?.d ?? 0) };
    if (bestX) guides.push({ axis: 'x', at: bestX.at, from: Math.min(moved.y, bestX.r.y), to: Math.max(moved.y + moved.height, bestX.r.y + bestX.r.height) });
    if (bestY) guides.push({ axis: 'y', at: bestY.at, from: Math.min(moved.x, bestY.r.x), to: Math.max(moved.x + moved.width, bestY.r.x + bestY.r.width) });
    return { dx: bestX?.d ?? 0, dy: bestY?.d ?? 0, guides };
  }

  // ── Redimensionar ──────────────────────────────────────────────────────────

  private startResize(handle: Handle, w: Point) {
    const ed = this.editor;
    const ids = ed.topLevel(ed.selection).filter((id) => !ed.model.index.get(id)?.locked);
    if (!ids.length) return;
    const items = ids.map((id) => ({ id, node: clone(ed.model.index.get(id)!), world: ed.model.index.parentMatrix(id), bounds: ed.worldBounds(id) }));
    this.drag = { kind: 'resize', handle, start: w, items, box: unionRects(items.map((i) => i.bounds)), single: ids.length === 1 };
  }

  private doResize(d: Extract<Drag, { kind: 'resize' }>, w: Point, e: PointerEvent) {
    const ed = this.editor;
    const [hx, hy] = HANDLE_DIR[d.handle];
    const ops: Op[] = [];
    const keepRatio = e.shiftKey;
    const fromCenter = e.altKey;

    if (d.single) {
      const it = d.items[0];
      const n0 = it.node;
      const W0 = multiply(it.world, nodeMatrix(n0));
      // encaixe só para nós sem rotação
      let pw = w;
      this.guides = [];
      if (!n0.rotation && !(e.ctrlKey || e.metaKey)) {
        const probe = { x: pw.x, y: pw.y, width: 0, height: 0 };
        const s = this.snap(probe, new Set([n0.id]));
        pw = { x: hx ? pw.x + s.dx : pw.x, y: hy ? pw.y + s.dy : pw.y };
        this.guides = s.guides.filter((g) => (g.axis === 'x' ? hx : hy));
      }
      const lp = apply(invert(W0), pw);
      let l = 0, t = 0, r = n0.width, b = n0.height;
      if (n0.type === 'line') {
        // linha: as pontas mexem no comprimento e no ângulo
        const a = apply(W0, { x: 0, y: 0 }), z = apply(W0, { x: n0.width, y: 0 });
        const fixed = d.handle === 'e' ? a : z;
        let moving = w;
        if (e.shiftKey) moving = snapAngle(fixed, w);
        const [p0, p1] = d.handle === 'e' ? [fixed, moving] : [moving, fixed];
        const g = lineGeometry(ed.toLocal(ed.model.index.parentId(n0.id)!, p0), ed.toLocal(ed.model.index.parentId(n0.id)!, p1));
        ed.model.transact('Redimensionar', Object.entries(g).map(([key, value]) => ({ op: 'set', id: n0.id, key, value }) as Op), { merge: 'resize' });
        this.redraw();
        return;
      }
      if (hx === -1) l = lp.x;
      if (hx === 1) r = lp.x;
      if (hy === -1) t = lp.y;
      if (hy === 1) b = lp.y;
      if (fromCenter) {
        if (hx) { const dxl = hx === 1 ? r - n0.width : -l; l = -dxl; r = n0.width + dxl; }
        if (hy) { const dyl = hy === 1 ? b - n0.height : -t; t = -dyl; b = n0.height + dyl; }
      }
      let nw = r - l, nh = b - t;
      if (keepRatio && n0.width && n0.height) {
        const ratio = n0.width / n0.height;
        if (!hy) nh = Math.abs(nw) / ratio * Math.sign(nh || 1);
        else if (!hx) nw = Math.abs(nh) * ratio * Math.sign(nw || 1);
        else if (Math.abs(nw) / n0.width > Math.abs(nh) / n0.height) nh = (Math.abs(nw) / ratio) * Math.sign(nh || 1);
        else nw = Math.abs(nh) * ratio * Math.sign(nw || 1);
        if (hx === -1) l = r - nw; else if (hx === 1) r = l + nw; else { const c = n0.width / 2; l = c - nw / 2; r = c + nw / 2; }
        if (hy === -1) t = b - nh; else if (hy === 1) b = t + nh; else { const c = n0.height / 2; t = c - nh / 2; b = c + nh / 2; }
      }
      // sem espelhar: tamanho mínimo de 1px
      if (r - l < 1) { if (hx === -1) l = r - 1; else r = l + 1; }
      if (b - t < 1) { if (hy === -1) t = b - 1; else b = t + 1; }
      nw = r - l;
      nh = b - t;
      const center = apply(nodeMatrix(n0), { x: (l + r) / 2, y: (t + b) / 2 });
      const x = Math.round((center.x - nw / 2) * 100) / 100;
      const y = Math.round((center.y - nh / 2) * 100) / 100;
      ops.push(...this.sizeOps(n0, x, y, nw, nh, hx !== 0, hy !== 0));
    } else {
      // vários: escala a caixa total
      const B = d.box;
      let l = B.x, t = B.y, r = B.x + B.width, b = B.y + B.height;
      if (hx === -1) l = Math.min(w.x, r - 1);
      if (hx === 1) r = Math.max(w.x, l + 1);
      if (hy === -1) t = Math.min(w.y, b - 1);
      if (hy === 1) b = Math.max(w.y, t + 1);
      let sx = (r - l) / B.width, sy = (b - t) / B.height;
      if (keepRatio) {
        const s = hx && hy ? Math.max(sx, sy) : hx ? sx : sy;
        sx = sy = s;
        if (hx === -1) l = r - B.width * s;
        if (hy === -1) t = b - B.height * s;
      }
      for (const it of d.items) {
        const nb = { x: l + (it.bounds.x - B.x) * sx, y: t + (it.bounds.y - B.y) * sy };
        const local = apply(invert(it.world), nb);
        ops.push(...this.sizeOps(it.node, local.x, local.y, it.node.width * sx, it.node.height * sy, true, true));
      }
    }
    ed.model.transact('Redimensionar', ops, { merge: 'resize' });
    this.redraw();
  }

  /** Operações para mudar tamanho/posição de um nó (com constraints, textos e auto layout). */
  private sizeOps(n0: SceneNode, x: number, y: number, w: number, h: number, changedW: boolean, changedH: boolean): Op[] {
    const ed = this.editor;
    const cur = ed.model.index.get(n0.id)!;
    const ops: Op[] = [
      { op: 'set', id: n0.id, key: 'x', value: Math.round(x * 100) / 100 },
      { op: 'set', id: n0.id, key: 'y', value: Math.round(y * 100) / 100 },
      { op: 'set', id: n0.id, key: 'width', value: Math.round(w * 100) / 100 },
      { op: 'set', id: n0.id, key: 'height', value: Math.round(h * 100) / 100 },
    ];
    // vetor: o desenho acompanha o novo tamanho
    if (cur.type === 'path' && n0.type === 'path' && n0.width > 0 && n0.height > 0 && n0.d) {
      ops.push({ op: 'set', id: n0.id, key: 'd', value: scalePath(n0.d, w / n0.width, h / n0.height) });
    }
    // texto em caminho: a curva acompanha o novo tamanho
    if (cur.type === 'text' && n0.type === 'text' && n0.textPath && n0.width > 0 && n0.height > 0) {
      ops.push({ op: 'set', id: n0.id, key: 'textPath', value: { ...n0.textPath, d: scalePath(n0.textPath.d, w / n0.width, h / n0.height) } });
    }
    if (cur.type === 'text') {
      const t = cur as TextNode;
      const mode = changedH ? 'none' : changedW && t.autoResize === 'width' ? 'height' : t.autoResize;
      if (mode !== t.autoResize) ops.push({ op: 'set', id: n0.id, key: 'autoResize', value: mode });
    }
    // mexer no tamanho desliga o "hug" daquele eixo
    if (cur.sizing) {
      const s = { ...cur.sizing };
      if (changedW && s.horizontal === 'hug') s.horizontal = 'fixed';
      if (changedH && s.vertical === 'hug') s.vertical = 'fixed';
      if (changedW && s.horizontal === 'fill') s.horizontal = 'fixed';
      if (changedH && s.vertical === 'fill') s.vertical = 'fixed';
      if (s.horizontal !== cur.sizing.horizontal || s.vertical !== cur.sizing.vertical) ops.push({ op: 'set', id: n0.id, key: 'sizing', value: s });
    }
    // constraints dos filhos (frames sem auto layout)
    if ((cur.type === 'frame' || cur.type === 'component') && !cur.layout) {
      const copy = clone(cur) as ContainerNode;
      copy.width = w;
      copy.height = h;
      const ctx = { changes: [] as { id: string; key: string; value: unknown }[] };
      applyConstraints(copy, cur.width, cur.height, ctx as never);
      for (const ch of ctx.changes) ops.push({ op: 'set', id: ch.id, key: ch.key, value: ch.value });
    }
    return ops;
  }

  // ── Girar ──────────────────────────────────────────────────────────────────

  private startRotate(w: Point) {
    const ed = this.editor;
    const id = ed.selection[0];
    const n = ed.model.index.get(id);
    if (!n) return;
    const m = ed.model.index.worldMatrix(id);
    const center = apply(m, { x: n.width / 2, y: n.height / 2 });
    this.drag = { kind: 'rotate', id, center, startAngle: (Math.atan2(w.y - center.y, w.x - center.x) * 180) / Math.PI, rot0: n.rotation ?? 0 };
  }

  // ── Criar formas ───────────────────────────────────────────────────────────

  private finishCreate(d: Extract<Drag, { kind: 'create' }>, w: Point, e: PointerEvent) {
    const ed = this.editor;
    const dragged = Math.hypot(this.pointer.x - this.downAt.x, this.pointer.y - this.downAt.y) > 3;
    if (d.tool === 'line') {
      const end = dragged ? (e.shiftKey ? snapAngle(d.start, w) : w) : { x: d.start.x + 100, y: d.start.y };
      const parent = ed.containerAt(d.start);
      const g = lineGeometry(ed.toLocal(parent, d.start), ed.toLocal(parent, end));
      const node = createNode('line', { x: g.x, y: g.y, width: g.width, height: 0 }, { rotation: g.rotation });
      ed.insert(node, parent, undefined, 'Criar linha');
      ed.setTool('move');
      return;
    }
    let r = this.preview ?? normalizeRect(d.start, w);
    if (!dragged) {
      if (d.tool === 'text') {
        const node = ed.createAt('text', { x: d.start.x, y: d.start.y - 10, width: 1, height: 1 });
        ed.setTool('move');
        if (node) this.onTextEdit(node.id);
        return;
      }
      const size = d.tool === 'frame' ? { width: 400, height: 300 } : { width: 100, height: 100 };
      r = { x: d.start.x, y: d.start.y, ...size };
    }
    r = { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
    const node = ed.createAt(d.tool, r);
    if (node?.type === 'text') {
      ed.setProp([node.id], 'autoResize', 'height');
      this.onTextEdit(node.id);
    }
    ed.setTool('move');
  }

  // ── Caneta ─────────────────────────────────────────────────────────────────

  private penDown(w: Point) {
    const first = this.pen[0];
    if (first && this.pen.length > 2 && Math.hypot(w.x - first.p.x, w.y - first.p.y) * this.editor.viewport.zoom < 8) {
      this.finishPen(true);
      return;
    }
    this.pen.push({ p: w });
    this.drag = { kind: 'pen-handle', index: this.pen.length - 1 };
    this.redraw();
  }

  /** Termina o desenho da caneta e cria a camada de vetor. */
  finishPen(close: boolean): void {
    const ed = this.editor;
    const pts = this.pen;
    this.pen = [];
    if (pts.length < 2) {
      this.redraw();
      return;
    }
    const all = pts.flatMap((p) => [p.p, ...(p.in ? [p.in] : []), ...(p.out ? [p.out] : [])]);
    const b = boundsOf(all);
    const ox = b.x, oy = b.y;
    const f = (p: Point) => `${round2(p.x - ox)} ${round2(p.y - oy)}`;
    let d = `M${f(pts[0].p)}`;
    const seg = (a: PenPoint, z: PenPoint) => (a.out || z.in ? ` C${f(a.out ?? a.p)} ${f(z.in ?? z.p)} ${f(z.p)}` : ` L${f(z.p)}`);
    for (let i = 1; i < pts.length; i++) d += seg(pts[i - 1], pts[i]);
    if (close) d += seg(pts[pts.length - 1], pts[0]) + ' Z';
    const parent = ed.containerAt(pts[0].p);
    const local = ed.toLocal(parent, { x: ox, y: oy });
    const node = createNode('path', { x: Math.round(local.x * 100) / 100, y: Math.round(local.y * 100) / 100, width: Math.max(1, round2(b.width)), height: Math.max(1, round2(b.height)) }, {
      d,
      ...(close ? { fills: [{ type: 'solid', color: '#d9d4ca' }] } : {}),
    });
    ed.insert(node, parent, undefined, 'Desenhar vetor');
    ed.setTool('move');
    this.redraw();
  }

  cancel(): boolean {
    if (this.drag?.kind === 'guide') {
      this.drag = null;
      this.redraw();
      return true;
    }
    if (this.pen.length) {
      this.finishPen(false);
      return true;
    }
    if (this.drag) {
      this.drag = null;
      this.marquee = this.preview = null;
      this.guides = [];
      this.redraw();
      return true;
    }
    return false;
  }
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

function snapAngle(a: Point, b: Point): Point {
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

/** Linha de p0 a p1 como (x, y, comprimento, rotação em torno do centro). */
export function lineGeometry(p0: Point, p1: Point) {
  const len = Math.max(1, Math.hypot(p1.x - p0.x, p1.y - p0.y));
  const rot = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
  const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
  return { x: round2(cx - len / 2), y: round2(cy), width: round2(len), rotation: round2(rot) || undefined } as { x: number; y: number; width: number; rotation?: number };
}

function findResolved(ed: Editor, instanceId: string, innerId: string): SceneNode | null {
  const inst = ed.model.index.get(instanceId);
  if (!inst) return null;
  const r = ed.resolve(inst);
  let found: SceneNode | null = null;
  const visit = (list: SceneNode[]) => list.forEach((n) => {
    if (n.id === innerId) found = n;
    if ('children' in n) visit(n.children);
  });
  if ('children' in r) visit(r.children);
  return found;
}

export { findResolved };

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 12a7 7 0 0 1 12-4.9M19 12a7 7 0 0 1-12 4.9" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"/><path d="M5 12a7 7 0 0 1 12-4.9M19 12a7 7 0 0 1-12 4.9" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round"/><path d="M17 3v4.2h-4.2M7 21v-4.2h4.2" fill="none" stroke="black" stroke-width="1.5"/></svg>')}") 12 12, crosshair`;

function rotatedCursor(h: Handle, rotation: number): string {
  const order: Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const i = (order.indexOf(h) + Math.round((((rotation % 360) + 360) % 360) / 45)) % 8;
  return CURSORS[order[i]];
}
