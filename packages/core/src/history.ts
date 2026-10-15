// Modelo editável: documento + índice + histórico (desfazer/refazer).
// Toda mudança passa por `transact`, que aplica as operações, roda o layout
// e guarda as inversas como um passo único do histórico.
import type { SceneNode, ZalDocument } from './types';
import { DocIndex } from './document';
import { applyOp, type Op } from './ops';
import { layoutNode, type Change, type MeasureText } from './layout';

export interface Step {
  label: string;
  undo: Op[]; // em ordem de aplicação
  redo: Op[];
  selection?: string[];
}

type Listener = (info: { label: string; ops: Op[] }) => void;

export class Model {
  index: DocIndex;
  past: Step[] = [];
  future: Step[] = [];
  /** Muda a cada alteração; a interface observa isto para se atualizar. */
  revision = 0;
  /** Passo do histórico que corresponde ao que está gravado no disco. */
  private savedStep: Step | null | undefined = null;
  measureText?: MeasureText;
  private listeners = new Set<Listener>();
  private limit = 300;
  private mergeKey: string | null = null;
  private mergeAt = 0;

  constructor(public doc: ZalDocument) {
    this.index = new DocIndex(doc);
  }

  /** Há alterações não salvas? Desfazer até o ponto salvo volta a "salvo". */
  get dirty(): boolean {
    return this.savedStep !== (this.past[this.past.length - 1] ?? null);
  }

  markSaved(): void {
    this.mergeKey = null; // o próximo passo não pode se fundir com o que já foi salvo
    this.savedStep = this.past[this.past.length - 1] ?? null;
  }

  /** Força "não salvo" (ex.: trabalho recuperado). */
  markDirty(): void {
    this.savedStep = undefined;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(label: string, ops: Op[]) {
    this.revision++;
    for (const l of this.listeners) l({ label, ops });
  }

  /**
   * Aplica um conjunto de operações como um passo do histórico.
   * `merge`: passos seguidos com a mesma chave (ex.: arrastar um slider) viram um só.
   */
  transact(label: string, ops: Op[], opts: { merge?: string; selection?: string[]; layout?: boolean } = {}): Op[] {
    if (!ops.length) return [];
    const undo: Op[] = [];
    const redo: Op[] = [];
    try {
      for (const op of ops) {
        undo.unshift(applyOp(this.doc, this.index, op));
        redo.push(op);
      }
    } catch (e) {
      // desfaz o que já tinha sido aplicado e repassa o erro
      for (const op of undo) applyOp(this.doc, this.index, op);
      throw e;
    }
    if (opts.layout !== false) {
      for (const ch of this.relayout(ops)) {
        const op: Op = { op: 'set', id: ch.id, key: ch.key, value: ch.value };
        undo.unshift({ op: 'set', id: ch.id, key: ch.key, value: ch.old });
        redo.push(op);
      }
    }
    const now = Date.now();
    const last = this.past[this.past.length - 1];
    if (opts.merge && last && this.mergeKey === opts.merge && now - this.mergeAt < 1200) {
      last.undo = [...undo, ...last.undo];
      last.redo = [...last.redo, ...redo];
    } else {
      this.past.push({ label, undo, redo, selection: opts.selection });
      if (this.past.length > this.limit) this.past.shift();
    }
    this.mergeKey = opts.merge ?? null;
    this.mergeAt = now;
    this.future = [];
    this.emit(label, redo);
    return redo;
  }

  /** Interrompe a fusão de passos (ex.: ao soltar o mouse). */
  seal(): void {
    this.mergeKey = null;
  }

  undo(): Step | null {
    const step = this.past.pop();
    if (!step) return null;
    for (const op of step.undo) applyOp(this.doc, this.index, op);
    this.future.push(step);
    this.mergeKey = null;
    this.emit(`Desfazer ${step.label}`, step.undo);
    return step;
  }

  redo(): Step | null {
    const step = this.future.pop();
    if (!step) return null;
    for (const op of step.redo) applyOp(this.doc, this.index, op);
    this.past.push(step);
    this.mergeKey = null;
    this.emit(`Refazer ${step.label}`, step.redo);
    return step;
  }

  /** Recalcula o layout sem registrar no histórico (ex.: depois que uma fonte carregou). */
  refreshLayout(): void {
    const ctx = { measureText: this.measureText, changes: [] as Change[] };
    for (const page of this.doc.pages) for (const n of page.children) layoutNode(n, ctx);
    if (ctx.changes.length) this.emit('Layout', []);
  }

  /** Roda o layout nas árvores tocadas pelas operações (a partir do nó mais alto da página). */
  private relayout(ops: Op[]): Change[] {
    const roots = new Set<SceneNode>();
    const touch = (id: string | undefined) => {
      if (!id) return;
      const chain = [this.index.get(id), ...this.index.ancestors(id)].filter(Boolean) as SceneNode[];
      const top = chain[chain.length - 1];
      if (top) roots.add(top);
    };
    for (const op of ops) {
      if (op.op === 'set') touch(op.id);
      else if (op.op === 'insert') {
        touch(op.node.id);
        touch(op.parent);
      } else if (op.op === 'move') {
        touch(op.id);
        touch(op.parent);
      }
    }
    // remoções e movimentos: o pai antigo também precisa de layout, então revisa a página toda
    if (ops.some((o) => o.op === 'remove' || o.op === 'move' || o.op === 'doc')) {
      for (const page of this.doc.pages) for (const n of page.children) roots.add(n);
    }
    const ctx = { measureText: this.measureText, changes: [] as Change[] };
    for (const r of roots) if (this.index.get(r.id)) layoutNode(r, ctx);
    return ctx.changes;
  }
}
