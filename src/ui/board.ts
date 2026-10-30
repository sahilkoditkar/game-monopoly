import { GROUPS, JAIL_INDEX, TILES } from '../game/board';
import type { GameState } from '../game/types';
import { el, escapeHtml, sleep } from './fx';
import { play } from './sound';

/** Corner size as a fraction of the board edge. */
const CORNER = 0.135;

type Side = 'bottom' | 'left' | 'top' | 'right' | 'corner';

function sideOf(i: number): Side {
  if (i % 10 === 0) return 'corner';
  if (i < 10) return 'bottom';
  if (i < 20) return 'left';
  if (i < 30) return 'top';
  return 'right';
}

/** Grid row/column (1-based) of each tile on the 11x11 board. */
function gridPos(i: number): [number, number] {
  if (i <= 10) return [11, 11 - i];
  if (i <= 20) return [11 - (i - 10), 1];
  if (i <= 30) return [1, 1 + (i - 20)];
  return [1 + (i - 30), 11];
}

export class BoardView {
  root = el('div', 'board');
  center = el('div', 'board-center');
  tokenLayer = el('div', 'token-layer');
  private tiles: HTMLElement[] = [];
  private tokens = new Map<number, HTMLElement>();
  private displayPos = new Map<number, number>();
  private size = 600;
  onTileClick: (i: number) => void = () => {};

  constructor() {
    for (const t of TILES) {
      const side = sideOf(t.index);
      const [r, c] = gridPos(t.index);
      const tile = el('div', `tile ${side} kind-${t.kind}`);
      tile.style.gridRow = String(r);
      tile.style.gridColumn = String(c);
      tile.dataset.index = String(t.index);
      tile.appendChild(this.tileInner(t.index));
      tile.addEventListener('click', () => this.onTileClick(t.index));
      this.tiles.push(tile);
      this.root.appendChild(tile);
    }
    this.root.appendChild(this.center);
    this.root.appendChild(this.tokenLayer);
  }

  private tileInner(i: number): HTMLElement {
    const t = TILES[i];
    const inner = el('div', 'tile-inner');
    if (t.kind === 'property') {
      const band = el('div', 'band');
      band.style.background = GROUPS[t.group!].color;
      band.appendChild(el('div', 'houses'));
      inner.appendChild(band);
    }
    if (sideOf(i) === 'corner') {
      inner.appendChild(el('div', 'corner-icon', t.icon));
      inner.appendChild(el('div', 'corner-name', escapeHtml(t.name)));
      if (t.kind === 'jail') inner.appendChild(el('div', 'corner-sub', 'Just visiting'));
      if (t.kind === 'start') inner.appendChild(el('div', 'corner-sub', 'Collect salary'));
      if (t.kind === 'lounge') inner.appendChild(el('div', 'corner-sub jackpot-label', ''));
      if (t.kind === 'gotojail') inner.appendChild(el('div', 'corner-sub', 'Go to Lockup'));
    } else {
      inner.appendChild(el('div', 'tile-name', escapeHtml(t.short)));
      inner.appendChild(el('div', 'tile-icon', t.icon));
      const label = t.price ? `$${t.price}` : t.tax ? `Pay $${t.tax}` : '';
      inner.appendChild(el('div', 'tile-price', label));
    }
    inner.appendChild(el('div', 'owner-bar'));
    return inner;
  }

  /** Sizes the board to `size` pixels and repositions tokens. */
  resize(size: number) {
    this.size = size;
    this.root.classList.toggle('compact', size < 560);
    this.root.style.setProperty('--board', `${size}px`);
    this.root.style.setProperty('--corner', `${size * CORNER}px`);
    this.root.style.setProperty('--short', `${(size * (1 - 2 * CORNER)) / 9}px`);
    this.root.style.setProperty('--long', `${size * CORNER}px`);
    for (const [pid, pos] of this.displayPos) this.placeToken(pid, pos);
  }

  /** Center of a tile in board pixels, nudged toward the outer edge so names stay readable. */
  tileCenter(i: number): { x: number; y: number } {
    const B = this.size;
    const C = B * CORNER;
    const S = (B - 2 * C) / 9;
    const outer = C * 0.62;
    if (i === 0) return { x: B - C / 2, y: B - C / 2 };
    if (i === 10) return { x: C / 2, y: B - C / 2 };
    if (i === 20) return { x: C / 2, y: C / 2 };
    if (i === 30) return { x: B - C / 2, y: C / 2 };
    if (i < 10) return { x: B - C - (i - 0.5) * S, y: B - C + outer };
    if (i < 20) return { x: C - outer, y: B - C - (i - 10 - 0.5) * S };
    if (i < 30) return { x: C + (i - 20 - 0.5) * S, y: C - outer };
    return { x: B - C + outer, y: C + (i - 30 - 0.5) * S };
  }

  tileElement(i: number) {
    return this.tiles[i];
  }

  tokenElement(pid: number) {
    return this.tokens.get(pid);
  }

  /** Offset for several tokens sharing a tile, so they fan out instead of overlapping. */
  private tokenSpot(pid: number, pos: number, jailed: boolean): { x: number; y: number } {
    const c = this.tileCenter(pos);
    const S = (this.size * (1 - 2 * CORNER)) / 9;
    if (pos === JAIL_INDEX) {
      const C = this.size * CORNER;
      if (jailed) return { x: C * 0.62 + (pid % 2) * S * 0.38 - S * 0.19, y: this.size - C * 0.62 + Math.floor(pid / 2) * S * 0.38 - S * 0.19 };
      return pid < 2
        ? { x: C * 0.18 + 0, y: this.size - C + (pid + 0.6) * S * 0.45 }
        : { x: C * 0.3 + (pid - 2) * S * 0.45, y: this.size - C * 0.16 };
    }
    const others = [...this.displayPos.entries()].filter(([, p]) => p === pos).map(([id]) => id).sort();
    const idx = Math.max(0, others.indexOf(pid));
    const n = Math.max(1, others.length);
    if (n === 1) return c;
    const spread = S * 0.28;
    const angle = (idx / n) * Math.PI * 2 - Math.PI / 4;
    return { x: c.x + Math.cos(angle) * spread, y: c.y + Math.sin(angle) * spread };
  }

  private jailed = new Set<number>();

  setTokens(state: GameState) {
    for (const p of state.players) {
      let t = this.tokens.get(p.id);
      if (!t) {
        t = el('div', 'token', `<div class="token-body"><span>${p.token}</span></div>`);
        t.style.setProperty('--pc', p.color);
        this.tokenLayer.appendChild(t);
        this.tokens.set(p.id, t);
      }
      t.classList.toggle('gone', p.bankrupt);
      t.classList.toggle('active', p.id === state.current && state.phase !== 'gameover');
      if (p.inJail) this.jailed.add(p.id);
      else this.jailed.delete(p.id);
      this.displayPos.set(p.id, p.pos);
    }
    for (const p of state.players) this.placeToken(p.id, p.pos);
  }

  private placeToken(pid: number, pos: number) {
    const t = this.tokens.get(pid);
    if (!t) return;
    const spot = this.tokenSpot(pid, pos, this.jailed.has(pid));
    t.style.transform = `translate(${spot.x}px, ${spot.y}px)`;
  }

  private reflow(pos: number) {
    for (const [pid, p] of this.displayPos) if (p === pos) this.placeToken(pid, p);
  }

  /** Hops a token along a path of tiles. */
  async moveToken(pid: number, path: number[], stepMs: number, jump = false, jailed = false) {
    const t = this.tokens.get(pid);
    if (!t || !path.length) return;
    t.classList.add('moving');
    const from = this.displayPos.get(pid) ?? path[0];
    const S = (this.size * (1 - 2 * CORNER)) / 9;
    if (jump) {
      const target = path[path.length - 1];
      const a = this.tokenSpot(pid, from, false);
      this.displayPos.set(pid, target);
      if (jailed) this.jailed.add(pid);
      const b = this.tokenSpot(pid, target, jailed);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      await t.animate(
        [
          { transform: `translate(${a.x}px, ${a.y}px) scale(1)` },
          { transform: `translate(${mid.x}px, ${mid.y - S * 2}px) scale(1.8)`, offset: 0.5 },
          { transform: `translate(${b.x}px, ${b.y}px) scale(1)` },
        ],
        { duration: stepMs * 6, easing: 'ease-in-out' },
      ).finished.catch(() => {});
      t.style.transform = `translate(${b.x}px, ${b.y}px)`;
      this.reflow(from);
      this.reflow(target);
      t.classList.remove('moving');
      return;
    }
    this.jailed.delete(pid);
    let prev = from;
    for (const pos of path) {
      const a = this.tokenSpot(pid, prev, false);
      this.displayPos.set(pid, pos);
      const b = this.tokenSpot(pid, pos, false);
      play('step');
      const lift = S * 0.55;
      await t.animate(
        [
          { transform: `translate(${a.x}px, ${a.y}px) scale(1)` },
          { transform: `translate(${(a.x + b.x) / 2}px, ${(a.y + b.y) / 2 - lift}px) scale(1.25)`, offset: 0.45 },
          { transform: `translate(${b.x}px, ${b.y}px) scale(0.92, 1.08)`, offset: 0.85 },
          { transform: `translate(${b.x}px, ${b.y}px) scale(1)` },
        ],
        { duration: stepMs, easing: 'ease-out' },
      ).finished.catch(() => {});
      t.style.transform = `translate(${b.x}px, ${b.y}px)`;
      this.tiles[pos].classList.remove('stepped');
      void this.tiles[pos].offsetWidth;
      this.tiles[pos].classList.add('stepped');
      this.reflow(prev);
      prev = pos;
    }
    this.reflow(prev);
    t.classList.remove('moving');
    await sleep(40);
  }

  /** Updates ownership bars, houses and mortgage overlays. */
  renderTiles(state: GameState, changed?: number, built = false) {
    for (const t of TILES) {
      const tile = this.tiles[t.index];
      const own = state.props[t.index];
      const bar = tile.querySelector<HTMLElement>('.owner-bar')!;
      tile.classList.toggle('owned', !!own);
      tile.classList.toggle('mortgaged', !!own?.mortgaged);
      if (own) {
        const p = state.players[own.owner];
        bar.style.background = p.color;
        bar.innerHTML = `<span>${p.token}</span>`;
        tile.style.setProperty('--owner', p.color);
      } else {
        bar.innerHTML = '';
        tile.style.removeProperty('--owner');
      }
      const houses = tile.querySelector<HTMLElement>('.houses');
      if (houses) {
        const h = own?.houses ?? 0;
        const want = h === 5 ? 'H' : String(h);
        if (houses.dataset.h !== want) {
          houses.dataset.h = want;
          houses.innerHTML =
            h === 5 ? '<i class="hotel"></i>' : Array.from({ length: h }, () => '<i class="house"></i>').join('');
          if (built && changed === t.index) {
            const last = houses.lastElementChild as HTMLElement | null;
            last?.classList.add('pop');
          }
        }
      }
    }
    const jp = this.root.querySelector('.jackpot-label');
    if (jp) jp.textContent = state.settings.jackpot ? `Jackpot $${state.jackpot}` : 'Free stop';
    if (changed !== undefined) {
      const tile = this.tiles[changed];
      tile.classList.remove('flash');
      void tile.offsetWidth;
      tile.classList.add('flash');
    }
  }

  highlight(i: number | null) {
    this.tiles.forEach((t, k) => t.classList.toggle('focus', k === i));
  }
}
