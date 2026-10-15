// Controles básicos dos painéis: número arrastável, texto, seletor, segmentos, seção.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export const MIXED = Symbol('mixed');
export type Maybe<T> = T | typeof MIXED;

/** Valor comum a vários nós, ou MIXED. */
export function common<T>(values: T[]): Maybe<T> | undefined {
  if (!values.length) return undefined;
  const first = JSON.stringify(values[0]);
  return values.every((v) => JSON.stringify(v) === first) ? values[0] : MIXED;
}

/** Aceita contas simples: "120/2", "8*3+4", "-(10+2)". Sem eval. */
export function evalExpr(s: string): number | null {
  const src = s.replace(/,/g, '.').replace(/\s+/g, '');
  if (!src) return null;
  let i = 0;
  const peek = () => src[i];
  const num = (): number | null => {
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') return null;
      i++;
      return v;
    }
    if (peek() === '-' || peek() === '+') {
      const neg = src[i++] === '-';
      const v = num();
      return v === null ? null : neg ? -v : v;
    }
    const m = /^\d*\.?\d+(e[-+]?\d+)?|^\d+\.?/i.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const term = (): number | null => {
    let v = num();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = src[i++];
      const r = num();
      if (r === null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = (): number | null => {
    let v = term();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = src[i++];
      const r = term();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = expr();
  return v !== null && i === src.length && Number.isFinite(v) ? v : null;
}

function fmt(v: number, precision = 2) {
  const p = 10 ** precision;
  return String(Math.round(v * p) / p);
}

export function NumberField(props: {
  value: Maybe<number> | undefined;
  onChange: (v: number, opts: { merge?: string; final?: boolean }) => void;
  lead?: ReactNode;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  placeholder?: string;
  title?: string;
  className?: string;
}) {
  const { value, onChange, lead, unit, min = -Infinity, max = Infinity, step = 1, precision = 2 } = props;
  const shown = value === MIXED ? '' : value === undefined ? '' : fmt(value, precision);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  const mergeKey = useRef(`num-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = () => {
    const v = evalExpr(text);
    if (v === null) {
      setText(shown);
      return;
    }
    const c = clamp(v);
    if (value === MIXED || c !== value) onChange(c, { final: true });
    setText(fmt(c, precision));
  };

  // arrastar o rótulo muda o valor
  const scrub = (e: React.PointerEvent) => {
    if (value === undefined) return;
    e.preventDefault();
    const start = e.clientX;
    const base = value === MIXED ? 0 : value;
    const key = `${mergeKey.current}-${Date.now()}`;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const v = clamp(Math.round((base + ((ev.clientX - start) / 2) * step * k) / (step * (ev.altKey ? 0.1 : 1))) * step * (ev.altKey ? 0.1 : 1));
      onChange(Number(fmt(v, precision)), { merge: key });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <label className={`field ${props.className ?? ''}`} title={props.title}>
      {lead !== undefined && (
        <span className="lead" onPointerDown={scrub}>
          {lead}
        </span>
      )}
      <input
        value={focused ? text : shown}
        placeholder={value === MIXED ? 'Misto' : props.placeholder ?? ''}
        onFocus={(e) => {
          setFocused(true);
          setText(shown);
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(shown);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = evalExpr(text) ?? (value === MIXED || value === undefined ? 0 : value);
            const v = clamp(base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            setText(fmt(v, precision));
            onChange(v, { merge: mergeKey.current });
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </label>
  );
}

export function TextField(props: { value: string; onChange: (v: string) => void; placeholder?: string; lead?: ReactNode; className?: string; live?: boolean }) {
  const [text, setText] = useState(props.value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(props.value);
  }, [props.value, focused]);
  return (
    <label className={`field text ${props.className ?? ''}`}>
      {props.lead !== undefined && <span className="lead">{props.lead}</span>}
      <input
        value={text}
        placeholder={props.placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (text !== props.value) props.onChange(text);
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (props.live) props.onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(props.value);
            setTimeout(() => (e.target as HTMLInputElement).blur());
          }
        }}
      />
    </label>
  );
}

export function Select<T extends string | number>(props: {
  value: Maybe<T> | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
  title?: string;
}) {
  return (
    <select
      className={`select ${props.className ?? ''}`}
      title={props.title}
      value={props.value === MIXED || props.value === undefined ? '' : String(props.value)}
      onChange={(e) => {
        const opt = props.options.find((o) => String(o.value) === e.target.value);
        if (opt) props.onChange(opt.value);
      }}
    >
      {(props.value === MIXED || props.value === undefined) && <option value="">{props.value === MIXED ? 'Misto' : '—'}</option>}
      {props.options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Seg<T extends string>(props: { value: Maybe<T> | undefined; options: { value: T; label: ReactNode; tip?: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`seg ${props.className ?? ''}`}>
      {props.options.map((o) => (
        <button key={o.value} className={props.value === o.value ? 'on' : ''} onClick={() => props.onChange(o.value)} data-tip={o.tip} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function IconBtn(props: { icon: ReactNode; tip?: string; onClick?: (e: React.MouseEvent) => void; on?: boolean; disabled?: boolean; className?: string; tipPos?: 'left' }) {
  return (
    <button type="button" className={`icon-btn ${props.on ? 'on' : ''} ${props.className ?? ''}`} onClick={props.onClick} disabled={props.disabled} data-tip={props.tip} data-tip-pos={props.tipPos} aria-label={props.tip}>
      {props.icon}
    </button>
  );
}

export function Section(props: { title: string; actions?: ReactNode; children?: ReactNode; empty?: boolean; collapsible?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  const showBody = !props.collapsible || open;
  return (
    <div className={`section ${props.empty || !showBody ? 'empty' : ''} ${!showBody ? 'collapsed' : ''}`}>
      <div className="section-head">
        {props.collapsible ? (
          <button type="button" className="row" style={{ background: 'none', border: 0, padding: 0, gap: 4 }} onClick={() => setOpen(!open)}>
            <span className="muted" style={{ display: 'grid' }}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
            <span className="section-title">{props.title}</span>
          </button>
        ) : (
          <span className="section-title">{props.title}</span>
        )}
        {props.actions && <div className="actions">{props.actions}</div>}
      </div>
      {showBody && props.children}
    </div>
  );
}

export function Check(props: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}
