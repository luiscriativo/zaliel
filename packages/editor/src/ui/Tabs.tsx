// Abas dos arquivos abertos na janela.
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useEditor } from './hooks';

export function TabBar() {
  const ed = useEditor('ui', 'doc');
  const [drag, setDrag] = useState<string | null>(null);
  return (
    <div className="tabbar" role="tablist" aria-label="Arquivos abertos">
      {ed.tabs.map((t, i) => {
        const m = ed.tabModel(t);
        const active = t.id === ed.activeTab;
        const path = ed.tabPath(t);
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={active}
            className={`tab ${active ? 'on' : ''} ${drag === t.id ? 'dragging' : ''}`}
            title={path ?? `${m.doc.name} (ainda não salvo)`}
            draggable
            onDragStart={(e) => {
              setDrag(t.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => setDrag(null)}
            onDragOver={(e) => {
              if (!drag || drag === t.id) return;
              e.preventDefault();
              ed.moveTab(drag, i);
            }}
            onPointerDown={(e) => {
              if (e.button === 0) ed.switchTab(t.id);
            }}
            onAuxClick={(e) => {
              if (e.button === 1) void ed.closeTab(t.id);
            }}
          >
            <span className="tab-name">{m.doc.name}</span>
            {m.dirty && <span className="tab-dirty" aria-label="Alterações não salvas" />}
            <button
              className="tab-close"
              aria-label={`Fechar ${m.doc.name}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void ed.closeTab(t.id)}
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
      <button className="tab-new" aria-label="Novo arquivo" title="Novo arquivo (Ctrl+N)" onClick={() => ed.newDocument()}>
        <Plus size={13} />
      </button>
    </div>
  );
}
