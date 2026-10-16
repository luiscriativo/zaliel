import { useState } from 'react';
import { MousePointer2, Hand, Frame, Square, Circle, Minus, Triangle, Star, Type, PenTool, MessageCircle } from 'lucide-react';
import { useEditor, isMac } from './hooks';
import { Menu, type MenuEntry } from './Menu';
import type { Tool } from '../editor';
import type { RecentFile } from '../platform';

const MENUS: { label: string; items: MenuEntry[] }[] = [
  { label: 'Arquivo', items: ['file.new', 'file.newWindow', 'file.open', 'file.importDesign', '-', 'file.save', 'file.saveAs', 'file.autoSave', 'file.saveVersion', '-', 'file.import', 'file.exportPng', 'file.exportSvg', 'file.exportPdf', 'file.exportBatch', '-', 'app.settings', '-', 'file.close'] },
  { label: 'Editar', items: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.duplicate', 'edit.delete', '-', 'edit.selectAll', 'edit.find'] },
  {
    label: 'Objeto',
    items: [
      'obj.group', 'obj.ungroup', 'obj.frame', 'obj.autolayout', '-', 'obj.component', 'obj.variants', 'obj.addVariant', 'obj.slot', 'obj.detach', 'obj.main', '-',
      'obj.union', 'obj.subtract', 'obj.intersect', 'obj.exclude', 'obj.flatten', 'obj.editPoints', '-', 'obj.flipH', 'obj.flipV', 'obj.textOnPath', '-',
      'obj.front', 'obj.forward', 'obj.backward', 'obj.back', '-', 'obj.alignLeft', 'obj.alignH', 'obj.alignRight', 'obj.alignTop', 'obj.alignV', 'obj.alignBottom', '-', 'obj.hide', 'obj.lock',
    ],
  },
  { label: 'Exibir', items: ['view.zoomIn', 'view.zoomOut', 'view.zoom100', 'view.fit', 'view.selection', '-', 'view.pixelGrid', 'view.snapping', 'view.rulers', 'view.layoutGrids', 'view.clearGuides', 'view.comments', '-', 'view.variables', '-', 'view.present'] },
  { label: 'Ajuda', items: ['help.shortcuts', '-', 'help.updates', 'help.about'] },
];

export const TOOLS: { tool: Tool; icon: React.ReactNode; tip: string }[] = [
  { tool: 'move', icon: <MousePointer2 size={16} strokeWidth={1.6} />, tip: 'Mover  V' },
  { tool: 'hand', icon: <Hand size={16} strokeWidth={1.6} />, tip: 'Mão  H' },
  { tool: 'frame', icon: <Frame size={16} strokeWidth={1.6} />, tip: 'Frame  F' },
  { tool: 'rect', icon: <Square size={15} strokeWidth={1.6} />, tip: 'Retângulo  R' },
  { tool: 'ellipse', icon: <Circle size={15} strokeWidth={1.6} />, tip: 'Elipse  O' },
  { tool: 'line', icon: <Minus size={16} strokeWidth={1.6} style={{ transform: 'rotate(-45deg)' }} />, tip: 'Linha  L' },
  { tool: 'polygon', icon: <Triangle size={15} strokeWidth={1.6} />, tip: 'Polígono' },
  { tool: 'star', icon: <Star size={15} strokeWidth={1.6} />, tip: 'Estrela' },
  { tool: 'pen', icon: <PenTool size={15} strokeWidth={1.6} />, tip: 'Caneta  P' },
  { tool: 'text', icon: <Type size={16} strokeWidth={1.6} />, tip: 'Texto  T' },
  { tool: 'comment', icon: <MessageCircle size={15} strokeWidth={1.6} />, tip: 'Comentário  C' },
];

export function TitleBar() {
  const ed = useEditor('doc', 'tool', 'ui');
  const [open, setOpen] = useState<{ i: number; x: number; y: number } | null>(null);
  const [recent, setRecent] = useState<RecentFile[]>([]);

  const openMenu = (i: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setOpen({ i, x: r.left, y: r.bottom + 4 });
    if (i === 0) ed.platform.recent().then(setRecent);
  };

  const items = (i: number): MenuEntry[] => {
    if (i !== 0 || !recent.length) return MENUS[i].items;
    const rec: MenuEntry[] = [{ heading: 'Recentes' }, ...recent.slice(0, 6).map((r) => ({ label: r.name, run: () => ed.openPath(r.path), disabled: r.exists === false }))];
    const list = [...MENUS[0].items];
    list.splice(4, 0, ...rec, '-');
    return list;
  };

  return (
    <header className={`titlebar ${isMac ? 'mac' : ''}`}>
      <div className="wordmark" aria-label="Zaliel">
        Zaliel<span>.</span>
      </div>
      <nav className="menubar">
        {MENUS.map((m, i) => (
          <button
            key={m.label}
            className={open?.i === i ? 'open' : ''}
            onPointerDown={(e) => {
              e.preventDefault();
              if (open?.i === i) setOpen(null);
              else openMenu(i, e.currentTarget);
            }}
            onPointerEnter={(e) => open && open.i !== i && openMenu(i, e.currentTarget)}
          >
            {m.label}
          </button>
        ))}
      </nav>
      {!ed.home && (
        <div className="tools" role="toolbar" aria-label="Ferramentas">
          {TOOLS.map((t) => (
            <button key={t.tool} className={`tool ${ed.tool === t.tool ? 'on' : ''}`} data-tip={t.tip} aria-label={t.tip} onClick={() => ed.setTool(t.tool)}>
              {t.icon}
            </button>
          ))}
        </div>
      )}
      <div className="drag" />
      {!ed.home && <DocTitle />}
      <div className="drag" />
      {open && <Menu x={open.x} y={open.y} items={items(open.i)} onClose={() => setOpen(null)} />}
    </header>
  );
}

function DocTitle() {
  const ed = useEditor('doc');
  return (
    <div className="doc-title">
      <input
        key={ed.doc.id + ed.doc.name}
        defaultValue={ed.doc.name}
        size={Math.max(6, ed.doc.name.length)}
        aria-label="Nome do arquivo"
        onBlur={(e) => ed.rename(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            (e.target as HTMLInputElement).value = ed.doc.name;
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <span className={`state ${ed.model.dirty ? 'dirty' : ''}`}>{ed.model.dirty ? (ed.filePath ? 'Não salvo' : 'Novo · não salvo') : 'Salvo'}</span>
    </div>
  );
}
