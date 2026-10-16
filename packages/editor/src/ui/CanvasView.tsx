import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, ClipboardPaste } from 'lucide-react';
import { apply, multiply, nodeMatrix, parseHex, type Mat, type SceneNode, type TextNode } from '@zaliel/core';
import type { Editor } from '../editor';
import { useEditor } from './hooks';
import { Interaction, findResolved } from '../engine/interaction';
import { Menu, type MenuEntry } from './Menu';
import { keyLabel } from './commands';
import { LAYER_MENU } from './LeftPanel';
import { blobToBase64 } from '../editor';
import { CommentLayer } from './Comments';

export function CanvasView({ ready }: { ready: boolean }) {
  const ed = useEditor('view', 'tool', 'ui');
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; empty: boolean; at: { x: number; y: number } } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const host = ed.host;
    if (!ready || !host || !canvasRef.current || !stageRef.current) return;
    host.mount(canvasRef.current);
    const inter = new Interaction(ed, stageRef.current, (id) => setEditing(id));
    host.interaction = inter;
    ed.fitIfPending();
    const ro = new ResizeObserver(() => host.resize());
    ro.observe(stageRef.current);
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const dpr = () => host.resize();
    mq.addEventListener?.('change', dpr);
    return () => {
      ro.disconnect();
      mq.removeEventListener?.('change', dpr);
      inter.destroy();
      host.interaction = null;
      host.unmount();
    };
  }, [ready, ed]);

  useEffect(() => {
    const fn = (e: Event) => setEditing((e as CustomEvent<string>).detail);
    window.addEventListener('zaliel:edit-text', fn);
    return () => window.removeEventListener('zaliel:edit-text', fn);
  }, []);

  // edição de texto: o canvas esconde o nó e mostra um campo no lugar
  useEffect(() => {
    ed.editingText = editing;
    ed.emit('view');
  }, [editing, ed]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const r = stageRef.current!.getBoundingClientRect();
    const at = ed.screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
    const comp = e.dataTransfer.getData('application/x-zaliel-component');
    if (comp) {
      const { id, library } = JSON.parse(comp);
      ed.insertComponent(id, library, at);
      return;
    }
    const files = [...e.dataTransfer.files];
    const zal = files.find((f) => /\.zal$/i.test(f.name));
    const pathOf = (f: File) => (window as unknown as { zaliel?: { pathForFile?: (f: File) => string } }).zaliel?.pathForFile?.(f);
    if (zal) {
      const path = pathOf(zal);
      if (path) ed.openPath(path);
      return;
    }
    const other = files.find((f) => /\.(fig|pen)$/i.test(f.name));
    if (other) {
      const path = pathOf(other);
      if (path) ed.importDesign(path);
      return;
    }
    const imgs = files.filter((f) => /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/.test(f.type));
    if (!imgs.length) {
      if (files.length) ed.toast('warn', 'Só dá para soltar imagens (PNG, JPG, GIF, WebP) ou arquivos .zal aqui.');
      return;
    }
    const data = await Promise.all(imgs.map(async (f) => ({ name: f.name, mime: f.type, data: await blobToBase64(f) })));
    await ed.insertImages(data, at);
  };

  return (
    <div
      className="stage"
      ref={stageRef}
      tabIndex={0}
      onContextMenu={(e) => {
        e.preventDefault();
        if (ed.home) return;
        const hit = ed.hover;
        if (hit && !ed.selection.includes(hit)) ed.select([hit]);
        const r = stageRef.current!.getBoundingClientRect();
        setMenu({ x: e.clientX, y: e.clientY, empty: !hit && !ed.selection.length, at: ed.screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top }) });
      }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].some((t) => t === 'Files' || t === 'application/x-zaliel-component')) {
          e.preventDefault();
          if (e.dataTransfer.types.includes('Files')) setDragOver(true);
        }
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragOver(false)}
      onDrop={onDrop}
    >
      <canvas ref={canvasRef} />
      {!ready && <div className="loading">Preparando o canvas…</div>}
      {dragOver && <div className="drop-hint">Solte para importar</div>}
      {editing && <TextEditor id={editing} onDone={() => setEditing(null)} />}
      {ready && <CommentLayer />}
      {ready && <ZoomPill />}
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          contextual
          items={(() => {
            // "Colar aqui": cola onde o botão direito foi clicado
            const pasteHere: MenuEntry = { label: 'Colar aqui', icon: <ClipboardPaste size={14} />, run: () => void ed.paste(menu.at), kbd: keyLabel('Mod+V') };
            return menu.empty
              ? [pasteHere, '-', 'edit.selectAll', 'view.fit', '-', 'file.import', 'view.pixelGrid', 'view.comments']
              : LAYER_MENU.flatMap((it) => (it === 'edit.paste' ? [pasteHere] : [it]));
          })()}
        />
      )}
    </div>
  );
}

function ZoomPill() {
  const ed = useEditor('view');
  return (
    <div className="zoom-pill" data-no-canvas>
      <button onClick={() => ed.zoomAt(1 / 1.5)} aria-label="Afastar"><Minus size={12} /></button>
      <button onClick={() => ed.zoomTo(1)} title="Voltar para 100%" style={{ minWidth: 48 }}>{Math.round(ed.viewport.zoom * 100)}%</button>
      <button onClick={() => ed.zoomAt(1.5)} aria-label="Aproximar"><Plus size={12} /></button>
    </div>
  );
}

/** Campo de texto posicionado exatamente sobre a camada de texto no canvas. */
function TextEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const ed = useEditor('view', 'doc');
  const ref = useRef<HTMLTextAreaElement>(null);
  const inner = ed.isInner(id);
  const instanceId = inner ? id.split('/')[0] : null;
  const innerId = inner ? id.split('/').slice(1).join('/') : null;
  const node = (inner ? findResolved(ed, instanceId!, id) : ed.model.index.get(id)) as TextNode | null;
  const initial = useRef(node?.text ?? '');
  const merge = useRef(`text-${id}-${Date.now()}`);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  if (!node || node.type !== 'text') {
    queueMicrotask(onDone);
    return null;
  }

  // matriz do texto no mundo (para instâncias, a do nó resolvido dentro da instância)
  const m = inner ? innerMatrix(ed, instanceId!, id) : ed.model.index.worldMatrix(id);
  const origin = ed.worldToScreen(apply(m, { x: 0, y: 0 }));
  const z = ed.viewport.zoom;
  const angle = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const st = node.style;
  const fill = node.fills?.find((f) => f.type === 'solid');
  const color = fill && fill.type === 'solid' ? parseHex(fill.color) : { r: 0, g: 0, b: 0, a: 1 };
  const lh = typeof st.lineHeight === 'number' ? `${st.lineHeight}px` : '1.21';
  const autoW = node.autoResize === 'width';

  const write = (text: string) => {
    if (inner) ed.setOverride(instanceId!, innerId!, { text });
    else ed.model.transact('Editar texto', [{ op: 'set', id, key: 'text', value: text }], { merge: merge.current });
  };

  const finish = () => {
    const el = ref.current;
    const text = el?.value ?? '';
    ed.model.seal();
    if (!inner && !text.trim() && !initial.current) {
      // texto novo vazio: some
      ed.run('Excluir', [{ op: 'remove', id }]);
      ed.select([]);
    }
    onDone();
  };

  return (
    <textarea
      ref={ref}
      className={`text-editor ${autoW ? '' : 'wrap'}`}
      data-no-canvas
      spellCheck={false}
      defaultValue={node.text}
      style={{
        left: origin.x,
        top: origin.y,
        width: autoW ? Math.max(node.width, 8) + 40 : node.width,
        height: Math.max(node.height, st.size * 1.25) + 4,
        transform: `scale(${z}) rotate(${angle}deg)`,
        font: `${st.italic ? 'italic ' : ''}${st.weight} ${st.size}px/${lh} "${st.family}", Inter, sans-serif`,
        letterSpacing: `${st.letterSpacing ?? 0}px`,
        textAlign: st.align === 'justify' ? 'justify' : st.align ?? 'left',
        color: `rgba(${color.r},${color.g},${color.b},${color.a})`,
        textTransform: st.case === 'upper' ? 'uppercase' : st.case === 'lower' ? 'lowercase' : st.case === 'title' ? 'capitalize' : 'none',
        textDecoration: st.decoration === 'underline' ? 'underline' : st.decoration === 'strikethrough' ? 'line-through' : 'none',
        outlineWidth: 1 / z,
      }}
      onInput={(e) => write((e.target as HTMLTextAreaElement).value)}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

function innerMatrix(ed: Editor, instanceId: string, id: string): Mat {
  const base = ed.model.index.worldMatrix(instanceId);
  const inst = ed.model.index.get(instanceId);
  if (!inst) return base;
  const r = ed.resolve(inst);
  const walk = (list: SceneNode[], m: Mat): Mat | null => {
    for (const c of list) {
      const cm = multiply(m, nodeMatrix(c));
      if (c.id === id) return cm;
      if ('children' in c) {
        const f = walk(c.children, cm);
        if (f) return f;
      }
    }
    return null;
  };
  return ('children' in r && walk(r.children, base)) || base;
}
