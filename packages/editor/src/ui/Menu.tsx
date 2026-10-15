import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useDismiss, useEditor } from './hooks';
import { cmd, keyLabel } from './commands';

export type MenuEntry =
  | string // id de comando
  | '-'
  | { heading: string }
  | { label: string; icon?: ReactNode; run: () => void; disabled?: boolean; kbd?: string; checked?: boolean };

export function Menu(props: { x: number; y: number; items: MenuEntry[]; onClose: () => void; minWidth?: number }) {
  const ed = useEditor('selection', 'doc', 'ui');
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: props.x, y: props.y });
  useDismiss(true, props.onClose, ref);
  useLayoutEffect(() => {
    // mantém o menu dentro da janela
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.max(4, Math.min(props.x, window.innerWidth - r.width - 6)), y: Math.max(4, Math.min(props.y, window.innerHeight - r.height - 6)) });
  }, [props.x, props.y]);

  return (
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y, minWidth: props.minWidth }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {props.items.map((it, i) => {
        if (it === '-') return <div key={i} className="sep" />;
        if (typeof it === 'object' && 'heading' in it) return <div key={i} className="heading">{it.heading}</div>;
        if (typeof it === 'string') {
          const c = cmd(it);
          if (!c) return null;
          const enabled = c.enabled ? c.enabled(ed) : true;
          const checked = c.checked?.(ed);
          return (
            <button
              key={i}
              className="item"
              role="menuitem"
              disabled={!enabled}
              onClick={() => {
                props.onClose();
                c.run(ed);
              }}
            >
              <span className="ico">{checked !== undefined ? checked ? <Check size={14} /> : null : c.icon}</span>
              {c.label}
              {c.keys && <span className="kbd">{keyLabel(c.keys[0])}</span>}
            </button>
          );
        }
        return (
          <button
            key={i}
            className="item"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              props.onClose();
              it.run();
            }}
          >
            <span className="ico">{it.checked ? <Check size={14} /> : it.icon}</span>
            {it.label}
            {it.kbd && <span className="kbd">{it.kbd}</span>}
          </button>
        );
      })}
    </div>
  );
}
