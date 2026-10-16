import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, ClipboardPaste, Bold, Italic, Underline, Strikethrough, Eraser } from 'lucide-react';
import { apply, parseHex, applyRunStyle, runsAfterEdit, segmentsIn, type RunAttrs, type TextNode, type TextRun } from '@zaliel/core';
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
  // com trechos de estilo, o canvas continua mostrando o texto e o campo fica só com o cursor e a seleção
  const rich = !!node?.runs?.length;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  useEffect(() => {
    ed.editingTextShown = rich;
    ed.emit('view');
    return () => {
      ed.editingTextShown = false;
    };
  }, [rich, ed]);

  if (!node || node.type !== 'text') {
    queueMicrotask(onDone);
    return null;
  }

  // matriz do texto no mundo (para instâncias, a do nó resolvido dentro da instância)
  const m = inner ? ed.innerMatrix(id) : ed.model.index.worldMatrix(id);
  const origin = ed.worldToScreen(apply(m, { x: 0, y: 0 }));
  const z = ed.viewport.zoom;
  const angle = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const st = node.style;
  const fill = node.fills?.find((f) => f.type === 'solid');
  const color = fill && fill.type === 'solid' ? parseHex(fill.color) : { r: 0, g: 0, b: 0, a: 1 };
  const lh = typeof st.lineHeight === 'number' ? `${st.lineHeight}px` : '1.21';
  const autoW = node.autoResize === 'width';

  /** O nó como está agora no documento (o da renderização pode ter ficado para trás). */
  const current = () => (inner ? findResolved(ed, instanceId!, id) : ed.model.index.get(id)) as TextNode | null;

  const save = (text: string, runs: TextRun[] | undefined) => {
    if (inner) ed.setOverride(instanceId!, innerId!, { text, runs });
    else ed.model.transact('Editar texto', [{ op: 'set', id, key: 'text', value: text }, { op: 'set', id, key: 'runs', value: runs }], { merge: merge.current });
  };

  // os trechos acompanham o que é digitado ou apagado
  const write = (text: string) => {
    const cur = current();
    if (!cur?.runs?.length) {
      if (inner) ed.setOverride(instanceId!, innerId!, { text });
      else ed.model.transact('Editar texto', [{ op: 'set', id, key: 'text', value: text }], { merge: merge.current });
      return;
    }
    const runs = runsAfterEdit(cur.runs, cur.text, text);
    save(text, runs.length ? runs : undefined);
  };

  /** Aplica um estilo à seleção do campo (sem seleção, ao texto inteiro). */
  const styleSelection = (make: (segs: ReturnType<typeof segmentsIn>, cur: TextNode) => Partial<RunAttrs>) => {
    const el = ref.current;
    const cur = current();
    if (!el || !cur) return;
    let s = el.selectionStart, e = el.selectionEnd;
    if (s === e) {
      s = 0;
      e = cur.text.length;
    }
    const patch = make(segmentsIn(cur.text, cur.style, cur.runs, s, e), cur);
    const runs = applyRunStyle(cur.runs, cur.text.length, s, e, patch, cur.style);
    save(cur.text, runs.length ? runs : undefined);
  };
  const toggleBold = () =>
    styleSelection((segs, cur) => {
      const all = segs.every((g) => g.style.weight >= 600);
      const baseBold = cur.style.weight >= 600;
      return { weight: all ? (baseBold ? 400 : cur.style.weight) : baseBold ? cur.style.weight : 700 };
    });
  const toggleItalic = () => styleSelection((segs) => ({ italic: !segs.every((g) => g.style.italic) }));
  const toggleDecoration = (d: 'underline' | 'strikethrough') => styleSelection((segs) => ({ decoration: segs.every((g) => g.style.decoration === d) ? 'none' : d }));
  const setColor = (hex: string) => styleSelection(() => ({ color: hex }));
  const clearStyles = () => styleSelection(() => ({ family: undefined, weight: undefined, italic: undefined, size: undefined, letterSpacing: undefined, decoration: undefined, color: undefined }));

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

  const fillHex = fill && fill.type === 'solid' ? fill.color.slice(0, 7) : '#000000';
  return (
    // o grupo só serve para saber quando o foco sai do campo e da barra ao mesmo tempo
    <div style={{ display: 'contents' }} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && finish()}>
      {!inner && (
        <div
          className="text-format-bar"
          data-no-canvas
          style={{ left: origin.x, top: Math.max(4, origin.y - 36) }}
          onPointerDown={(e) => e.stopPropagation()}
          // os botões não tiram o foco do campo (a seleção continua visível)
          onMouseDown={(e) => (e.target as HTMLElement).tagName !== 'INPUT' && e.preventDefault()}
        >
          <button title="Negrito (Ctrl+B)" onClick={toggleBold}><Bold size={13} /></button>
          <button title="Itálico (Ctrl+I)" onClick={toggleItalic}><Italic size={13} /></button>
          <button title="Sublinhado (Ctrl+U)" onClick={() => toggleDecoration('underline')}><Underline size={13} /></button>
          <button title="Tachado (Ctrl+Shift+X)" onClick={() => toggleDecoration('strikethrough')}><Strikethrough size={13} /></button>
          <label className="text-format-color" title="Cor do trecho">
            <input type="color" defaultValue={fillHex} onChange={(e) => setColor(e.target.value)} />
          </label>
          <button title="Tirar os estilos do trecho" onClick={clearStyles}><Eraser size={13} /></button>
        </div>
      )}
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
        color: rich ? 'transparent' : `rgba(${color.r},${color.g},${color.b},${color.a})`,
        textTransform: st.case === 'upper' ? 'uppercase' : st.case === 'lower' ? 'lowercase' : st.case === 'title' ? 'capitalize' : 'none',
        textDecoration: rich ? 'none' : st.decoration === 'underline' ? 'underline' : st.decoration === 'strikethrough' ? 'line-through' : 'none',
        outlineWidth: 1 / z,
      }}
      onInput={(e) => write((e.target as HTMLTextAreaElement).value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
          return;
        }
        // atalhos de estilo valem para a seleção (dentro de instâncias o texto só troca de conteúdo)
        const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
        const k = e.key.toLowerCase();
        if (!mod || inner) return;
        if (k === 'b' && !e.shiftKey) toggleBold();
        else if (k === 'i' && !e.shiftKey) toggleItalic();
        else if (k === 'u' && !e.shiftKey) toggleDecoration('underline');
        else if (k === 'x' && e.shiftKey) toggleDecoration('strikethrough');
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
    </div>
  );
}
