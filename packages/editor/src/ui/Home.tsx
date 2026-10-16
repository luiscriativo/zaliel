import { useEffect, useState } from 'react';
import { FilePlus, FolderOpen, WifiOff, ShieldCheck, HardDrive, X } from 'lucide-react';
import { useEditor, timeAgo } from './hooks';
import { keyLabel } from './commands';
import type { RecentFile, RecoveryEntry } from '../platform';

export function Home() {
  const ed = useEditor('ui');
  const [recent, setRecent] = useState<RecentFile[] | null>(null);
  const [recovery, setRecovery] = useState<RecoveryEntry[]>([]);

  const load = () => {
    ed.platform.recent().then(setRecent);
    ed.platform.listRecovery().then(setRecovery);
  };
  useEffect(load, [ed]);

  return (
    <div className="home">
      <div className="brand">
        <h1>
          Zaliel<span>.</span>
        </h1>
        <div className="tag">Desenho de interfaces, com calma e precisão.</div>
        <div className="actions">
          <button className="btn primary" onClick={() => ed.newDocument()}>
            <FilePlus size={15} /> Novo arquivo <span className="kbd">{keyLabel('Mod+N')}</span>
          </button>
          <button className="btn" onClick={() => ed.open()}>
            <FolderOpen size={15} /> Abrir arquivo… <span className="kbd">{keyLabel('Mod+O')}</span>
          </button>
        </div>
        <div className="rule" />
        <div className="facts">
          <div><WifiOff size={13} /> Funciona 100% offline. Nada sai do seu computador.</div>
          <div><ShieldCheck size={13} /> Sem inteligência artificial, sem nuvem, sem conta.</div>
          <div><HardDrive size={13} /> Seus arquivos .zal ficam no seu computador, onde você escolher.</div>
        </div>
      </div>

      <div className="recent">
        {recovery.map((r) => (
          <div className="recovery" key={r.id}>
            <div className="row">
              <strong className="grow">Trabalho não salvo encontrado</strong>
              <button className="icon-btn" aria-label="Descartar" onClick={() => ed.platform.clearRecovery(r.id).then(load)}><X size={14} /></button>
            </div>
            <div style={{ margin: '4px 0 10px', color: 'var(--text-2)' }}>
              “{r.name}” tinha alterações quando o Zaliel foi fechado inesperadamente ({timeAgo(r.savedAt)}).
            </div>
            <button className="btn small primary" onClick={() => ed.restoreRecovery(r.id, r.path)}>Recuperar</button>
          </div>
        ))}
        <h3>
          Abertos recentemente {recent && recent.length > 0 && <span className="muted" style={{ fontFamily: 'var(--font-ui)', fontSize: 11, fontWeight: 400 }}>{recent.length}</span>}
        </h3>
        <div className="recent-list">
          {recent === null ? null : recent.length === 0 ? (
            <div className="empty-state" style={{ textAlign: 'left', padding: '18px 4px' }}>
              Nenhum arquivo ainda. Crie um novo ou abra um <kbd>.zal</kbd> existente — ou arraste um arquivo para esta janela.
            </div>
          ) : (
            recent.slice(0, 9).map((r) => (
              <button
                key={r.path}
                className={`recent-item ${r.exists === false ? 'missing' : ''}`}
                title={r.exists === false ? 'Arquivo não encontrado' : r.path}
                onClick={() => (r.exists === false ? ed.platform.removeRecent(r.path).then(load) : ed.openPath(r.path))}
              >
                <span className="fi">Z</span>
                <span style={{ minWidth: 0 }}>
                  <div className="rn">{r.name}</div>
                  <div className="rp">{r.exists === false ? 'Não encontrado — clique para remover da lista' : r.path}</div>
                </span>
                <span className="rd">{timeAgo(r.openedAt)}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
