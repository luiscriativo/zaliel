import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight, ChevronDown, Eye, EyeOff, Lock, LockOpen, Plus, Frame, Square, Circle, Minus, Triangle, Star, Type, Spline, Component, Diamond, Group, Image as ImageIcon, Rows3, Columns3,
  Library, RefreshCw, Trash2, Search, FolderOpen,
} from 'lucide-react';
import type { ContainerNode, SceneNode } from '@zaliel/core';
import { useEditor } from './hooks';
import { Menu, type MenuEntry } from './Menu';
import { IconBtn } from './controls';

export function LeftPanel() {
  const [tab, setTab] = useState<'layers' | 'assets'>('layers');
  return (
    <aside className="panel left">
      <div className="tabs">
        <button className={tab === 'layers' ? 'on' : ''} onClick={() => setTab('layers')}>Camadas</button>
        <button className={tab === 'assets' ? 'on' : ''} onClick={() => setTab('assets')}>Recursos</button>
      </div>
      {tab === 'layers' ? (
        <>
          <Pages />
          <Layers />
        </>
      ) : (
        <Assets />
      )}
    </aside>
  );
}

// ── Páginas ──────────────────────────────────────────────────────────────────

function Pages() {
  const ed = useEditor('doc');
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  return (
    <div className="pages">
      <div className="head">
        <span className="section-title">Páginas</span>
        <IconBtn icon={<Plus size={14} />} tip="Nova página" onClick={() => ed.addPage()} />
      </div>
      {ed.doc.pages.map((p) => (
        <div
          key={p.id}
          className={`page-item ${p.id === ed.pageId ? 'on' : ''}`}
          onClick={() => ed.setPage(p.id)}
          onDoubleClick={() => setEditing(p.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ id: p.id, x: e.clientX, y: e.clientY });
          }}
        >
          {editing === p.id ? (
            <input
              autoFocus
              defaultValue={p.name}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                ed.renamePage(p.id, e.target.value);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
          )}
        </div>
      ))}
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Renomear', run: () => setEditing(menu.id) },
            { label: 'Duplicar página', run: () => ed.duplicatePage(menu.id) },
            '-',
            { label: 'Excluir página', run: () => ed.deletePage(menu.id), disabled: ed.doc.pages.length <= 1 },
          ]}
        />
      )}
    </div>
  );
}

// ── Camadas ──────────────────────────────────────────────────────────────────

export function kindIcon(n: SceneNode, size = 13) {
  const p = { size, strokeWidth: 1.6 };
  switch (n.type) {
    case 'frame':
      return n.layout ? n.layout.direction === 'horizontal' ? <Columns3 {...p} /> : <Rows3 {...p} /> : <Frame {...p} />;
    case 'group':
      return <Group {...p} />;
    case 'component':
      return <Component {...p} />;
    case 'instance':
      return <Diamond {...p} />;
    case 'rect':
      return n.fills?.some((f) => f.type === 'image') ? <ImageIcon {...p} /> : <Square {...p} />;
    case 'ellipse':
      return <Circle {...p} />;
    case 'line':
      return <Minus {...p} style={{ transform: 'rotate(-45deg)' }} />;
    case 'polygon':
      return <Triangle {...p} />;
    case 'star':
      return <Star {...p} />;
    case 'path':
      return <Spline {...p} />;
    case 'text':
      return <Type {...p} />;
  }
}

type Drop = { id: string; where: 'before' | 'after' | 'inside' } | null;

function Layers() {
  const ed = useEditor('doc', 'selection', 'view');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const dragIds = useRef<string[]>([]);
  const anchor = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // abre os ancestrais da seleção e rola até ela
  const selKey = ed.selection.join(',');
  useEffect(() => {
    if (!ed.selection.length) return;
    const need = new Set(expanded);
    let changed = false;
    for (const id of ed.selection) for (const a of ed.model.index.ancestors(id)) if (!need.has(a.id)) {
      need.add(a.id);
      changed = true;
    }
    if (changed) setExpanded(need);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${CSS.escape(ed.selection[0])}"]`)?.scrollIntoView({ block: 'nearest' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  // lista achatada na ordem visual (de cima para baixo = último filho primeiro)
  const rows = useMemo(() => {
    const out: { n: SceneNode; depth: number; parent: string }[] = [];
    const visit = (list: SceneNode[], depth: number, parent: string) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        out.push({ n, depth, parent });
        if ('children' in n && n.children.length && expanded.has(n.id)) visit(n.children, depth + 1, n.id);
      }
    };
    visit(ed.page.children, 0, ed.pageId);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed.version('doc'), expanded, ed.pageId]);

  const selected = new Set(ed.selection);
  const toggleExpand = (id: string) => {
    const s = new Set(expanded);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setExpanded(s);
  };

  const click = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchor.current) {
      const ids = rows.map((r) => r.n.id);
      const a = ids.indexOf(anchor.current), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const parent = ed.model.index.parentId(id);
        ed.select(ids.slice(Math.min(a, b), Math.max(a, b) + 1).filter((x) => ed.model.index.parentId(x) === parent));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) ed.toggleSelect(id);
    else ed.select([id]);
    anchor.current = id;
  };

  const onDragOver = (e: React.DragEvent, n: SceneNode) => {
    if (!dragIds.current.length) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const container = 'children' in n && n.type !== 'group' ? true : n.type === 'group';
    const where = container && y > 0.28 && y < 0.72 ? 'inside' : y < 0.5 ? 'before' : 'after';
    if (dragIds.current.some((id) => id === n.id || ed.model.index.isAncestor(id, n.id))) return setDrop(null);
    setDrop({ id: n.id, where });
  };

  const onDrop = () => {
    const d = drop;
    setDrop(null);
    if (!d) return;
    const ids = ed.inTreeOrder(ed.topLevel(dragIds.current));
    dragIds.current = [];
    const target = ed.model.index.get(d.id);
    if (!target) return;
    if (d.where === 'inside') {
      const kids = (target as ContainerNode).children;
      ids.forEach((id) => ed.moveInto(id, target.id, kids.length));
      setExpanded(new Set(expanded).add(target.id));
      return;
    }
    const parent = ed.model.index.parentId(target.id)!;
    for (const id of ids) {
      const list = ed.model.index.siblings(parent)!;
      const without = list.filter((s) => s.id !== id);
      const ti = without.findIndex((s) => s.id === target.id);
      // "antes" na lista visual = acima = índice maior
      const index = d.where === 'before' ? ti + 1 : ti;
      ed.moveInto(id, parent, index);
    }
  };

  if (!ed.page.children.length) {
    return (
      <div className="scroll">
        <div className="empty-state">
          <div className="title">Página em branco</div>
          Escolha <kbd>F</kbd> para desenhar um frame, <kbd>R</kbd> para um retângulo ou <kbd>T</kbd> para texto.
          <br />
          Arraste imagens para o canvas para importá-las.
        </div>
      </div>
    );
  }

  return (
    <div className="scroll layers" ref={listRef} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)}>
      {rows.map(({ n, depth }) => {
        const isSel = selected.has(n.id);
        const inSel = !isSel && ed.model.index.ancestors(n.id).some((a) => selected.has(a.id));
        const hasKids = 'children' in n && n.children.length > 0;
        const open = expanded.has(n.id);
        const comp = n.type === 'component' || n.type === 'instance';
        const dropCls = drop?.id === n.id ? `drop-${drop.where}` : '';
        return (
          <div
            key={n.id}
            data-id={n.id}
            className={`layer ${isSel ? 'sel' : ''} ${inSel ? 'sel-child' : ''} ${depth === 0 ? 'top' : ''} ${ed.hover === n.id ? 'hover-canvas' : ''} ${n.visible === false ? 'hidden-node' : ''} ${dropCls}`}
            style={{ paddingLeft: 6 + depth * 14, ['--indent' as string]: `${8 + depth * 14}px` }}
            draggable={renaming !== n.id}
            onDragStart={(e) => {
              dragIds.current = isSel ? ed.selection : [n.id];
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', n.name);
            }}
            onDragOver={(e) => onDragOver(e, n)}
            onDrop={(e) => {
              e.preventDefault();
              onDrop();
            }}
            onDragEnd={() => {
              dragIds.current = [];
              setDrop(null);
            }}
            onClick={(e) => click(e, n.id)}
            onDoubleClick={() => setRenaming(n.id)}
            onPointerEnter={() => ed.setHover(n.id)}
            onPointerLeave={() => ed.setHover(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!isSel) ed.select([n.id]);
              setMenu({ x: e.clientX, y: e.clientY });
            }}
          >
            <span
              className="twisty"
              onClick={(e) => {
                e.stopPropagation();
                if (hasKids) toggleExpand(n.id);
              }}
            >
              {hasKids ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
            </span>
            <span className={`kind ${comp ? 'component' : ''}`}>{kindIcon(n)}</span>
            <span className={`name ${comp ? 'component' : ''}`}>
              {renaming === n.id ? (
                <input
                  autoFocus
                  defaultValue={n.name}
                  onFocus={(e) => e.target.select()}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== n.name) ed.setProp([n.id], 'name', v);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                n.name
              )}
            </span>
            <IconBtn
              className={`tog ${n.locked ? 'pinned' : ''}`}
              icon={n.locked ? <Lock size={12} /> : <LockOpen size={12} />}
              tip={n.locked ? 'Desbloquear' : 'Bloquear'}
              tipPos="left"
              onClick={(e) => {
                e.stopPropagation();
                ed.toggle('locked', [n.id]);
              }}
            />
            <IconBtn
              className={`tog ${n.visible === false ? 'pinned' : ''}`}
              icon={n.visible === false ? <EyeOff size={12} /> : <Eye size={12} />}
              tip={n.visible === false ? 'Mostrar' : 'Ocultar'}
              tipPos="left"
              onClick={(e) => {
                e.stopPropagation();
                ed.toggle('visible', [n.id]);
              }}
            />
          </div>
        );
      })}
      {menu && <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={LAYER_MENU} />}
    </div>
  );
}

export const LAYER_MENU: MenuEntry[] = ['edit.copy', 'edit.paste', 'edit.duplicate', 'edit.delete', '-', 'obj.group', 'obj.ungroup', 'obj.frame', 'obj.autolayout', '-', 'obj.component', 'obj.detach', 'obj.main', '-', 'obj.front', 'obj.back', '-', 'obj.hide', 'obj.lock', '-', 'view.selection', 'file.exportPng'];

// ── Recursos: componentes e bibliotecas ─────────────────────────────────────

function Assets() {
  const ed = useEditor('doc', 'ui');
  const [q, setQ] = useState('');
  const local = ed.model.index.components();
  const match = (c: ContainerNode) => !q || c.name.toLowerCase().includes(q.toLowerCase());
  return (
    <div className="scroll">
      <div className="search">
        <label className="field text">
          <span className="lead"><Search size={12} /></span>
          <input placeholder="Buscar componentes" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      <div className="asset-group">
        <div className="group-head">
          <span className="section-title">Neste arquivo</span>
          <span className="muted">{local.length}</span>
        </div>
        {local.length ? (
          <div className="asset-grid">{local.filter(match).map((c) => <AssetTile key={c.id} c={c} />)}</div>
        ) : (
          <div className="muted" style={{ lineHeight: 1.6 }}>
            Selecione camadas e use <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> para criar um componente. Ele vira um recurso reutilizável — e este arquivo pode ser usado como biblioteca por outros.
          </div>
        )}
      </div>

      <div className="asset-group" style={{ paddingBottom: 4 }}>
        <div className="group-head">
          <span className="section-title">Bibliotecas</span>
          <IconBtn icon={<Plus size={14} />} tip="Adicionar biblioteca" onClick={() => ed.addLibrary()} />
        </div>
      </div>
      {ed.doc.libraries.length === 0 && (
        <div className="lib-card" style={{ textAlign: 'center' }}>
          <Library size={22} strokeWidth={1.4} className="muted" />
          <div style={{ margin: '6px 0 10px', color: 'var(--text-2)', lineHeight: 1.5 }}>Use os componentes de outro arquivo .zal. Uma cópia fica guardada aqui, então tudo funciona offline.</div>
          <button className="btn small" onClick={() => ed.addLibrary()}>
            <FolderOpen size={13} /> Escolher arquivo…
          </button>
        </div>
      )}
      {ed.doc.libraries.map((lib) => {
        const upd = ed.libraryUpdate(lib.id);
        const comps = lib.components.filter(match);
        return (
          <div key={lib.id}>
            <div className="lib-card">
              <div className="row">
                <Library size={14} className="muted" />
                <span className="lib-name grow">{lib.name}</span>
                {upd && <span className="badge update">Atualização</span>}
              </div>
              <div className="lib-path" title={lib.path}>{lib.path}</div>
              <div className="row" style={{ marginTop: 8 }}>
                <span className="muted grow">{lib.components.length} componente(s)</span>
                <IconBtn icon={<RefreshCw size={13} />} tip={upd ? 'Aplicar atualização' : 'Recarregar do arquivo'} onClick={() => ed.updateLibraries(lib.id)} />
                <IconBtn icon={<Trash2 size={13} />} tip="Remover biblioteca" onClick={() => ed.removeLibrary(lib.id)} />
              </div>
            </div>
            {comps.length > 0 && (
              <div className="asset-group" style={{ paddingTop: 0 }}>
                <div className="asset-grid">{comps.map((c) => <AssetTile key={c.id} c={c} library={lib.id} />)}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const thumbs = new Map<string, string | null>();

function AssetTile({ c, library }: { c: ContainerNode; library?: string }) {
  const ed = useEditor();
  const key = `${c.id}:${library ?? ''}:${JSON.stringify(c).length}:${ed.model.revision}`;
  const [src, setSrc] = useState<string | null>(thumbs.get(key) ?? null);
  useEffect(() => {
    if (thumbs.has(key)) return setSrc(thumbs.get(key)!);
    const t = setTimeout(() => {
      const url = ed.host?.thumbnail(c) ?? null;
      thumbs.set(key, url);
      setSrc(url);
    }, 30);
    return () => clearTimeout(t);
  }, [key, ed, c]);
  return (
    <button
      className="asset"
      title={`${c.name}${c.description ? `\n${c.description}` : ''}\nClique para inserir ou arraste para o canvas`}
      onClick={() => ed.insertComponent(c.id, library)}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('application/x-zaliel-component', JSON.stringify({ id: c.id, library }))}
    >
      <div className="thumb">{src ? <img src={src} alt="" draggable={false} /> : <Component size={18} className="muted" />}</div>
      <div className="cap">{c.name}</div>
    </button>
  );
}
