import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Plus, Trash2, RefreshCw, Download, CheckCircle2 } from 'lucide-react';
import { uid, clone, type VariableCollection, type Variable, type VariableType } from '@zaliel/core';
import { useEditor, useDismiss, timeAgo } from './hooks';
import { COMMANDS, keyLabel } from './commands';
import { NumberField, Seg, Check, TextField } from './controls';
import { PaintPicker } from './ColorPicker';
import type { UpdateStatus } from '../platform';

function Dialog(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, props.onClose, ref);
  return (
    <div className="backdrop">
      <div className={`dialog ${props.wide ? 'wide' : ''}`} ref={ref} role="dialog" aria-label={props.title}>
        <header>
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Fechar"><X size={15} /></button>
        </header>
        <div className="body">{props.children}</div>
        {props.footer && <footer>{props.footer}</footer>}
      </div>
    </div>
  );
}

export function Dialogs() {
  const ed = useEditor('ui');
  const close = () => ed.openDialog(null);
  switch (ed.dialog) {
    case 'settings':
      return <SettingsDialog onClose={close} />;
    case 'shortcuts':
      return <ShortcutsDialog onClose={close} />;
    case 'about':
      return <AboutDialog onClose={close} />;
    case 'variables':
      return <VariablesDialog onClose={close} />;
    case 'updates':
      return <UpdatesDialog onClose={close} />;
    default:
      return null;
  }
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const ed = useEditor('ui');
  const s = ed.settings;
  const save = async (patch: Partial<typeof s>) => {
    await ed.setSettings(patch);
    ed.toast('success', 'Preferência salva.');
  };
  return (
    <Dialog title="Preferências" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Pronto</button>}>
      <div className="setting">
        <div className="s-title">Tema</div>
        <div className="s-desc">Automático segue o tema do sistema operacional.</div>
        <Seg value={s.theme} options={[{ value: 'system', label: 'Automático' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Escuro' }]} onChange={(v) => save({ theme: v })} />
      </div>
      <div className="setting">
        <div className="s-title">Deslocamento com as setas</div>
        <div className="s-desc">Quanto a seleção anda com as setas (e com Shift + setas).</div>
        <div className="row" style={{ width: 170 }}>
          <NumberField lead="→" min={0.01} value={s.nudge} onChange={(v) => save({ nudge: v })} />
          <NumberField lead="⇧" min={0.01} value={s.bigNudge} onChange={(v) => save({ bigNudge: v })} />
        </div>
      </div>
      <div className="setting">
        <div className="s-title">Encaixe inteligente</div>
        <div className="s-desc">Guias que alinham bordas e centros enquanto você move ou redimensiona. Segure Ctrl para ignorar.</div>
        <Check checked={s.snapping} onChange={(v) => save({ snapping: v })} label="" />
      </div>
      <div className="setting">
        <div className="s-title">Grade de pixels</div>
        <div className="s-desc">Mostra a grade quando o zoom passa de 800%.</div>
        <Check checked={s.pixelGrid} onChange={(v) => save({ pixelGrid: v })} label="" />
      </div>
    </Dialog>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const groups: [string, string][] = [['file.', 'Arquivo'], ['edit.', 'Edição'], ['obj.', 'Objeto'], ['view.', 'Exibição']];
  const tools: [string, string][] = [['V', 'Mover'], ['H', 'Mão (ou segure Espaço)'], ['F', 'Frame'], ['R', 'Retângulo'], ['O', 'Elipse'], ['L', 'Linha'], ['P', 'Caneta'], ['T', 'Texto']];
  const extra: [string, string][] = [
    ['Setas', 'Mover a seleção'], ['Enter', 'Selecionar filhos / editar texto'], ['Shift+Enter', 'Selecionar o pai'], ['Esc', 'Sair / desmarcar'],
    ['Alt + arrastar', 'Duplicar'], ['Shift + arrastar', 'Travar eixo / manter proporção'], ['Ctrl + clique', 'Selecionar camada interna'], ['Ctrl + roda', 'Zoom'],
  ];
  return (
    <Dialog title="Atalhos de teclado" onClose={onClose} wide>
      <div className="keys">
        <h3>Ferramentas</h3>
        {tools.map(([k, l]) => (
          <div className="k" key={k}><span>{l}</span><kbd>{k}</kbd></div>
        ))}
        <h3>No canvas</h3>
        {extra.map(([k, l]) => (
          <div className="k" key={k}><span>{l}</span><kbd>{k}</kbd></div>
        ))}
        {groups.map(([prefix, title]) => (
          <Fragment key={title}>
            <h3>{title}</h3>
            {COMMANDS.filter((c) => c.id.startsWith(prefix) && c.keys).map((c) => (
              <div className="k" key={c.id}><span>{c.label}</span><kbd>{keyLabel(c.keys![0])}</kbd></div>
            ))}
          </Fragment>
        ))}
      </div>
    </Dialog>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  return (
    <Dialog title="Sobre" onClose={onClose}>
      <div style={{ textAlign: 'center', padding: '10px 0 6px' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 54, lineHeight: 1 }}>
          Zaliel<span style={{ color: 'var(--accent)' }}>.</span>
        </div>
        <div className="muted" style={{ marginTop: 6 }}>Versão {ed.platform.version}</div>
        <p style={{ color: 'var(--text-2)', lineHeight: 1.6, maxWidth: 420, margin: '18px auto 0' }}>
          Editor de interfaces para desktop. Funciona inteiramente offline, não usa inteligência artificial e não envia nada para a internet. A única conexão possível é a verificação de atualizações — e só quando você pede.
        </p>
        <p className="muted" style={{ marginTop: 14 }}>Renderização com Skia (CanvasKit) · Tipografia Inter e Cormorant Garamond</p>
      </div>
    </Dialog>
  );
}

function UpdatesDialog({ onClose }: { onClose: () => void }) {
  const ed = useEditor();
  const [st, setSt] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    ed.platform.update.status().then(setSt);
    return ed.platform.on('update', setSt);
  }, [ed]);
  if (!st) return null;
  const mb = (b?: number) => (b ? (b / 1048576).toFixed(1).replace('.', ',') : '0');
  let body: ReactNode;
  let action: ReactNode = <button className="btn primary" onClick={() => ed.platform.update.check()}><RefreshCw size={13} /> Verificar agora</button>;
  switch (st.state) {
    case 'dev':
      body = 'Esta é uma versão de desenvolvimento — não há o que atualizar.';
      action = null;
      break;
    case 'checking':
      body = 'Consultando as versões publicadas…';
      action = <button className="btn primary" disabled><RefreshCw size={13} className="spin" /> Verificando…</button>;
      break;
    case 'available':
      body = <>A versão <strong>{st.version}</strong> está disponível (você usa a {st.current}).{st.manual ? ' Neste sistema, a instalação é feita pelo arquivo baixado do site.' : ''}</>;
      action = <button className="btn primary" onClick={() => ed.platform.update.download()}><Download size={13} /> {st.manual ? 'Abrir página da versão' : 'Baixar atualização'}</button>;
      break;
    case 'downloading':
      body = (
        <>
          Baixando a versão {st.version}… {st.percent}%
          <div className="progress" style={{ margin: '10px 0 4px' }}><i style={{ width: `${st.percent}%` }} /></div>
          <span className="muted">{mb(st.transferred)} de {mb(st.total)} MB{st.bytesPerSecond ? ` · ${mb(st.bytesPerSecond)} MB/s` : ''}</span>
        </>
      );
      action = null;
      break;
    case 'downloaded':
      body = <>A versão {st.version} está pronta. Ela será instalada ao reiniciar — ou quando você fechar o Zaliel.</>;
      action = <button className="btn primary" onClick={async () => (await ed.confirmDiscard()) && ed.platform.update.install()}>Reiniciar e instalar</button>;
      break;
    case 'not-available':
      body = <><CheckCircle2 size={14} style={{ color: 'var(--success)', verticalAlign: -2 }} /> Você está na versão mais recente (v{st.current}){st.checkedAt ? ` · verificado ${timeAgo(st.checkedAt)}` : ''}.</>;
      break;
    case 'error':
      body = <span style={{ color: 'var(--danger)' }}>{st.error}</span>;
      action = <button className="btn primary" onClick={() => ed.platform.update.check()}>Tentar de novo</button>;
      break;
    default:
      body = 'O Zaliel nunca se conecta à internet sozinho. Clique abaixo para consultar se há uma versão nova — essa é a única conexão que o aplicativo faz.';
  }
  return (
    <Dialog title="Atualizações" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Fechar</button>{action}</>}>
      <div className="muted" style={{ marginBottom: 10 }}>Zaliel v{st.current}</div>
      <div style={{ lineHeight: 1.6, color: 'var(--text)' }}>{body}</div>
    </Dialog>
  );
}

// ── Variáveis ────────────────────────────────────────────────────────────────

function VariablesDialog({ onClose }: { onClose: () => void }) {
  const ed = useEditor('doc');
  const cols = ed.doc.variables;
  const [active, setActive] = useState(cols[0]?.id ?? null);
  const [picker, setPicker] = useState<{ vid: string; mode: string; rect: DOMRect } | null>(null);
  const col = cols.find((c) => c.id === active) ?? cols[0];

  const save = (next: VariableCollection[], merge?: string) => ed.setVariables(next, merge);
  const patchCol = (fn: (c: VariableCollection) => void, merge?: string) => {
    const next = clone(cols);
    const c = next.find((x) => x.id === col!.id);
    if (c) fn(c);
    save(next, merge);
  };
  const addCollection = () => {
    const mode = { id: uid(), name: 'Claro' };
    const c: VariableCollection = { id: uid(), name: cols.length ? `Coleção ${cols.length + 1}` : 'Tema', modes: [mode], defaultMode: mode.id, variables: [] };
    save([...cols, c]);
    setActive(c.id);
  };
  const addVar = (type: VariableType) =>
    patchCol((c) => {
      const values: Record<string, Variable['values'][string]> = {};
      for (const m of c.modes) values[m.id] = type === 'color' ? '#1d1c1a' : type === 'number' ? 8 : type === 'boolean' ? true : 'Texto';
      const base = type === 'color' ? 'cor' : type === 'number' ? 'medida' : type === 'boolean' ? 'opção' : 'texto';
      c.variables.push({ id: uid(), name: `${base}-${c.variables.length + 1}`, type, values });
    });

  return (
    <Dialog
      title="Variáveis"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="muted grow" style={{ marginRight: 'auto' }}>Ligue cores às variáveis pelo seletor de cor de qualquer preenchimento.</span>
          <button className="btn primary" onClick={onClose}>Pronto</button>
        </>
      }
    >
      <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {cols.map((c) => (
          <button key={c.id} className={`btn small ${c.id === col?.id ? 'primary' : ''}`} onClick={() => setActive(c.id)}>{c.name}</button>
        ))}
        <button className="btn small ghost" onClick={addCollection}><Plus size={12} /> Nova coleção</button>
      </div>
      {!col ? (
        <div className="empty-state">
          <div className="title">Nenhuma variável ainda</div>
          Variáveis guardam cores, medidas e textos reutilizáveis — com modos, como claro e escuro. Mudou a variável, mudou em todo o arquivo.
          <div style={{ marginTop: 14 }}><button className="btn primary" onClick={addCollection}><Plus size={13} /> Criar coleção</button></div>
        </div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <TextField className="grow" lead="Nome" value={col.name} onChange={(v) => v.trim() && patchCol((c) => void (c.name = v.trim()))} />
            <button className="btn small" onClick={() => patchCol((c) => {
              const m = { id: uid(), name: `Modo ${c.modes.length + 1}` };
              c.modes.push(m);
              for (const v of c.variables) v.values[m.id] = clone(v.values[c.defaultMode]);
            })}><Plus size={12} /> Modo</button>
            <button className="btn small danger" onClick={() => {
              if (window.confirm(`Excluir a coleção “${col.name}”? Cores ligadas a ela continuam com o último valor.`)) save(cols.filter((c) => c.id !== col.id));
            }}><Trash2 size={12} /></button>
          </div>
          <table className="vars">
            <thead>
              <tr>
                <th style={{ width: '32%' }}>Nome</th>
                {col.modes.map((m) => (
                  <th key={m.id}>
                    <input
                      defaultValue={m.name}
                      style={{ background: 'none', border: 0, font: 'inherit', color: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit', width: '80%' }}
                      onBlur={(e) => e.target.value.trim() && e.target.value !== m.name && patchCol((c) => void (c.modes.find((x) => x.id === m.id)!.name = e.target.value.trim()))}
                    />
                    {col.modes.length > 1 && (
                      <button className="icon-btn" style={{ display: 'inline-grid', width: 18, height: 18 }} aria-label="Remover modo" onClick={() => patchCol((c) => {
                        c.modes = c.modes.filter((x) => x.id !== m.id);
                        if (c.defaultMode === m.id) c.defaultMode = c.modes[0].id;
                        for (const v of c.variables) delete v.values[m.id];
                      })}><X size={11} /></button>
                    )}
                  </th>
                ))}
                <th style={{ width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {col.variables.map((v) => (
                <tr key={v.id}>
                  <td><TextField value={v.name} onChange={(name) => name.trim() && patchCol((c) => void (c.variables.find((x) => x.id === v.id)!.name = name.trim()))} /></td>
                  {col.modes.map((m) => {
                    const val = v.values[m.id];
                    const setVal = (nv: Variable['values'][string], merge?: string) => patchCol((c) => void (c.variables.find((x) => x.id === v.id)!.values[m.id] = nv), merge);
                    return (
                      <td key={m.id}>
                        {v.type === 'color' ? (
                          <div className="field">
                            <span className="lead">
                              <button className="swatch" onClick={(e) => setPicker({ vid: v.id, mode: m.id, rect: e.currentTarget.getBoundingClientRect() })}>
                                <i style={{ background: typeof val === 'string' ? val : '#000' }} />
                              </button>
                            </span>
                            <span className="grow">{typeof val === 'string' ? val.toUpperCase() : '—'}</span>
                          </div>
                        ) : v.type === 'number' ? (
                          <NumberField value={typeof val === 'number' ? val : 0} onChange={(n, o) => setVal(n, o.merge)} />
                        ) : v.type === 'boolean' ? (
                          <Check checked={val === true} onChange={(b) => setVal(b)} label={val ? 'Sim' : 'Não'} />
                        ) : (
                          <TextField value={typeof val === 'string' ? val : ''} onChange={(t) => setVal(t)} />
                        )}
                        {picker?.vid === v.id && picker.mode === m.id && (
                          <PaintPicker anchor={picker.rect} allowImage={false} paint={{ type: 'solid', color: typeof val === 'string' ? val : '#000000' }} onClose={() => setPicker(null)} onChange={(p, merge) => p.type === 'solid' && setVal(p.color, merge)} />
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <button className="icon-btn" aria-label="Excluir variável" onClick={() => patchCol((c) => void (c.variables = c.variables.filter((x) => x.id !== v.id)))}><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn small" onClick={() => addVar('color')}><Plus size={12} /> Cor</button>
            <button className="btn small" onClick={() => addVar('number')}><Plus size={12} /> Número</button>
            <button className="btn small" onClick={() => addVar('string')}><Plus size={12} /> Texto</button>
            <button className="btn small" onClick={() => addVar('boolean')}><Plus size={12} /> Booleano</button>
          </div>
        </>
      )}
    </Dialog>
  );
}
