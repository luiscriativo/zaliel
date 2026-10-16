// Aba Protótipo: ligações ao clicar, transições, tela inicial e o botão de apresentar.
import { Play, Flag, Link2, Layers } from 'lucide-react';
import { prototypeLinks, screens, startScreen, screenOf, TRANSITIONS, OVERLAY_POSITIONS, OVERLAY_BACKGROUND, type Interaction } from '@zaliel/core';
import { useEditor } from './hooks';
import { NumberField, Section, Select, Check, common, MIXED } from './controls';
import { keyLabel } from './commands';

export function PrototypePanel() {
  const ed = useEditor('selection', 'doc');
  const nodes = ed.selectedNodes();
  const page = ed.page;
  const list = screens(page);
  const start = startScreen(page);
  const links = prototypeLinks(page);
  const ids = nodes.map((n) => n.id);
  const inter = common(nodes.map((n) => n.interactions?.[0] ?? null));
  const it = inter === MIXED ? null : (inter as Interaction | null | undefined) ?? null;
  const own = nodes.length === 1 ? screenOf(page, nodes[0].id, (id) => ed.model.index.parentId(id)) : undefined;
  const set = (patch: Partial<Interaction> | null) => {
    if (!patch) return ed.setInteraction(ids, undefined);
    const base: Interaction = it ?? { trigger: 'click', action: 'navigate', transition: 'instant', duration: 300 };
    ed.setInteraction(ids, { ...base, ...patch });
  };
  const action = it ? it.action : 'none';
  const ov = it?.overlay ?? {};
  const bg = ov.background === undefined ? OVERLAY_BACKGROUND : ov.background;

  return (
    <>
      <Section title="Apresentação">
        <button className="btn primary block" onClick={() => ed.present()} disabled={!list.length}>
          <Play size={13} /> Apresentar{own ? ` a partir de “${own.name}”` : ''}
        </button>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="label" style={{ width: 80, flex: 'none' }}><Flag size={11} style={{ verticalAlign: -1 }} /> Início</span>
          <Select className="grow" value={start?.id ?? ''} options={list.map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => ed.setFlowStart(v)} />
        </div>
        <div className="label" style={{ marginTop: 6 }}>{links.length ? `${links.length} ${links.length === 1 ? 'ligação' : 'ligações'} nesta página.` : 'Nenhuma ligação ainda.'} Atalho: {keyLabel('Mod+Alt+Enter')}.</div>
      </Section>

      {nodes.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 24 }}>
          <div className="title">Ligue as telas</div>
          Selecione um botão (ou qualquer camada) e escolha para qual frame ele leva ao ser clicado.
        </div>
      ) : (
        <Section title="Ao clicar">
          {inter === MIXED && <div className="muted" style={{ marginBottom: 6 }}>Vários valores</div>}
          <Select
            className="block"
            value={inter === MIXED ? MIXED : action}
            options={[
              { value: 'none', label: 'Nenhuma ação' },
              { value: 'navigate', label: 'Navegar para…' },
              { value: 'overlay', label: 'Abrir sobreposição…' },
              { value: 'close', label: 'Fechar sobreposição' },
              { value: 'back', label: 'Voltar' },
            ]}
            onChange={(v) => {
              if (v === 'none') set(null);
              else if (v === 'back' || v === 'close') set({ action: v, target: undefined, overlay: undefined });
              else if (v === 'overlay') set({ action: 'overlay', target: it?.target ?? list.find((s) => s.id !== own?.id)?.id, transition: it?.transition ?? 'dissolve', duration: it?.duration ?? 200, overlay: { position: 'center', closeOutside: true } });
              else set({ action: 'navigate', target: it?.target ?? list.find((s) => s.id !== own?.id)?.id, overlay: undefined });
            }}
          />
          {it?.action === 'overlay' && (
            <>
              <div className="row" style={{ marginTop: 8 }}>
                <span className="label" style={{ width: 80, flex: 'none' }}><Layers size={11} style={{ verticalAlign: -1 }} /> Frame</span>
                <Select className="grow" value={it.target ?? ''} options={list.filter((s) => s.id !== own?.id).map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => set({ target: v })} />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <span className="label" style={{ width: 80, flex: 'none' }}>Posição</span>
                <Select className="grow" value={ov.position ?? 'center'} options={OVERLAY_POSITIONS} onChange={(v) => set({ overlay: { ...ov, position: v } })} />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <span className="label" style={{ width: 80, flex: 'none' }}>Fundo</span>
                <NumberField
                  className="grow"
                  unit="%"
                  min={0}
                  max={100}
                  value={bg ? Math.round((parseInt(bg.slice(7, 9) || 'ff', 16) / 255) * 100) : 0}
                  onChange={(v, o) => {
                    const a = Math.round((Math.max(0, Math.min(100, v)) / 100) * 255);
                    ed.setInteraction(ids, { ...it, overlay: { ...ov, background: a ? `#000000${a.toString(16).padStart(2, '0')}` : '' } }, o.merge);
                  }}
                />
              </div>
              <div style={{ marginTop: 8 }}>
                <Check checked={ov.closeOutside !== false} onChange={(v) => set({ overlay: { ...ov, closeOutside: v } })} label="Fechar ao clicar fora" />
              </div>
            </>
          )}
          {(it?.action === 'navigate' || it?.action === 'overlay') && (
            <>
              {it.action === 'navigate' && (
                <div className="row" style={{ marginTop: 8 }}>
                  <span className="label" style={{ width: 80, flex: 'none' }}><Link2 size={11} style={{ verticalAlign: -1 }} /> Destino</span>
                  <Select className="grow" value={it.target ?? ''} options={list.filter((s) => s.id !== own?.id).map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => set({ target: v })} />
                </div>
              )}
              {it.target && !ed.model.index.get(it.target) && <div className="label" style={{ color: 'var(--danger)', marginTop: 4 }}>O frame de destino não existe mais.</div>}
              <div className="row" style={{ marginTop: 8 }}>
                <span className="label" style={{ width: 80, flex: 'none' }}>Transição</span>
                <Select className="grow" value={it.transition ?? 'instant'} options={TRANSITIONS} onChange={(v) => set({ transition: v })} />
              </div>
              {it.transition && it.transition !== 'instant' && (
                <div className="row" style={{ marginTop: 8 }}>
                  <span className="label" style={{ width: 80, flex: 'none' }}>Duração</span>
                  <NumberField className="grow" unit="ms" min={50} max={3000} step={10} value={it.duration ?? 300} onChange={(v, o) => ed.setInteraction(ids, { ...it, duration: Math.round(v) }, o.merge)} />
                </div>
              )}
            </>
          )}
          {own && nodes[0].id === own.id && (
            <button className="btn small ghost" style={{ marginTop: 10 }} onClick={() => ed.setFlowStart(own.id)} disabled={start?.id === own.id}>
              <Flag size={12} /> {start?.id === own.id ? 'Esta tela é o início' : 'Usar como tela inicial'}
            </button>
          )}
        </Section>
      )}
    </>
  );
}
