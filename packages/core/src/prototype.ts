// Protótipo: ligações entre frames ao clicar e o que o modo de apresentação precisa.
import type { Interaction, OverlayPosition, Page, SceneNode } from './types';
import { apply, boundsOf, multiply, nodeMatrix, rectCorners, IDENTITY, type Mat, type Rect } from './util';

export const TRANSITIONS: { value: NonNullable<Interaction['transition']>; label: string }[] = [
  { value: 'instant', label: 'Instantânea' },
  { value: 'dissolve', label: 'Dissolver' },
  { value: 'slide-left', label: 'Deslizar para a esquerda' },
  { value: 'slide-right', label: 'Deslizar para a direita' },
  { value: 'slide-up', label: 'Deslizar para cima' },
  { value: 'slide-down', label: 'Deslizar para baixo' },
];

/** Frames que podem ser telas do protótipo: os frames e componentes do topo da página. */
export function screens(page: Page): SceneNode[] {
  return page.children.filter((n) => (n.type === 'frame' || n.type === 'component') && n.visible !== false);
}

/** Tela onde a apresentação começa: a escolhida na página, ou a primeira. */
export function startScreen(page: Page): SceneNode | undefined {
  const list = screens(page);
  return list.find((n) => n.id === page.flowStart) ?? list[0];
}

/** Tela do topo que contém um nó (ou ele mesmo). */
export function screenOf(page: Page, id: string, parentOf: (id: string) => string | undefined): SceneNode | undefined {
  let cur: string | undefined = id;
  let last: string | undefined;
  while (cur && cur !== page.id) {
    last = cur;
    cur = parentOf(cur);
  }
  return screens(page).find((n) => n.id === last);
}

export const OVERLAY_POSITIONS: { value: OverlayPosition; label: string }[] = [
  { value: 'center', label: 'No centro' },
  { value: 'top', label: 'Em cima, no centro' },
  { value: 'bottom', label: 'Embaixo, no centro' },
  { value: 'left', label: 'À esquerda' },
  { value: 'right', label: 'À direita' },
  { value: 'top-left', label: 'Canto superior esquerdo' },
  { value: 'top-right', label: 'Canto superior direito' },
  { value: 'bottom-left', label: 'Canto inferior esquerdo' },
  { value: 'bottom-right', label: 'Canto inferior direito' },
];

/** Fundo padrão atrás de uma sobreposição (preto a 40%). */
export const OVERLAY_BACKGROUND = '#00000066';

/** Onde fica uma sobreposição de `w`×`h` dentro de uma tela de `sw`×`sh`. */
export function overlayRect(sw: number, sh: number, w: number, h: number, position: OverlayPosition = 'center'): Rect {
  const cx = (sw - w) / 2, cy = (sh - h) / 2;
  const x = position.includes('left') ? 0 : position.includes('right') ? sw - w : cx;
  const y = position.startsWith('top') ? 0 : position.startsWith('bottom') ? sh - h : cy;
  return { x, y, width: w, height: h };
}

export interface Link {
  from: string;
  to: string;
  interaction: Interaction;
}

/** Todas as ligações de navegação da página (para desenhar as setas). */
export function prototypeLinks(page: Page): Link[] {
  const ids = new Set(screens(page).map((n) => n.id));
  const out: Link[] = [];
  const visit = (list: SceneNode[]) => {
    for (const n of list) {
      for (const it of n.interactions ?? []) if ((it.action === 'navigate' || it.action === 'overlay') && it.target && ids.has(it.target)) out.push({ from: n.id, to: it.target, interaction: it });
      if ('children' in n) visit(n.children);
    }
  };
  visit(page.children);
  return out;
}

export interface Hotspot {
  id: string;
  rect: Rect; // no espaço da tela (frame)
  interaction: Interaction;
}

/**
 * Áreas clicáveis de uma tela, em coordenadas do frame. As de cima (desenhadas por último) vêm primeiro.
 * `resolve` troca instâncias pelo conteúdo do componente (que pode ter interações).
 */
export function hotspots(screen: SceneNode, resolve: (n: SceneNode) => SceneNode = (n) => n): Hotspot[] {
  const out: Hotspot[] = [];
  const visit = (list: SceneNode[], m: Mat) => {
    for (const raw of list) {
      if (raw.visible === false) continue;
      const n = resolve(raw);
      const nm = multiply(m, nodeMatrix(n));
      const it = (raw.interactions ?? n.interactions)?.find((x) => x.trigger === 'click');
      if (it) out.push({ id: raw.id, rect: boundsOf(rectCorners({ x: 0, y: 0, width: n.width, height: n.height }).map((p) => apply(nm, p))), interaction: it });
      if ('children' in n) visit(n.children, nm);
    }
  };
  if ('children' in screen) visit(screen.children, IDENTITY);
  return out.reverse();
}
