// Presença de quem automatiza o editor: um cursor com nome que percorre as camadas que acabaram
// de mudar (a tela, depois as partes de dentro), destacando cada uma, para quem assiste acompanhar o trabalho.
import type { Rect } from '@zaliel/core';

/** Tempo para ir de um ponto a outro do percurso. */
const MOVE_MS = 420;
/** Pausa em cada ponto do percurso. */
const DWELL_MS = 280;
const STEP_MS = MOVE_MS + DWELL_MS;
/** Contorno do que mudou, depois que o percurso termina. */
const HIGHLIGHT_MS = 2200;
/** O cursor some depois deste tempo sem atividade. */
const IDLE_MS = 9000;
const FADE_MS = 600;

type Point = { x: number; y: number };

interface Tour {
  /** Pontos visitados, em ordem (retângulos no mundo). */
  rects: Rect[];
  /** Resumo destacado no fim (o que mudou de fato). */
  summary: Rect[];
  /** Só olhando (leitura, captura): contorno discreto, sem resumo. */
  look: boolean;
  from: Point;
  start: number;
}

export class AgentPresence {
  name = 'Claude';
  color = '#d97757';
  private tour: Tour | null = null;
  private lastAt = 0;
  private pageId: string | null = null;

  /**
   * Percorre estas áreas da página (na ordem) e, no fim, destaca o resumo.
   * `look`: só está olhando (lendo ou capturando), sem destacar como mudança.
   */
  visit(pageId: string, rects: Rect[], summary: Rect[] = rects, look = false, now = performance.now()): void {
    if (!rects.length) return;
    const here = this.pageId === pageId && this.visible(now) ? this.position(now) : null;
    const first = target(rects[0]);
    this.tour = { rects: rects.slice(0, 16), summary: summary.slice(0, 40), look, from: here ?? { x: first.x - 80, y: first.y - 60 }, start: now };
    this.pageId = pageId;
    this.lastAt = now + rects.length * STEP_MS;
  }

  /** A automação está trabalhando (o cursor continua à vista enquanto isso). */
  busy(now = performance.now()): void {
    if (this.tour) this.lastAt = Math.max(this.lastAt, now);
  }

  private step(now: number): { i: number; t: number } {
    const tour = this.tour!;
    const i = Math.min(tour.rects.length - 1, Math.max(0, Math.floor((now - tour.start) / STEP_MS)));
    const t = Math.min(1, Math.max(0, (now - tour.start - i * STEP_MS) / MOVE_MS));
    return { i, t };
  }

  /** Posição atual da ponta da seta (no mundo), com aceleração suave. */
  position(now = performance.now()): Point | null {
    const tour = this.tour;
    if (!tour) return null;
    const { i, t } = this.step(now);
    const from = i === 0 ? tour.from : target(tour.rects[i - 1]);
    const to = target(tour.rects[i]);
    const k = 1 - Math.pow(1 - t, 3);
    return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
  }

  /** O que contornar agora: o ponto atual do percurso e, no fim, o resumo do que mudou. */
  highlights(now = performance.now()): { rect: Rect; alpha: number; strong: boolean }[] {
    const tour = this.tour;
    if (!tour) return [];
    const end = tour.start + tour.rects.length * STEP_MS;
    if (now < end) {
      const { i, t } = this.step(now);
      // o contorno aparece quando o cursor chega
      return t >= 1 ? [{ rect: tour.rects[i], alpha: 1, strong: !tour.look }] : [];
    }
    if (tour.look) return [];
    const age = now - end;
    const alpha = age < HIGHLIGHT_MS ? 1 : Math.max(0, 1 - (age - HIGHLIGHT_MS) / FADE_MS);
    return alpha > 0 ? tour.summary.map((rect) => ({ rect, alpha, strong: false })) : [];
  }

  /** Opacidade do cursor (0 = escondido). */
  opacity(now = performance.now()): number {
    if (!this.tour) return 0;
    const idle = now - this.lastAt;
    if (idle < IDLE_MS) return 1;
    return Math.max(0, 1 - (idle - IDLE_MS) / FADE_MS);
  }

  visible(now = performance.now()): boolean {
    return this.opacity(now) > 0;
  }

  onPage(pageId: string): boolean {
    return this.pageId === pageId;
  }

  /**
   * Quando o canvas precisa do próximo quadro: 0 = já (percurso ou desvanecimento em andamento), um número =
   * daqui a tantos ms (parado, esperando o desvanecimento começar), null = nada mais a animar.
   */
  nextFrame(now = performance.now()): number | null {
    const tour = this.tour;
    if (!tour) return null;
    const waits: number[] = [];
    const phase = (start: number, len: number) => {
      if (now < start) waits.push(start - now);
      else if (now < start + len) waits.push(0);
    };
    const end = tour.start + tour.rects.length * STEP_MS;
    phase(tour.start, end - tour.start);
    if (!tour.look) phase(end + HIGHLIGHT_MS, FADE_MS);
    phase(this.lastAt + IDLE_MS, FADE_MS);
    return waits.length ? Math.min(...waits) : null;
  }
}

/** A ponta da seta fica um pouco para dentro do canto de cima à esquerda da área. */
function target(r: Rect): Point {
  return { x: r.x + Math.min(24, r.width / 3), y: r.y + Math.min(24, r.height / 3) };
}
