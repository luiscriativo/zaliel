// Modo de apresentação do protótipo: mostra uma tela por vez, em tela cheia,
// e segue as ligações ao clicar. Tudo desenhado pelo mesmo motor do canvas.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RotateCcw, X } from 'lucide-react';
import { hotspots, screens, startScreen, overlayRect, OVERLAY_BACKGROUND, type SceneNode, type Hotspot } from '@zaliel/core';
import { useEditor } from './hooks';
import type { Editor } from '../editor';

const images = new Map<string, string>();

/** Imagem (URL de blob) de uma tela, guardada por revisão do documento. */
function screenImage(ed: Editor, n: SceneNode, scale: number): string | null {
  const key = `${n.id}:${ed.model.revision}:${scale}`;
  const hit = images.get(key);
  if (hit) return hit;
  const bytes = ed.host?.exportImage(n, scale, 'png');
  if (!bytes) return null;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
  images.set(key, url);
  if (images.size > 40) {
    const [k, old] = images.entries().next().value as [string, string];
    images.delete(k);
    URL.revokeObjectURL(old);
  }
  return url;
}

function label(ed: Editor, h: Hotspot): string {
  const it = h.interaction;
  if (it.action === 'back') return 'Voltar';
  if (it.action === 'close') return 'Fechar sobreposição';
  const name = ed.model.index.get(it.target ?? '')?.name ?? 'tela';
  return it.action === 'overlay' ? `Abrir ${name}` : `Ir para ${name}`;
}

/** Áreas clicáveis de uma tela (ou sobreposição) já na escala da apresentação. */
function Hotspots({ ed, spots, s, flash }: { ed: Editor; spots: Hotspot[]; s: number; flash: number }) {
  return (
    <>
      {spots.map((h) => (
        <button
          key={`${h.id}-${flash}`}
          className={`hotspot ${flash ? 'flash' : ''}`}
          style={{ left: h.rect.x * s, top: h.rect.y * s, width: h.rect.width * s, height: h.rect.height * s }}
          aria-label={label(ed, h)}
          onClick={(e) => {
            e.stopPropagation();
            ed.presentAct(h.interaction);
          }}
        />
      ))}
    </>
  );
}

function OverlaySpots({ ed, node, s, flash }: { ed: Editor; node: SceneNode; s: number; flash: number }) {
  const spots = useMemo(() => hotspots(node, ed.resolve), [node, ed, ed.model.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Hotspots ed={ed} spots={spots} s={s} flash={flash} />;
}

export function Presentation() {
  const ed = useEditor('ui', 'doc');
  const p = ed.presenting;
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [flash, setFlash] = useState(0);
  const [leaving, setLeaving] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const r = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);

  // a tela anterior fica visível durante a transição
  useEffect(() => {
    if (!p?.from || !p.transition || p.transition === 'instant') return setLeaving(null);
    setLeaving(p.from);
    const t = setTimeout(() => setLeaving(null), p.duration ?? 300);
    return () => clearTimeout(t);
  }, [p?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const page = p ? ed.model.index.page(p.pageId) : undefined;
  const screen = p ? ed.model.index.get(p.screen) : undefined;

  useEffect(() => {
    if (!p) return;
    const key = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        ed.stopPresenting();
      } else if (e.key === 'Backspace') ed.presentBack();
      else if (e.key.toLowerCase() === 'r' && page) {
        const s = startScreen(page);
        if (s) ed.presenting = { ...p, screen: s.id, history: [], from: undefined, seq: p.seq + 1 };
        ed.emit('ui');
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && page) {
        // setas: telas da página em ordem de leitura
        const list = screens(page).sort((a, b) => a.y - b.y || a.x - b.x);
        const i = list.findIndex((s) => s.id === p.screen);
        const next = list[i + (e.key === 'ArrowRight' ? 1 : -1)];
        if (next) ed.presentGo(next.id, { transition: e.key === 'ArrowRight' ? 'slide-left' : 'slide-right', duration: 250 });
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [ed, p, page]);

  const fitScale = (n: SceneNode) => Math.min(1, (view.w - 48) / Math.max(1, n.width), (view.h - 96) / Math.max(1, n.height));
  const spots = useMemo(() => (screen ? hotspots(screen, ed.resolve) : []), [screen, ed, ed.model.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const overlays = (p?.overlays ?? []).flatMap((o) => {
    const node = ed.model.index.get(o.id);
    return node ? [{ ...o, node }] : [];
  });

  if (!p || !screen || !page) return null;
  const s = fitScale(screen);
  const dpr = Math.min(3, (window.devicePixelRatio || 1) * s);
  const src = screenImage(ed, screen, Math.max(0.25, dpr));
  const old = leaving ? ed.model.index.get(leaving) : undefined;
  const oldSrc = old ? screenImage(ed, old, Math.max(0.25, Math.min(3, (window.devicePixelRatio || 1) * fitScale(old)))) : null;
  const anim = { animationDuration: `${p.duration ?? 300}ms` };

  return (
    <div className="present" role="dialog" aria-label="Apresentação do protótipo">
      <header className="present-bar">
        <span className="present-title">{screen.name}</span>
        <span className="muted">{page.name}</span>
        <span className="grow" />
        <button className="btn small ghost" onClick={() => ed.presentBack()} disabled={!p.history.length} title="Voltar (Backspace)"><ArrowLeft size={13} /> Voltar</button>
        <button className="btn small ghost" onClick={() => {
          const st = startScreen(page);
          if (st) ed.presenting = { ...p, screen: st.id, history: [], from: undefined, seq: p.seq + 1 };
          ed.emit('ui');
        }} title="Recomeçar (R)"><RotateCcw size={13} /> Recomeçar</button>
        <button className="btn small" onClick={() => ed.stopPresenting()} title="Sair (Esc)"><X size={13} /> Sair</button>
      </header>
      <div
        className="present-stage"
        ref={stageRef}
        onClick={(e) => {
          if (e.target === e.currentTarget) setFlash((f) => f + 1);
        }}
      >
        {old && oldSrc && (
          <div className="present-screen leaving" style={{ width: old.width * fitScale(old), height: old.height * fitScale(old), ...anim }}>
            <img src={oldSrc} alt="" draggable={false} />
          </div>
        )}
        <div key={p.seq} className={`present-screen ${p.from && p.transition && p.transition !== 'instant' ? `enter-${p.transition}` : ''}`} style={{ width: screen.width * s, height: screen.height * s, ...anim }} onClick={() => setFlash((f) => f + 1)}>
          {src && <img src={src} alt={screen.name} draggable={false} />}
          <Hotspots ed={ed} spots={spots} s={s} flash={flash} />
          {overlays.map((o, i) => {
            const opts = o.interaction.overlay ?? {};
            const r = overlayRect(screen.width, screen.height, o.node.width, o.node.height, opts.position);
            const img = screenImage(ed, o.node, Math.max(0.25, dpr));
            const tr = o.interaction.transition && o.interaction.transition !== 'instant' ? o.interaction.transition : null;
            const bg = opts.background === undefined ? OVERLAY_BACKGROUND : opts.background;
            return (
              <div key={o.id} className="present-layer" style={{ zIndex: i + 1 }}>
                <div
                  className="present-scrim"
                  style={{ background: bg || 'transparent', ...anim }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (opts.closeOutside !== false) ed.presentClose();
                    else setFlash((f) => f + 1);
                  }}
                />
                <div
                  className={`present-overlay ${tr ? `enter-${tr}` : ''}`}
                  style={{ left: r.x * s, top: r.y * s, width: r.width * s, height: r.height * s, ...anim }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFlash((f) => f + 1);
                  }}
                >
                  {img && <img src={img} alt={o.node.name} draggable={false} />}
                  {i === overlays.length - 1 && <OverlaySpots ed={ed} node={o.node} s={s} flash={flash} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <footer className="present-foot muted">
        {spots.length ? 'Clique nas áreas com ligação. Clique fora delas para vê-las.' : 'Esta tela não tem ligações. Use as setas para passar as telas.'} · Esc para sair
      </footer>
    </div>
  );
}
