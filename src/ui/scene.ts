import type { GameState } from '../game/types';

/** Live data a scene draws from; the app mutates it. */
export interface SceneView {
  state: GameState;
  /** Unwrapped positions so pieces can pass the Launch Pad without rewinding. */
  disp: number[];
  follow: number;
  selected: number;
  moving: number | null;
  showRange: boolean;
  rentOf: (i: number) => number;
  onSelect: (i: number) => void;
}

export type HandoffMode = 'zoom' | 'card' | 'instant';

/** What the app needs from a view of the game (the street or the 3D board). */
export interface GameScene {
  speed: number;
  start(): void;
  destroy(): void;
  resize(): void;
  pointFor(i: number): { x: number; y: number };
  playerPoint(pid: number): { x: number; y: number };
  grow(i: number): void;
  raiseFlag(i: number): void;
  walk(pid: number, path: number[], stepMs: number): Promise<void>;
  jump(pid: number, target: number): Promise<void>;
  handoff(pid: number, card: HTMLElement | null, mode: HandoffMode): Promise<void>;
  coins(from: number, to: number | null): Promise<void>;
  overlay(cls: string, html: string, x: number, y: number, ms: number, style?: string): void;
}

/** Shows the turn card over a scene for the length of `during`. */
export async function withTurnCard(host: HTMLElement, card: HTMLElement | null, speed: number, during: () => Promise<void>) {
  let shown: Animation | null = null;
  if (card) {
    host.appendChild(card);
    shown = card.animate([{ transform: 'translateY(30px) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320 * speed, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'forwards' });
  }
  await during();
  if (card) {
    await shown?.finished.catch(() => {});
    await card.animate([{ opacity: 1 }, { transform: 'translateY(-20px) scale(.9)', opacity: 0 }], { duration: 260 * speed, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
    card.remove();
  }
}
