import { useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { useEditor } from './hooks';
import { TitleBar } from './TitleBar';
import { LeftPanel } from './LeftPanel';
import { DesignPanel } from './DesignPanel';
import { CanvasView } from './CanvasView';
import { Home } from './Home';
import { Dialogs } from './Dialogs';
import { Presentation } from './Present';
import { TabBar } from './Tabs';
import { comboOf, findCommand, TOOL_KEYS } from './commands';
import { CanvasHost, type HostAssets } from '../engine/host';
import { createAutomation } from '../automation';
import type { Editor } from '../editor';

export function App({ assets }: { assets: HostAssets }) {
  const ed = useEditor('ui', 'doc');
  const [ready, setReady] = useState(!!ed.host);
  const [failed, setFailed] = useState<string | null>(null);

  // CanvasKit + fontes
  useEffect(() => {
    if (ed.host) return;
    let alive = true;
    CanvasHost.create(ed, assets)
      .then((host) => {
        if (!alive) return;
        ed.host = host;
        ed.model.measureText = host.measureText;
        ed.relayoutAfterFonts();
        // automação local: só atende se o usuário ligou nas preferências (o servidor fica no processo principal)
        if (ed.platform.automation) {
          const automation = createAutomation(ed);
          ed.platform.automation.serve((payload) => automation.handle(payload as Parameters<typeof automation.handle>[0]));
        }
        host.onFontsChanged = () => ed.emit('ui');
        setReady(true);
      })
      .catch((e) => setFailed(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [ed, assets]);

  // tema
  const themed = useRef(false);
  useEffect(() => {
    document.documentElement.dataset.theme = ed.theme;
    if (!themed.current) {
      themed.current = true;
      return;
    }
    // trocar a aparência da janela (sobretudo no macOS) deixa as áreas de arrastar da barra de título
    // desatualizadas, cobrindo as ferramentas; desligar e religar faz o Chromium mandá-las de novo
    const timers = [0, 300, 1000].map((ms) => setTimeout(resetDragRegions, ms));
    return () => timers.forEach(clearTimeout);
  }, [ed.theme]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    ed.setSystemDark(mq.matches);
    const fn = () => ed.setSystemDark(mq.matches);
    mq.addEventListener('change', fn);
    ed.loadSettings();
    return () => mq.removeEventListener('change', fn);
  }, [ed]);

  // eventos do sistema
  useEffect(() => {
    const offs = [
      ed.platform.on('open-path', (path) => ed.openPath(path)),
      ed.platform.on('close-requested', async () => {
        if (await ed.confirmCloseAll()) ed.platform.confirmClose();
      }),
    ];
    // cópia de segurança a cada 20 s quando há alterações
    const t = setInterval(() => ed.writeRecovery().catch(() => undefined), 20000);
    return () => {
      offs.forEach((o) => o());
      clearInterval(t);
    };
  }, [ed]);

  useKeyboard(ed);

  if (failed) {
    return (
      <div className="home" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="empty-state" style={{ maxWidth: 460 }}>
          <div className="title">Não foi possível iniciar o canvas</div>
          O motor de desenho (Skia/WebGL) não carregou: {failed}
          <div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => location.reload()}>Tentar de novo</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app ${ed.home ? '' : 'with-tabs'}`}>
      <TitleBar />
      {!ed.home && <TabBar />}
      {ed.home ? (
        <Home />
      ) : (
        <div className="workspace">
          <LeftPanel />
          <CanvasView ready={ready} />
          <DesignPanel />
        </div>
      )}
      <StatusBar />
      <Toasts />
      <Dialogs />
      {ed.presenting && <Presentation />}
    </div>
  );
}

/** Faz a janela recalcular as áreas de arrastar (-webkit-app-region). */
function resetDragRegions() {
  const root = document.documentElement;
  root.classList.add('regions-reset');
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('regions-reset')));
}

function StatusBar() {
  const ed = useEditor('selection', 'view', 'doc', 'tool');
  const it = ed.host?.interaction;
  const p = it?.world;
  const names: Record<string, string> = { move: 'Mover', hand: 'Mão', frame: 'Frame', rect: 'Retângulo', ellipse: 'Elipse', line: 'Linha', polygon: 'Polígono', star: 'Estrela', text: 'Texto', pen: 'Caneta', comment: 'Comentário — clique no canvas para comentar' };
  return (
    <footer className="statusbar">
      {!ed.home && (
        <>
          <span>
            {ed.vectorEdit
              ? 'Editando pontos — arraste pontos e alças, clique na linha para adicionar, duplo clique alterna canto/curva, Delete apaga, Esc sai'
              : `${names[ed.tool]}${ed.tool === 'pen' ? ' — clique para pontos, arraste para curvas, Enter para terminar' : ''}`}
          </span>
          {p && <span>X {Math.round(p.x)} · Y {Math.round(p.y)}</span>}
          <span>{ed.selection.length ? `${ed.selection.length} selecionada${ed.selection.length > 1 ? 's' : ''}` : ''}</span>
          <span className="spacer" />
          <span>{ed.page.name}</span>
          <button onClick={() => ed.zoomTo(1)} title="Zoom 100%">{Math.round(ed.viewport.zoom * 100)}%</button>
        </>
      )}
      {ed.home && <span className="spacer" />}
      <span>v{ed.platform.version}</span>
    </footer>
  );
}

function Toasts() {
  const ed = useEditor('ui');
  return (
    <div className="toasts" aria-live="polite">
      {ed.toasts.map((t) => (
        <ToastItem key={t.id} t={t} ed={ed} />
      ))}
    </div>
  );
}

function ToastItem({ t, ed }: { t: Editor['toasts'][number]; ed: Editor }) {
  const hover = useRef(false);
  useEffect(() => {
    if (t.sticky) return;
    const ms = t.kind === 'error' ? 10000 : t.kind === 'warn' ? 7000 : 4000;
    let left = ms;
    const iv = setInterval(() => {
      if (!hover.current) left -= 250;
      if (left <= 0) ed.dismissToast(t.id);
    }, 250);
    return () => clearInterval(iv);
  }, [t, ed]);
  const Icon = t.kind === 'success' ? CircleCheck : t.kind === 'error' ? CircleAlert : t.kind === 'warn' ? TriangleAlert : Info;
  return (
    <div className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} onPointerEnter={() => (hover.current = true)} onPointerLeave={() => (hover.current = false)}>
      <Icon size={16} className="t-ico" />
      <div className="t-body">
        <div className="t-text">{t.text}</div>
        {t.detail && <div className="t-detail">{t.detail}</div>}
        {t.action && (
          <div className="t-action">
            <button className="btn small" onClick={() => { t.action!.run(); ed.dismissToast(t.id); }}>{t.action.label}</button>
          </div>
        )}
      </div>
      <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={() => ed.dismissToast(t.id)} aria-label="Fechar aviso"><X size={12} /></button>
    </div>
  );
}

function useKeyboard(ed: Editor) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      // Ctrl+Tab troca de aba em qualquer sistema
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        ed.cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      const combo = comboOf(e);
      const c = findCommand(combo);
      // em campos de texto só passam os atalhos com Ctrl/⌘ de arquivo
      if (typing) {
        if (c && /^Mod\+(Shift\+)?[SONW]$/.test(combo)) {
          e.preventDefault();
          (t as HTMLInputElement).blur();
          c.run(ed);
        }
        return;
      }
      // o painel de localizar não bloqueia os atalhos do canvas
      if ((ed.dialog && ed.dialog !== 'find') || ed.presenting) return;
      if (e.key === ' ' && !e.repeat && ed.host?.interaction) {
        ed.host.interaction.space = true;
        e.preventDefault();
        return;
      }
      if (ed.home) {
        if (c && (c.id.startsWith('file.') || c.id.startsWith('help.') || c.id === 'app.settings')) {
          e.preventDefault();
          c.run(ed);
        }
        return;
      }
      const it = ed.host?.interaction;
      // modo de edição de pontos
      if (ed.vectorEdit && it) {
        if (e.key === 'Escape' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey)) {
          e.preventDefault();
          ed.exitVectorEdit();
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && it.vector.selected.length) {
          e.preventDefault();
          it.vector.deleteSelected();
          return;
        }
        if (e.key.startsWith('Arrow') && it.vector.selected.length) {
          e.preventDefault();
          const d = e.shiftKey ? ed.settings.bigNudge : ed.settings.nudge;
          it.vector.nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
          return;
        }
      }
      // guia selecionada (clique nela): Delete apaga, setas movem, Esc desmarca
      if (ed.activeGuide !== null && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          ed.deleteSelectedGuide();
          return;
        }
        const g = ed.page.guides![ed.activeGuide];
        const keys = g.axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
        if (keys.includes(e.key)) {
          e.preventDefault();
          const d = e.shiftKey ? ed.settings.bigNudge : ed.settings.nudge;
          ed.nudgeGuide(e.key === keys[0] ? -d : d);
          return;
        }
        if (e.key === 'Escape' && !it?.drag) {
          ed.selectGuide(null);
          return;
        }
      }
      if (e.key === 'Escape') {
        if (it?.cancel()) return;
        if (ed.tool !== 'move') return ed.setTool('move');
        if (ed.selection.length) {
          const parent = ed.model.index.parentId(ed.selection[0]);
          ed.select(parent && ed.model.index.get(parent) && ed.scope ? [parent] : []);
          ed.scope = null;
        }
        return;
      }
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (ed.tool === 'pen') return it?.finishPen(false);
        const sel = ed.selectedNodes();
        if (e.shiftKey) {
          const parent = sel[0] && ed.model.index.parentId(sel[0].id);
          if (parent && ed.model.index.get(parent)) ed.select([parent]);
        } else if (sel.length === 1 && sel[0].type === 'text') {
          window.dispatchEvent(new CustomEvent('zaliel:edit-text', { detail: sel[0].id }));
        } else if (sel.length === 1 && sel[0].type === 'path') {
          ed.enterVectorEdit(sel[0].id);
        } else {
          const kids = sel.flatMap((n) => ('children' in n ? n.children.map((k) => k.id) : []));
          if (kids.length) ed.select(kids);
        }
        return;
      }
      if (e.key.startsWith('Arrow') && ed.selection.length) {
        e.preventDefault();
        const d = e.shiftKey ? ed.settings.bigNudge : ed.settings.nudge;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        ed.nudge(dx, dy);
        return;
      }
      if (c) {
        e.preventDefault();
        if (!c.enabled || c.enabled(ed)) c.run(ed);
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const tool = TOOL_KEYS[e.key.toLowerCase()];
        if (tool) {
          if (it?.pen.length && tool !== 'pen') it.finishPen(false);
          ed.setTool(tool);
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ' && ed.host?.interaction) ed.host.interaction.space = false;
      if (e.key.startsWith('Arrow')) ed.model.seal();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [ed]);
}
