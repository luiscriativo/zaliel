// Comentários: alfinetes por cima do canvas, a conversa de cada um e a lista no painel.
import { useEffect, useRef, useState } from 'react';
import { Check as CheckIcon, RotateCcw, Trash2, X, MessageCircle, Eye, EyeOff } from 'lucide-react';
import type { DocComment } from '@zaliel/core';
import { useEditor, timeAgo } from './hooks';
import type { Editor } from '../editor';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** Alfinetes e conversas, desenhados por cima do canvas (seguem pan e zoom). */
export function CommentLayer() {
  const ed = useEditor('view', 'doc', 'ui');
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null);
  if (!ed.showComments && !ed.commentDraft) return null;
  const list = ed.comments.filter((c) => c.pageId === ed.pageId && (ed.showResolved || !c.resolved || c.id === ed.commentOpen));
  const open = list.find((c) => c.id === ed.commentOpen);
  const draft = ed.commentDraft && ed.commentDraft.pageId === ed.pageId ? ed.commentDraft : null;
  const toScreen = (c: Pick<DocComment, 'x' | 'y' | 'nodeId'>) => ed.worldToScreen(ed.commentPoint(c));

  return (
    <div className="comment-layer" data-no-canvas>
      {ed.showComments &&
        list.map((c, i) => {
          const p = drag?.id === c.id ? { x: drag.x, y: drag.y } : toScreen(c);
          return (
            <button
              key={c.id}
              className={`comment-pin ${c.resolved ? 'resolved' : ''} ${c.id === ed.commentOpen ? 'on' : ''}`}
              style={{ left: p.x, top: p.y }}
              title={`${c.author}: ${c.text}`}
              aria-label={`Comentário ${i + 1} de ${c.author}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setDrag({ id: c.id, dx: e.clientX - p.x, dy: e.clientY - p.y, x: p.x, y: p.y, moved: false });
              }}
              onPointerMove={(e) => {
                if (!drag || drag.id !== c.id) return;
                const x = e.clientX - drag.dx, y = e.clientY - drag.dy;
                const moved = drag.moved || Math.hypot(x - p.x, y - p.y) > 3;
                setDrag({ ...drag, x, y, moved });
              }}
              onPointerUp={() => {
                if (!drag) return;
                if (drag.moved) ed.moveComment(c.id, ed.screenToWorld({ x: drag.x, y: drag.y }));
                else ed.openComment(ed.commentOpen === c.id ? null : c.id);
                setDrag(null);
              }}
            >
              <span>{initials(c.author)}</span>
              {!!c.replies?.length && <i>{c.replies.length + 1}</i>}
            </button>
          );
        })}
      {draft && <Composer at={toScreen(draft)} onCancel={() => { ed.commentDraft = null; ed.emit('ui'); }} onSend={(t) => ed.addComment(t)} />}
      {open && !drag && <Thread c={open} at={toScreen(open)} ed={ed} />}
    </div>
  );
}

function Composer({ at, onSend, onCancel }: { at: { x: number; y: number }; onSend: (t: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  return (
    <>
      <div className="comment-pin draft" style={{ left: at.x, top: at.y }}><span>+</span></div>
      <div className="comment-pop" style={{ left: at.x + 18, top: at.y - 8 }}>
        <Reply placeholder="Escreva um comentário…" text={text} setText={setText} onSend={() => onSend(text)} onCancel={onCancel} autoFocus />
      </div>
    </>
  );
}

function Reply(props: { text: string; setText: (t: string) => void; onSend: () => void; onCancel?: () => void; placeholder: string; autoFocus?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (props.autoFocus) ref.current?.focus();
  }, [props.autoFocus]);
  return (
    <div className="comment-reply">
      <textarea
        ref={ref}
        rows={2}
        value={props.text}
        placeholder={props.placeholder}
        onChange={(e) => props.setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (props.text.trim()) props.onSend();
          }
          if (e.key === 'Escape') props.onCancel?.();
        }}
      />
      <div className="row-end">
        {props.onCancel && <button className="btn small ghost" onClick={props.onCancel}>Cancelar</button>}
        <button className="btn small primary" disabled={!props.text.trim()} onClick={props.onSend}>Enviar</button>
      </div>
    </div>
  );
}

function Thread({ c, at, ed }: { c: DocComment; at: { x: number; y: number }; ed: Editor }) {
  const [text, setText] = useState('');
  const all = [{ id: '', author: c.author, text: c.text, createdAt: c.createdAt }, ...(c.replies ?? [])];
  return (
    <div className="comment-pop" style={{ left: at.x + 18, top: at.y - 8 }} onKeyDown={(e) => e.key === 'Escape' && ed.openComment(null)}>
      <header>
        <span>{c.resolved ? 'Resolvido' : 'Comentário'}</span>
        <span className="grow" />
        <button className="icon-btn" data-tip={c.resolved ? 'Reabrir' : 'Marcar como resolvido'} aria-label={c.resolved ? 'Reabrir' : 'Resolver'} onClick={() => ed.resolveComment(c.id, !c.resolved)}>
          {c.resolved ? <RotateCcw size={13} /> : <CheckIcon size={14} />}
        </button>
        <button className="icon-btn" data-tip="Apagar conversa" aria-label="Apagar conversa" onClick={() => ed.deleteComment(c.id)}><Trash2 size={13} /></button>
        <button className="icon-btn" aria-label="Fechar" onClick={() => ed.openComment(null)}><X size={13} /></button>
      </header>
      <div className="comment-msgs">
        {all.map((m) => (
          <div key={m.id || 'first'} className="comment-msg">
            <div className="who">
              <span className="avatar">{initials(m.author)}</span>
              <b>{m.author}</b>
              <span className="when" title={new Date(m.createdAt).toLocaleString('pt-BR')}>{timeAgo(m.createdAt)}</span>
              {m.id && <button className="icon-btn tiny" aria-label="Apagar resposta" onClick={() => ed.deleteComment(c.id, m.id)}><X size={11} /></button>}
            </div>
            <div className="text">{m.text}</div>
          </div>
        ))}
      </div>
      <Reply placeholder="Responder…" text={text} setText={setText} onSend={() => { ed.replyComment(c.id, text); setText(''); }} />
    </div>
  );
}

/** Lista de todos os comentários do arquivo (aba do painel da esquerda). */
export function CommentsPanel() {
  const ed = useEditor('doc', 'ui');
  const all = ed.comments.filter((c) => ed.showResolved || !c.resolved);
  const pages = ed.doc.pages.filter((p) => all.some((c) => c.pageId === p.id));
  const resolvedCount = ed.comments.filter((c) => c.resolved).length;
  return (
    <div className="comments-panel">
      <div className="head">
        <button className={`tchip ${ed.showComments ? 'on' : ''}`} onClick={() => ed.toggleComments()}>
          {ed.showComments ? <Eye size={11} /> : <EyeOff size={11} />} No canvas
        </button>
        <button className={`tchip ${ed.showResolved ? 'on' : ''}`} onClick={() => { ed.showResolved = !ed.showResolved; ed.emit('ui'); }}>
          Resolvidos{resolvedCount ? ` (${resolvedCount})` : ''}
        </button>
      </div>
      {!all.length && (
        <div className="empty-state">
          <div className="title"><MessageCircle size={14} style={{ verticalAlign: -2 }} /> Nenhum comentário</div>
          Use a ferramenta Comentário (C) e clique no canvas para deixar uma observação.
        </div>
      )}
      {pages.map((p) => (
        <div key={p.id}>
          <div className="section-title" style={{ padding: '10px 12px 4px' }}>{p.name}</div>
          {all.filter((c) => c.pageId === p.id).map((c) => (
            <button key={c.id} className={`comment-item ${c.id === ed.commentOpen ? 'on' : ''} ${c.resolved ? 'resolved' : ''}`} onClick={() => ed.openComment(c.id, true)}>
              <span className="avatar">{initials(c.author)}</span>
              <span className="body">
                <span className="who"><b>{c.author}</b> · {timeAgo(c.createdAt)}{c.replies?.length ? ` · ${c.replies.length} resposta${c.replies.length > 1 ? 's' : ''}` : ''}</span>
                <span className="text">{c.text}</span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
