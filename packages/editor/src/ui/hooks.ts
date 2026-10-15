import { createContext, useContext, useSyncExternalStore, useCallback, useEffect, useRef } from 'react';
import type { Channel, Editor } from '../editor';

export const EditorContext = createContext<Editor>(null as unknown as Editor);

/** Devolve o editor e re-renderiza quando algum dos canais muda. */
export function useEditor(...channels: Channel[]): Editor {
  const ed = useContext(EditorContext);
  const key = channels.join(',');
  const subscribe = useCallback(
    (cb: () => void) => {
      const offs = channels.map((c) => ed.on(c, cb));
      return () => offs.forEach((o) => o());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ed, key],
  );
  useSyncExternalStore(subscribe, () => channels.map((c) => ed.version(c)).join('.'));
  return ed;
}

/** Fecha ao clicar fora ou apertar Esc. */
export function useDismiss(open: boolean, onClose: () => void, ...refs: React.RefObject<HTMLElement | null>[]) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (refs.some((r) => r.current?.contains(e.target as Node))) return;
      cb.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cb.current();
      }
    };
    const t = setTimeout(() => window.addEventListener('pointerdown', down, true), 0);
    window.addEventListener('keydown', key, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'agora mesmo';
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? 'há 1 minuto' : `há ${m} minutos`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? 'há 1 hora' : `há ${h} horas`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}
