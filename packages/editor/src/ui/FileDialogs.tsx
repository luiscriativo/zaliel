// Diálogos do arquivo: histórico de versões, localizar e substituir, exportação em lote.
import { useMemo, useState, type ReactNode } from 'react';
import { History, RotateCcw, CopyPlus, Trash2, Pencil, X, Search, Replace, ChevronUp, ChevronDown, FolderDown } from 'lucide-react';
import type { BatchExport, FindOptions } from '../editor';
import { useEditor, timeAgo } from './hooks';
import { Dialog } from './Dialogs';
import { Seg, Select } from './controls';

// ── Exportar várias telas ────────────────────────────────────────────────────

const TOKENS: [string, string][] = [
  ['{nome}', 'nome da camada'],
  ['{pagina}', 'página'],
  ['{n}', 'número na ordem de leitura'],
  ['{escala}', 'escala (2x)'],
  ['{arquivo}', 'nome do arquivo'],
];

let lastBatch: BatchExport = { scope: 'page', format: 'png', scales: [2], pattern: '{pagina}/{n} - {nome}' };

export function ExportBatchDialog({ onClose }: { onClose: () => void }) {
  const ed = useEditor('doc', 'selection');
  const [o, setO] = useState<BatchExport>(() => ({ ...lastBatch, scope: ed.selection.length ? 'selection' : lastBatch.scope === 'selection' ? 'page' : lastBatch.scope }));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<BatchExport>) => setO((x) => (lastBatch = { ...x, ...patch }));
  const items = useMemo(() => ed.batchItems(o.scope), [ed, o.scope, ed.model.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = useMemo(() => ed.batchNames(items, o), [ed, items, o]);
  const vector = o.format === 'svg';
  return (
    <Dialog
      title="Exportar várias telas"
      onClose={onClose}
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>{names.length} arquivo{names.length === 1 ? '' : 's'}</span>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button
            className="btn primary"
            disabled={!names.length || busy}
            onClick={async () => {
              setBusy(true);
              const ok = await ed.exportBatch(o);
              setBusy(false);
              if (ok) onClose();
            }}
          >
            <FolderDown size={14} /> {busy ? 'Exportando…' : 'Escolher pasta e exportar'}
          </button>
        </>
      }
    >
      <div className="setting">
        <div className="s-title">O que exportar</div>
        <div className="s-desc">Telas são os frames e componentes do topo de cada página, em ordem de leitura.</div>
        <Seg
          value={o.scope}
          onChange={(v) => set({ scope: v })}
          options={[
            { value: 'selection', label: 'Seleção' },
            { value: 'page', label: 'Esta página' },
            { value: 'all', label: 'Todas as páginas' },
          ]}
        />
      </div>
      <div className="setting">
        <div className="s-title">Formato</div>
        <div className="s-desc">{vector ? 'Vetor: o tamanho não muda.' : 'Escolha uma ou mais escalas (cada uma gera um arquivo).'}</div>
        <div className="row" style={{ gap: 6 }}>
          <Select value={o.format} options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }, { value: 'webp', label: 'WebP' }, { value: 'svg', label: 'SVG' }, { value: 'pdf', label: 'PDF' }]} onChange={(v) => set({ format: v })} />
          {!vector &&
            [0.5, 1, 2, 3, 4].map((s) => (
              <button
                key={s}
                className={`tchip ${o.scales.includes(s) ? 'on' : ''}`}
                onClick={() => {
                  const next = o.scales.includes(s) ? o.scales.filter((x) => x !== s) : [...o.scales, s].sort((a, b) => a - b);
                  set({ scales: next.length ? next : [s] });
                }}
              >
                {String(s).replace('.', ',')}×
              </button>
            ))}
        </div>
      </div>
      <div className="batch-names">
        <div className="s-title">Nome dos arquivos</div>
        <div className="s-desc">Use “/” para criar pastas. A extensão entra sozinha.</div>
        <label className="field text">
          <input value={o.pattern} onChange={(e) => set({ pattern: e.target.value })} placeholder="{nome}" spellCheck={false} />
        </label>
        <div className="find-opts" style={{ marginTop: 6 }}>
          {TOKENS.map(([t, label]) => (
            <button key={t} className="tchip" data-tip={label} onClick={() => set({ pattern: `${o.pattern}${o.pattern && !o.pattern.endsWith('/') && !o.pattern.endsWith(' ') ? ' ' : ''}${t}` })}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <ul className="batch-preview">
        {names.slice(0, 8).map((n, i) => (
          <li key={i}>{n}</li>
        ))}
        {names.length > 8 && <li className="muted">…e mais {names.length - 8}</li>}
        {!names.length && <li className="muted">{o.scope === 'selection' ? 'Nada selecionado.' : 'Nenhum frame encontrado.'}</li>}
      </ul>
    </Dialog>
  );
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function VersionsDialog({ onClose }: { onClose: () => void }) {
  const ed = useEditor('doc', 'ui');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const list = [...(ed.doc.versions ?? [])].reverse();
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Histórico de versões" onClose={onClose} wide>
      <div className="versions-new">
        <label className="field text">
          <input
            value={name}
            placeholder="Nome da versão (ex.: Enviado para aprovação)"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void run(async () => (await ed.saveVersion(name)) && setName(''));
            }}
          />
        </label>
        <button className="btn primary" disabled={busy} onClick={() => run(async () => (await ed.saveVersion(name)) && setName(''))}>
          <History size={14} /> Guardar versão agora
        </button>
      </div>
      <p className="hint">
        As versões ficam dentro do próprio arquivo .zal. Ao salvar, uma versão automática é guardada a cada 30 minutos de trabalho (as {20} mais recentes ficam); as versões com nome nunca são descartadas.
      </p>
      {!list.length && <div className="empty-state">Nenhuma versão ainda. Guarde uma agora ou salve o arquivo.</div>}
      <ul className="versions">
        {list.map((v) => (
          <li key={v.id} className={v.auto ? 'auto' : ''}>
            <div className="v-main">
              {renaming === v.id ? (
                <label className="field text">
                  <input
                    autoFocus
                    defaultValue={v.name}
                    onBlur={(e) => {
                      ed.renameVersion(v.id, e.target.value);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                </label>
              ) : (
                <div className="v-name">
                  {v.name}
                  {v.auto && <span className="badge">automática</span>}
                </div>
              )}
              <div className="v-meta" title={new Date(v.createdAt).toLocaleString('pt-BR')}>
                {timeAgo(v.createdAt)} · {new Date(v.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {v.pages} página{v.pages === 1 ? '' : 's'} · {kb(v.size)}
              </div>
            </div>
            <div className="v-actions">
              <button className="icon-btn" data-tip="Dar nome" aria-label="Dar nome" onClick={() => setRenaming(v.id)}><Pencil size={13} /></button>
              <button className="btn small" disabled={busy} onClick={() => run(() => ed.openVersionCopy(v.id).then(onClose))}><CopyPlus size={13} /> Abrir cópia</button>
              <button className="btn small" disabled={busy} onClick={() => run(() => ed.restoreVersion(v.id))}><RotateCcw size={13} /> Restaurar</button>
              <button className="icon-btn" data-tip="Excluir versão" aria-label="Excluir versão" onClick={() => ed.deleteVersion(v.id)}><Trash2 size={13} /></button>
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

// ── Localizar e substituir (painel flutuante, não bloqueia o canvas) ─────────

const FIND_DEFAULTS: FindOptions = { texts: true, names: true, caseSensitive: false, wholeWord: false, allPages: false };

export function FindPanel({ onClose }: { onClose: () => void }) {
  const ed = useEditor('doc', 'ui');
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [opts, setOpts] = useState<FindOptions>(FIND_DEFAULTS);
  const [current, setCurrent] = useState(0);
  const rev = ed.model.revision;
  const matches = useMemo(() => ed.findAll(query, opts), [ed, query, opts, rev, ed.pageId]);
  const re = ed.findPattern(query, opts);
  const at = Math.min(current, Math.max(0, matches.length - 1));

  const go = (i: number) => {
    if (!matches.length) return;
    const n = (i + matches.length) % matches.length;
    setCurrent(n);
    ed.revealMatch(matches[n]);
  };
  const toggle = (k: keyof FindOptions) => setOpts((o) => ({ ...o, [k]: !o[k] }));
  const replaceAll = () => {
    const n = ed.replaceMatches(matches, query, replacement, opts);
    ed.toast(n ? 'success' : 'info', n ? `${n} ${n === 1 ? 'substituição feita' : 'substituições feitas'}.` : 'Nada para substituir.');
  };

  return (
    <div className="find-panel" role="dialog" aria-label="Localizar e substituir" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <header>
        <span>Localizar e substituir</span>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={14} /></button>
      </header>
      <label className="field text">
        <span className="lead"><Search size={13} /></span>
        <input
          autoFocus
          value={query}
          placeholder="Localizar"
          onChange={(e) => {
            setQuery(e.target.value);
            setCurrent(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(e.shiftKey ? at - 1 : at + (ed.selection.length ? 1 : 0));
          }}
        />
        <span className="unit">{query ? `${matches.length ? at + 1 : 0}/${matches.length}` : ''}</span>
      </label>
      <label className="field text">
        <span className="lead"><Replace size={13} /></span>
        <input value={replacement} placeholder="Substituir por" onChange={(e) => setReplacement(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && replaceAll()} />
      </label>
      <div className="find-opts">
        <button className={`tchip ${opts.texts ? 'on' : ''}`} onClick={() => toggle('texts')}>Textos</button>
        <button className={`tchip ${opts.names ? 'on' : ''}`} onClick={() => toggle('names')}>Nomes de camadas</button>
        <button className={`tchip ${opts.caseSensitive ? 'on' : ''}`} onClick={() => toggle('caseSensitive')} data-tip="Diferenciar maiúsculas">Aa</button>
        <button className={`tchip ${opts.wholeWord ? 'on' : ''}`} onClick={() => toggle('wholeWord')} data-tip="Palavra inteira">“ab”</button>
        <button className={`tchip ${opts.allPages ? 'on' : ''}`} onClick={() => toggle('allPages')}>Todas as páginas</button>
      </div>
      <div className="find-actions">
        <button className="icon-btn" disabled={!matches.length} onClick={() => go(at - 1)} aria-label="Anterior"><ChevronUp size={14} /></button>
        <button className="icon-btn" disabled={!matches.length} onClick={() => go(at + 1)} aria-label="Próximo"><ChevronDown size={14} /></button>
        <span className="spacer" />
        <button className="btn small" disabled={!matches.length} onClick={() => matches[at] && ed.replaceMatches([matches[at]], query, replacement, opts)}>Substituir</button>
        <button className="btn small primary" disabled={!matches.length} onClick={replaceAll}>Substituir todos</button>
      </div>
      {query && (
        <ul className="find-results">
          {matches.slice(0, 300).map((m, i) => (
            <li key={`${m.kind}:${m.id}:${m.inner ?? ''}`} className={i === at ? 'on' : ''} onClick={() => go(i)}>
              <div className="fr-text">{highlight(m.value, re)}</div>
              <div className="fr-meta">
                {m.kind === 'name' ? 'Nome da camada' : m.kind === 'override' || m.kind === 'prop' ? `Texto na instância “${m.layer}”` : m.layer}
                {opts.allPages && ` · ${m.pageName}`}
              </div>
            </li>
          ))}
          {matches.length > 300 && <li className="more">…e mais {matches.length - 300} resultados</li>}
          {!matches.length && <li className="more">Nenhum resultado.</li>}
        </ul>
      )}
    </div>
  );
}

/** Trecho com o termo encontrado em destaque. */
function highlight(text: string, re: RegExp | null): ReactNode {
  const one = text.replace(/\s+/g, ' ');
  if (!re) return one;
  re.lastIndex = 0;
  const m = re.exec(one);
  if (!m) return one;
  const start = Math.max(0, m.index - 24);
  return (
    <>
      {start > 0 && '…'}
      {one.slice(start, m.index)}
      <mark>{m[0]}</mark>
      {one.slice(m.index + m[0].length, m.index + m[0].length + 60)}
    </>
  );
}
