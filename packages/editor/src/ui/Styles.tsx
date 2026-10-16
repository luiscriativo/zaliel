// Estilos de cor, texto e efeito: escolher, criar, desvincular e gerenciar.
import { useRef, useState } from 'react';
import { X, Unlink, Plus, Trash2, RefreshCw, Grid2x2 } from 'lucide-react';
import { allStyles, findStyle, slotType, styleUsage, type SceneNode, type Style, type StyleSlot } from '@zaliel/core';
import { useDismiss, useEditor } from './hooks';
import { IconBtn, Section } from './controls';
import { PaintPicker, paintCss } from './ColorPicker';

/** Amostra visual de um estilo (cor, "Ag" para texto, sombra para efeito). */
export function StyleSwatch({ style }: { style: Style }) {
  const ed = useEditor();
  if (style.type === 'color') {
    return (
      <span className="style-swatch">
        {style.paints.map((p, i) => <i key={i} style={{ background: paintCss(p, ed.doc) }} />)}
      </span>
    );
  }
  if (style.type === 'text') return <span className="style-swatch text" style={{ fontWeight: style.text.weight, fontStyle: style.text.italic ? 'italic' : undefined }}>Ag</span>;
  return <span className="style-swatch effect" />;
}

function describe(style: Style): string {
  if (style.type === 'text') return `${style.text.family} · ${style.text.size}${typeof style.text.lineHeight === 'number' ? `/${style.text.lineHeight}` : ''}`;
  if (style.type === 'effect') return `${style.effects.length} efeito${style.effects.length === 1 ? '' : 's'}`;
  const p = style.paints[0];
  return p?.type === 'solid' ? p.color.toUpperCase() : p ? 'Gradiente' : '';
}

/** Lista de estilos para escolher, num popover. */
function StyleMenu(props: { anchor: DOMRect; slot: StyleSlot; nodes: SceneNode[]; onClose: () => void }) {
  const ed = useEditor('doc');
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, props.onClose, ref);
  const type = slotType(props.slot);
  const list = allStyles(ed.doc).filter((s) => s.type === type);
  const local = new Set((ed.doc.styles ?? []).map((s) => s.id));
  const ids = props.nodes.map((n) => n.id);
  const top = Math.min(window.innerHeight - 340, Math.max(8, props.anchor.top - 20));
  const left = Math.max(8, props.anchor.left - 250);
  const titles: Record<Style['type'], string> = { color: 'Estilos de cor', text: 'Estilos de texto', effect: 'Estilos de efeito' };
  return (
    <div className="popover style-menu" ref={ref} style={{ top, left }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="p-head">
        <span className="section-title grow">{titles[type]}</span>
        <button className="icon-btn" onClick={props.onClose} aria-label="Fechar"><X size={14} /></button>
      </div>
      <div className="p-body" style={{ padding: 4, maxHeight: 260, overflow: 'auto' }}>
        {!list.length && <div className="muted" style={{ padding: 8, lineHeight: 1.5 }}>Nenhum estilo ainda. Crie um a partir desta camada para reutilizar em outras.</div>}
        {list.map((s) => (
          <button
            key={s.id}
            className="style-item"
            onClick={() => {
              ed.applyStyle(ids, props.slot, s.id);
              props.onClose();
            }}
            title={describe(s)}
          >
            <StyleSwatch style={s} />
            <span className="grow">{s.name}</span>
            {!local.has(s.id) && <span className="badge">biblioteca</span>}
          </button>
        ))}
      </div>
      {props.nodes.length === 1 && (
        <div style={{ padding: 8, borderTop: '1px solid var(--line)' }}>
          <button
            className="btn small block"
            onClick={() => {
              ed.createStyle(props.slot, props.nodes[0].id);
              props.onClose();
            }}
          >
            <Plus size={12} /> Criar estilo com esta camada
          </button>
        </div>
      )}
    </div>
  );
}

/** Botão que abre a lista de estilos de um lugar (preenchimento, contorno, texto, efeito). */
export function StyleButton({ nodes, slot }: { nodes: SceneNode[]; slot: StyleSlot }) {
  const [open, setOpen] = useState<DOMRect | null>(null);
  return (
    <>
      <IconBtn icon={<Grid2x2 size={13} />} tip="Estilos" onClick={(e) => setOpen((e.currentTarget as HTMLElement).getBoundingClientRect())} />
      {open && <StyleMenu anchor={open} slot={slot} nodes={nodes} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Estilo em comum entre as camadas num lugar (ou null). */
export function linkedStyle(ed: ReturnType<typeof useEditor>, nodes: SceneNode[], slot: StyleSlot): Style | null {
  const id = nodes[0]?.styles?.[slot];
  if (!id || !nodes.every((n) => n.styles?.[slot] === id)) return null;
  return findStyle(ed.doc, id) ?? null;
}

/** Linha que mostra o estilo ligado, com desvincular. */
export function StyleRow({ nodes, slot, style }: { nodes: SceneNode[]; slot: StyleSlot; style: Style }) {
  const ed = useEditor('doc');
  const [open, setOpen] = useState<DOMRect | null>(null);
  return (
    <div className="paint-row">
      <button className="field style-link" onClick={(e) => setOpen(e.currentTarget.getBoundingClientRect())} title={`${describe(style)} — clique para trocar`}>
        <StyleSwatch style={style} />
        <span className="grow">{style.name}</span>
      </button>
      <IconBtn icon={<Unlink size={13} />} tip="Desvincular do estilo" onClick={() => ed.detachStyle(nodes.map((n) => n.id), slot)} />
      {open && <StyleMenu anchor={open} slot={slot} nodes={nodes} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Estilos do arquivo (aparece com nada selecionado): renomear, editar cor, redefinir, excluir. */
export function LocalStyles() {
  const ed = useEditor('doc', 'selection');
  const styles = ed.doc.styles ?? [];
  const [renaming, setRenaming] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ id: string; i: number; rect: DOMRect } | null>(null);
  const groups: [Style['type'], string][] = [['color', 'Cores'], ['text', 'Texto'], ['effect', 'Efeitos']];
  const lib = ed.doc.libraries.reduce((n, l) => n + (l.styles?.length ?? 0), 0);
  return (
    <Section title="Estilos">
      {!styles.length && (
        <div className="muted" style={{ lineHeight: 1.55 }}>
          Selecione uma camada e use o botão <Grid2x2 size={11} style={{ verticalAlign: -1 }} /> em Preenchimento, Texto ou Efeitos para criar estilos reutilizáveis.
          {lib > 0 && ` As bibliotecas ligadas trazem ${lib} estilo(s).`}
        </div>
      )}
      {groups.map(([type, title]) => {
        const list = styles.filter((s) => s.type === type);
        if (!list.length) return null;
        return (
          <div key={type} style={{ marginBottom: 8 }}>
            <div className="label" style={{ marginBottom: 4 }}>{title}</div>
            {list.map((s) => {
              const used = styleUsage(ed.doc, s.id);
              return (
                <div key={s.id} className="style-row">
                  <button
                    className="swatch-btn"
                    disabled={s.type !== 'color'}
                    onClick={(e) => s.type === 'color' && setPicker({ id: s.id, i: 0, rect: e.currentTarget.getBoundingClientRect() })}
                    aria-label={s.type === 'color' ? 'Editar cor do estilo' : s.name}
                  >
                    <StyleSwatch style={s} />
                  </button>
                  {renaming === s.id ? (
                    <input
                      className="inline-input grow"
                      autoFocus
                      defaultValue={s.name}
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== s.name) ed.updateStyle({ ...s, name: v });
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  ) : (
                    <span className="grow style-name" onDoubleClick={() => setRenaming(s.id)} title={`${describe(s)} · ${used} camada(s) · duplo clique para renomear`}>
                      {s.name}
                    </span>
                  )}
                  <span className="muted" style={{ fontSize: 10.5 }}>{used}</span>
                  {ed.selection.length === 1 && (
                    <IconBtn icon={<RefreshCw size={12} />} tip="Redefinir com a camada selecionada" tipPos="left" onClick={() => ed.redefineStyle(s.id)} />
                  )}
                  <IconBtn
                    icon={<Trash2 size={12} />}
                    tip="Excluir estilo"
                    tipPos="left"
                    onClick={() => (!used || window.confirm(`“${s.name}” é usado por ${used} camada(s). Elas mantêm a aparência atual, mas deixam de seguir o estilo. Excluir?`)) && ed.deleteStyle(s.id)}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
      {picker && (() => {
        const s = styles.find((x) => x.id === picker.id);
        if (!s || s.type !== 'color') return null;
        return (
          <PaintPicker
            anchor={picker.rect}
            paint={s.paints[picker.i]}
            allowImage={false}
            onClose={() => setPicker(null)}
            onChange={(p, merge) => ed.updateStyle({ ...s, paints: s.paints.map((x, j) => (j === picker.i ? p : x)) }, merge)}
          />
        );
      })()}
    </Section>
  );
}
