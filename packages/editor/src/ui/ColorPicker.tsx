import { useEffect, useRef, useState } from 'react';
import { X, Image as ImageIcon, Variable, Trash2 } from 'lucide-react';
import { hsvToRgb, normalizeHex, parseHex, rgbToHsv, toHex, findVariable, allCollections, type Paint, type GradientStop } from '@zaliel/core';
import { useDismiss, useEditor } from './hooks';
import { NumberField, Select, TextField } from './controls';

export function paintCss(p: Paint, doc?: Parameters<typeof findVariable>[0]): string {
  if (p.type === 'solid') {
    let color = p.color;
    if (p.variable && doc) {
      const v = findVariable(doc, p.variable);
      const val = v && v.variable.values[v.collection.defaultMode];
      if (typeof val === 'string') color = val;
    }
    const c = parseHex(color);
    return `rgba(${c.r},${c.g},${c.b},${c.a * (p.opacity ?? 1)})`;
  }
  if (p.type === 'image') return 'repeating-linear-gradient(45deg, #9a9387 0 4px, #c8c1b4 4px 8px)';
  const stops = [...p.stops].sort((a, b) => a.offset - b.offset).map((s) => {
    const c = parseHex(s.color);
    return `rgba(${c.r},${c.g},${c.b},${c.a}) ${s.offset * 100}%`;
  });
  if (p.type === 'radial') return `radial-gradient(circle, ${stops.join(',')})`;
  if (p.type === 'angular') return `conic-gradient(${stops.join(',')})`;
  return `linear-gradient(${gradientAngle(p) + 90}deg, ${stops.join(',')})`;
}

export function gradientAngle(p: Extract<Paint, { type: 'linear' | 'radial' | 'angular' }>): number {
  const h = p.handles ?? { from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 } };
  return Math.round((Math.atan2(h.to.y - h.from.y, h.to.x - h.from.x) * 180) / Math.PI);
}

function handlesFromAngle(deg: number) {
  const r = (deg * Math.PI) / 180;
  const dx = Math.cos(r) / 2, dy = Math.sin(r) / 2;
  return { from: { x: 0.5 - dx, y: 0.5 - dy }, to: { x: 0.5 + dx, y: 0.5 + dy } };
}

/** Editor HSV + alfa de uma cor hex. */
export function ColorArea({ value, onChange }: { value: string; onChange: (hex: string, merge: string) => void }) {
  const rgba = parseHex(value);
  const [hsv, setHsv] = useState(() => rgbToHsv(rgba));
  const last = useRef(value);
  const merge = useRef(`color-${Math.random()}`);
  useEffect(() => {
    if (value !== last.current) {
      const c = parseHex(value);
      const h = rgbToHsv(c);
      // mantém o matiz quando a cor fica cinza
      setHsv((old) => ({ h: h.s === 0 || h.v === 0 ? old.h : h.h, s: h.s, v: h.v }));
      last.current = value;
    }
  }, [value]);

  const emit = (h: number, s: number, v: number, a: number) => {
    const hex = toHex(hsvToRgb(h, s, v, a));
    last.current = hex;
    setHsv({ h, s, v });
    onChange(hex, merge.current);
  };

  const drag = (e: React.PointerEvent, fn: (x: number, y: number) => void) => {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    merge.current = `color-${Date.now()}`;
    const at = (ev: { clientX: number; clientY: number }) => fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    at(e);
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const hue = toHex(hsvToRgb(hsv.h, 1, 1));
  const solid = toHex({ ...hsvToRgb(hsv.h, hsv.s, hsv.v), a: 1 });
  return (
    <div>
      <div className="sv" style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})` }} onPointerDown={(e) => drag(e, (x, y) => emit(hsv.h, x, 1 - y, rgba.a))}>
        <span className="knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: solid }} />
      </div>
      <div className="slider hue" onPointerDown={(e) => drag(e, (x) => emit(Math.min(359.9, x * 360), hsv.s, hsv.v, rgba.a))}>
        <span className="knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: hue }} />
      </div>
      <div className="slider alpha" onPointerDown={(e) => drag(e, (x) => emit(hsv.h, hsv.s, hsv.v, Math.round(x * 100) / 100))}>
        <i style={{ background: `linear-gradient(90deg, transparent, ${solid})` }} />
        <span className="knob" style={{ left: `${rgba.a * 100}%`, background: solid }} />
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <TextField className="grow" lead="#" value={toHex({ ...rgba, a: 1 }).slice(1).toUpperCase()} onChange={(v) => {
          const n = normalizeHex(v);
          if (n) onChange(toHex({ ...parseHex(n), a: rgba.a }), `hex-${Date.now()}`);
        }} />
        <NumberField className="" value={Math.round(rgba.a * 100)} unit="%" min={0} max={100} onChange={(v, o) => onChange(toHex({ ...rgba, a: v / 100 }), o.merge ?? `a-${Date.now()}`)} />
      </div>
    </div>
  );
}

export function PaintPicker(props: { paint: Paint; anchor: DOMRect; onChange: (p: Paint, merge?: string) => void; onClose: () => void; allowImage?: boolean }) {
  const ed = useEditor('doc');
  const ref = useRef<HTMLDivElement>(null);
  const [stopIndex, setStopIndex] = useState(0);
  useDismiss(true, props.onClose, ref);
  const p = props.paint;

  const top = Math.min(window.innerHeight - 470, Math.max(8, props.anchor.top - 40));
  const left = Math.max(8, props.anchor.left - 260);

  const setType = (type: Paint['type']) => {
    if (type === p.type) return;
    const base = p.type === 'solid' ? p.color : p.type === 'image' ? '#c7a462' : p.stops[0]?.color ?? '#000000';
    if (type === 'solid') props.onChange({ type: 'solid', color: p.type === 'solid' ? p.color : base.slice(0, 7) });
    else if (type === 'image') ed.platform.pickImages().then(async (imgs) => {
      const key = imgs[0] ? await ed.addImageAsset(imgs[0]) : null;
      if (key) props.onChange({ type: 'image', asset: key, scaleMode: 'fill' });
    });
    else {
      const stops: GradientStop[] = p.type === 'solid' ? [{ offset: 0, color: base }, { offset: 1, color: toHex({ ...parseHex(base), a: 0 }) }] : p.type === 'image' ? [{ offset: 0, color: '#1d1c1a' }, { offset: 1, color: '#c7a462' }] : p.stops;
      props.onChange({ type, stops, handles: type === 'linear' ? handlesFromAngle(90) : { from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 0.5 } } });
    }
  };

  const colorVars = allCollections(ed.doc).flatMap((c) => c.variables.filter((v) => v.type === 'color').map((v) => ({ v, c })));
  const docColors = [...new Set(JSON.stringify(ed.doc.pages).match(/"color":"#[0-9a-f]{6,8}"/gi)?.map((m) => m.slice(9, -1).toLowerCase()) ?? [])].slice(0, 18);

  return (
    <div className="popover" ref={ref} style={{ top, left }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="p-head">
        <Select<Paint['type']>
          className="grow"
          value={p.type}
          onChange={setType}
          options={[
            { value: 'solid', label: 'Cor sólida' },
            { value: 'linear', label: 'Gradiente linear' },
            { value: 'radial', label: 'Gradiente radial' },
            { value: 'angular', label: 'Gradiente angular' },
            ...(props.allowImage !== false ? [{ value: 'image' as const, label: 'Imagem' }] : []),
          ]}
        />
        <button className="icon-btn" onClick={props.onClose} aria-label="Fechar"><X size={14} /></button>
      </div>
      <div className="p-body">
        {p.type === 'solid' && (
          <>
            {p.variable ? (
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="var-chip grow"><Variable size={11} /> {findVariable(ed.doc, p.variable)?.variable.name ?? 'variável ausente'}</span>
                <button className="btn small ghost" onClick={() => props.onChange({ ...p, variable: undefined })}>Desligar</button>
              </div>
            ) : null}
            <ColorArea value={p.color} onChange={(hex, merge) => props.onChange({ ...p, color: hex, variable: undefined }, merge)} />
          </>
        )}
        {(p.type === 'linear' || p.type === 'radial' || p.type === 'angular') && (
          <>
            <div
              className="stops"
              style={{ background: `${paintCss({ ...p, type: 'linear', handles: handlesFromAngle(0) })}, repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 0 0 / 8px 8px` }}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).classList.contains('stop')) return;
                const r = e.currentTarget.getBoundingClientRect();
                const offset = Math.round(((e.clientX - r.left) / r.width) * 100) / 100;
                const stops = [...p.stops, { offset, color: p.stops[stopIndex]?.color ?? '#000000' }];
                props.onChange({ ...p, stops });
                setStopIndex(stops.length - 1);
              }}
            >
              {p.stops.map((s, i) => (
                <span
                  key={i}
                  className={`stop ${i === stopIndex ? 'on' : ''}`}
                  style={{ left: `${s.offset * 100}%`, background: s.color }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setStopIndex(i);
                    const bar = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                    const el = e.currentTarget;
                    el.setPointerCapture(e.pointerId);
                    const merge = `stop-${Date.now()}`;
                    const move = (ev: PointerEvent) => {
                      const offset = Math.min(1, Math.max(0, Math.round(((ev.clientX - bar.left) / bar.width) * 100) / 100));
                      props.onChange({ ...p, stops: p.stops.map((x, j) => (j === i ? { ...x, offset } : x)) }, merge);
                    };
                    const up = () => {
                      el.removeEventListener('pointermove', move);
                      el.removeEventListener('pointerup', up);
                    };
                    el.addEventListener('pointermove', move);
                    el.addEventListener('pointerup', up);
                  }}
                />
              ))}
            </div>
            <div className="row" style={{ marginBottom: 10 }}>
              {p.type !== 'radial' && (
                <NumberField lead="∠" value={gradientAngle(p)} unit="°" onChange={(v, o) => props.onChange({ ...p, handles: handlesFromAngle(v) }, o.merge)} />
              )}
              <span className="muted grow">{p.stops.length} paradas</span>
              <button className="icon-btn" disabled={p.stops.length <= 2} data-tip="Remover parada" onClick={() => {
                props.onChange({ ...p, stops: p.stops.filter((_, j) => j !== stopIndex) });
                setStopIndex(0);
              }}><Trash2 size={13} /></button>
            </div>
            {p.stops[stopIndex] && (
              <ColorArea value={p.stops[stopIndex].color} onChange={(hex, merge) => props.onChange({ ...p, stops: p.stops.map((x, j) => (j === stopIndex ? { ...x, color: hex } : x)) }, merge)} />
            )}
          </>
        )}
        {p.type === 'image' && (
          <>
            <div style={{ height: 120, borderRadius: 5, overflow: 'hidden', background: 'var(--bg-input)', display: 'grid', placeItems: 'center', marginBottom: 10 }}>
              {ed.doc.assets[p.asset] ? (
                <img src={`data:${ed.doc.assets[p.asset].mime};base64,${ed.doc.assets[p.asset].data}`} style={{ maxWidth: '100%', maxHeight: 120 }} alt="" />
              ) : (
                <ImageIcon className="muted" />
              )}
            </div>
            <Select
              className="grow"
              value={p.scaleMode}
              onChange={(v) => props.onChange({ ...p, scaleMode: v })}
              options={[
                { value: 'fill', label: 'Preencher (cortar)' },
                { value: 'fit', label: 'Encaixar (sem cortar)' },
                { value: 'stretch', label: 'Esticar' },
                { value: 'tile', label: 'Repetir' },
              ]}
            />
          </>
        )}
        {p.type === 'solid' && (docColors.length > 0 || colorVars.length > 0) && (
          <>
            {colorVars.length > 0 && (
              <>
                <div className="label" style={{ marginTop: 12 }}>Variáveis de cor</div>
                <div className="doc-colors">
                  {colorVars.map(({ v, c }) => {
                    const val = v.values[c.defaultMode];
                    return (
                      <button key={v.id} className="swatch" title={`${c.name} / ${v.name}`} onClick={() => props.onChange({ ...p, color: typeof val === 'string' ? val : p.color, variable: v.id })} style={p.variable === v.id ? { boxShadow: '0 0 0 2px var(--accent)' } : undefined}>
                        <i style={{ background: typeof val === 'string' ? val : '#000' }} />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {docColors.length > 0 && (
              <>
                <div className="label" style={{ marginTop: 12 }}>Cores do documento</div>
                <div className="doc-colors">
                  {docColors.map((c) => (
                    <button key={c} className="swatch" title={c} onClick={() => props.onChange({ ...p, color: c, variable: undefined })}>
                      <i style={{ background: c }} />
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
