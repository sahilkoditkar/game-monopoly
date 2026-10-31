import { GROUPS, JAIL_INDEX, TILES } from '../game/board';
import { el, escapeHtml } from './fx';
import { pieceIcon, pieceKind } from './pieces';
import { withTurnCard, type GameScene, type HandoffMode, type SceneView } from './scene';
import { play } from './sound';

/** Corner size as a fraction of the board edge. */
const CORNER = 0.135;
const P2D6: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Side = 'bottom' | 'left' | 'top' | 'right' | 'corner';
const sideOf = (i: number): Side => (i % 10 === 0 ? 'corner' : i < 10 ? 'bottom' : i < 20 ? 'left' : i < 30 ? 'top' : 'right');

/** Grid row/column (1-based) of each tile on the 11x11 board. */
function gridPos(i: number): [number, number] {
  if (i <= 10) return [11, 11 - i];
  if (i <= 20) return [11 - (i - 10), 1];
  if (i <= 30) return [1, 1 + (i - 20)];
  return [1 + (i - 30), 11];
}

const wrap = (i: number) => ((i % 40) + 40) % 40;

/** The classic flat board: every name, price, owner and building visible at once. */
export class Board2D implements GameScene {
  speed = 1;
  private root = el('div', 'board');
  private center = el('div', 'board-center');
  private tokenLayer = el('div', 'token-layer');
  private jackpotEl = el('div', 'board-jackpot');
  private tiles: HTMLElement[] = [];
  private tokens: HTMLElement[] = [];
  private shown: number[] = [];
  private size = 600;
  private raf = 0;
  private sig = '';
  private animating = new Set<number>();
  private observer: ResizeObserver;

  constructor(private host: HTMLElement, private view: SceneView) {
    for (const t of TILES) {
      const side = sideOf(t.index);
      const [r, c] = gridPos(t.index);
      const tile = el('div', `tile ${side} kind-${t.kind}`);
      tile.style.gridRow = String(r);
      tile.style.gridColumn = String(c);
      tile.appendChild(this.tileInner(t.index));
      tile.addEventListener('click', () => this.view.onSelect(t.index));
      this.tiles.push(tile);
      this.root.appendChild(tile);
    }
    this.center.innerHTML = `
      <div class="center-glow"></div>
      <div class="deck deck-fortune"><span>🔮</span><b>Fortune</b></div>
      <div class="deck deck-treasury"><span>💼</span><b>Treasury</b></div>`;
    const middle = el('div', '', '<div class="center-logo"><span class="logo-sky">SKYLINE</span><span class="logo-ty">TYCOON</span></div>');
    middle.appendChild(this.jackpotEl);
    this.center.appendChild(middle);
    this.root.append(this.center, this.tokenLayer);
    host.prepend(this.root);
    host.classList.add('is-board');
    this.shown = view.disp.map((d) => wrap(Math.round(d)));
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
  }

  private tileInner(i: number) {
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
      const sub: Record<string, string> = { jail: 'Just visiting', start: 'Collect salary', gotojail: 'Go to Lockup', lounge: 'Rest stop' };
      if (sub[t.kind]) inner.appendChild(el('div', 'corner-sub', sub[t.kind]));
    } else {
      inner.appendChild(el('div', 'tile-name', escapeHtml(t.short)));
      inner.appendChild(el('div', 'tile-icon', t.icon));
      inner.appendChild(el('div', 'tile-price', t.price ? `$${t.price}` : t.tax ? `Pay $${t.tax}` : ''));
    }
    inner.appendChild(el('div', 'owner-bar'));
    return inner;
  }

  // ------------------------------------------------------------ geometry

  resize() {
    const r = this.host.getBoundingClientRect();
    const size = Math.floor(Math.min(r.width, r.height || r.width) * 0.97);
    if (!size || size === this.size) return;
    this.size = size;
    this.root.classList.toggle('compact', size < 560);
    this.root.style.setProperty('--board', `${size}px`);
    this.root.style.setProperty('--corner', `${size * CORNER}px`);
    this.root.style.setProperty('--short', `${(size * (1 - 2 * CORNER)) / 9}px`);
    this.root.style.setProperty('--long', `${size * CORNER}px`);
    this.view.state.players.forEach((p) => this.place(p.id, this.shown[p.id]));
  }

  /** Centre of a tile in board pixels, nudged toward the outer edge so names stay readable. */
  private tileCenter(i: number) {
    const B = this.size, C = B * CORNER, S = (B - 2 * C) / 9, outer = C * 0.62;
    if (i === 0) return { x: B - C / 2, y: B - C / 2 };
    if (i === 10) return { x: C / 2, y: B - C / 2 };
    if (i === 20) return { x: C / 2, y: C / 2 };
    if (i === 30) return { x: B - C / 2, y: C / 2 };
    if (i < 10) return { x: B - C - (i - 0.5) * S, y: B - C + outer };
    if (i < 20) return { x: C - outer, y: B - C - (i - 10 - 0.5) * S };
    if (i < 30) return { x: C + (i - 20 - 0.5) * S, y: C - outer };
    return { x: B - C + outer, y: C + (i - 30 - 0.5) * S };
  }

  /** Spot for a piece on a tile; pieces sharing a tile fan out. */
  private spot(pid: number, pos: number) {
    const c = this.tileCenter(pos), S = (this.size * (1 - 2 * CORNER)) / 9;
    const p = this.view.state.players[pid];
    if (pos === JAIL_INDEX) {
      const C = this.size * CORNER;
      if (p.inJail) return { x: C * 0.62 + (pid % 2) * S * 0.38 - S * 0.19, y: this.size - C * 0.62 + Math.floor(pid / 2) * S * 0.38 - S * 0.19 };
      return pid < 2 ? { x: C * 0.18, y: this.size - C + (pid + 0.6) * S * 0.45 } : { x: C * 0.3 + (pid - 2) * S * 0.45, y: this.size - C * 0.16 };
    }
    const here = this.view.state.players.filter((q) => !q.bankrupt && this.shown[q.id] === pos).map((q) => q.id);
    const n = here.length, idx = Math.max(0, here.indexOf(pid));
    if (n <= 1) return c;
    const a = (idx / n) * Math.PI * 2 - Math.PI / 4;
    return { x: c.x + Math.cos(a) * S * 0.28, y: c.y + Math.sin(a) * S * 0.28 };
  }

  /** Board-relative offset of the board inside the host. */
  private origin() {
    const hr = this.host.getBoundingClientRect(), br = this.root.getBoundingClientRect();
    return { x: br.left - hr.left, y: br.top - hr.top };
  }

  private token(pid: number) {
    if (!this.tokens[pid]) {
      const p = this.view.state.players[pid];
      const t = el('div', 'token', `<div class="token-body">${pieceIcon(pieceKind(p.token), '#ffffff', 30)}</div>`);
      t.style.setProperty('--pc', p.color);
      this.tokenLayer.appendChild(t);
      this.tokens[pid] = t;
    }
    return this.tokens[pid];
  }

  private place(pid: number, pos: number) {
    const s = this.spot(pid, pos);
    this.token(pid).style.transform = `translate(${s.x}px, ${s.y}px)`;
  }

  private reflow(pos: number) {
    this.view.state.players.forEach((p) => {
      if (this.shown[p.id] === pos && !this.animating.has(p.id)) this.place(p.id, pos);
    });
  }

  // ------------------------------------------------------------ GameScene

  start() {
    this.resize();
    const loop = () => {
      this.sync();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.host.classList.remove('is-board');
    this.root.remove();
  }

  pointFor(i: number) {
    const o = this.origin(), c = this.tileCenter(i);
    return { x: o.x + c.x, y: o.y + c.y - 20 };
  }

  playerPoint(pid: number) {
    const o = this.origin(), s = this.spot(pid, this.shown[pid] ?? 0);
    return { x: o.x + s.x, y: o.y + s.y };
  }

  grow(i: number) {
    this.sig = '';
    requestAnimationFrame(() => {
      const last = this.tiles[i].querySelector('.houses')?.lastElementChild as HTMLElement | null;
      last?.classList.add('pop');
    });
    this.flash(i);
  }

  raiseFlag(i: number) {
    this.flash(i);
  }

  private flash(i: number) {
    const t = this.tiles[i];
    t.classList.remove('flash');
    void t.offsetWidth;
    t.classList.add('flash');
  }

  async walk(pid: number, path: number[], stepMs: number) {
    const t = this.token(pid), S = (this.size * (1 - 2 * CORNER)) / 9;
    this.animating.add(pid);
    this.view.moving = pid;
    this.view.follow = pid;
    t.classList.add('moving');
    let prev = this.shown[pid];
    for (const pos of path) {
      const a = this.spot(pid, prev);
      this.shown[pid] = pos;
      const b = this.spot(pid, pos);
      const d0 = wrap(pos - prev);
      this.view.disp[pid] += d0 > 20 ? d0 - 40 : d0;
      play('step');
      if (!reduced())
        await t.animate(
          [
            { transform: `translate(${a.x}px, ${a.y}px) scale(1)` },
            { transform: `translate(${(a.x + b.x) / 2}px, ${(a.y + b.y) / 2 - S * 0.55}px) scale(1.25)`, offset: 0.45 },
            { transform: `translate(${b.x}px, ${b.y}px) scale(0.92, 1.08)`, offset: 0.85 },
            { transform: `translate(${b.x}px, ${b.y}px) scale(1)` },
          ],
          { duration: stepMs * this.speed * 0.85, easing: 'ease-out' },
        ).finished.catch(() => {});
      t.style.transform = `translate(${b.x}px, ${b.y}px)`;
      const tile = this.tiles[pos];
      tile.classList.remove('stepped');
      void tile.offsetWidth;
      tile.classList.add('stepped');
      this.reflow(prev);
      prev = pos;
    }
    t.classList.remove('moving');
    this.animating.delete(pid);
    this.view.moving = null;
    this.reflow(prev);
  }

  async jump(pid: number, target: number) {
    const t = this.token(pid), S = (this.size * (1 - 2 * CORNER)) / 9;
    const from = this.shown[pid];
    this.animating.add(pid);
    const a = this.spot(pid, from);
    this.shown[pid] = target;
    const d0 = wrap(target - from);
    this.view.disp[pid] += d0 > 20 ? d0 - 40 : d0;
    const b = this.spot(pid, target);
    if (!reduced())
      await t.animate(
        [
          { transform: `translate(${a.x}px, ${a.y}px) scale(1)` },
          { transform: `translate(${(a.x + b.x) / 2}px, ${(a.y + b.y) / 2 - S * 2}px) scale(1.8)`, offset: 0.5 },
          { transform: `translate(${b.x}px, ${b.y}px) scale(1)` },
        ],
        { duration: 900 * this.speed, easing: 'ease-in-out' },
      ).finished.catch(() => {});
    t.style.transform = `translate(${b.x}px, ${b.y}px)`;
    this.animating.delete(pid);
    this.reflow(from);
    this.reflow(target);
  }

  async handoff(pid: number, card: HTMLElement | null, mode: HandoffMode) {
    if (pid === this.view.follow) return;
    this.view.follow = pid;
    if (mode === 'instant' || !card) return;
    await withTurnCard(this.host, card, this.speed, () => sleep(700 * this.speed));
  }

  async coins(from: number, to: number | null) {
    if (reduced()) return;
    const a = this.playerPoint(from);
    const b = to === null ? { x: this.host.clientWidth / 2, y: this.host.clientHeight / 2 } : this.playerPoint(to);
    const jobs: Promise<unknown>[] = [];
    for (let k = 0; k < 6; k++) {
      const c = el('div', 'coin');
      this.host.appendChild(c);
      const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - 70;
      jobs.push(
        c.animate(
          [
            { left: `${a.x}px`, top: `${a.y}px`, opacity: 0 },
            { left: `${mx}px`, top: `${my}px`, opacity: 1, offset: 0.5 },
            { left: `${b.x}px`, top: `${b.y}px`, opacity: 0.3 },
          ],
          { duration: 650 * this.speed, delay: k * 55 * this.speed, easing: 'ease-in-out', fill: 'forwards' },
        ).finished.catch(() => {}).then(() => c.remove()),
      );
    }
    await Promise.all(jobs);
  }

  overlay(cls: string, html: string, x: number, y: number, ms: number, style = '') {
    const f = el('div', cls, html);
    f.style.cssText = `left:${x}px;top:${y}px;${style}`;
    this.host.appendChild(f);
    setTimeout(() => f.remove(), ms);
  }

  // ------------------------------------------------------------ syncing with the game state

  /** Redraws tiles and pieces whenever ownership, buildings, positions or highlights change. */
  private sync() {
    const s = this.view.state, v = this.view;
    const cur = s.current, base = wrap(Math.round(v.disp[cur] ?? 0));
    const range = v.showRange && v.moving === null;
    const sig = JSON.stringify([s.props, s.jackpot, v.selected, range ? base : -1, s.players.map((p) => [p.bankrupt, p.inJail, p.id === v.follow])]);
    // Keep pieces in step with the engine when they were moved without an animation (load, view switch).
    s.players.forEach((p) => {
      if (!this.animating.has(p.id) && this.shown[p.id] !== p.pos && v.moving === null) {
        const old = this.shown[p.id];
        this.shown[p.id] = p.pos;
        this.place(p.id, p.pos);
        this.reflow(old);
      }
    });
    if (sig === this.sig) return;
    this.sig = sig;
    TILES.forEach((_, i) => {
      const tile = this.tiles[i], own = s.props[i], bar = tile.querySelector<HTMLElement>('.owner-bar')!;
      tile.classList.toggle('owned', !!own);
      tile.classList.toggle('mortgaged', !!own?.mortgaged);
      tile.classList.toggle('focus', i === v.selected);
      if (own) {
        const p = s.players[own.owner];
        bar.style.background = p.color;
        bar.innerHTML = pieceIcon(pieceKind(p.token), '#ffffff', 16);
        tile.style.setProperty('--owner', p.color);
      } else {
        bar.innerHTML = '';
        tile.style.removeProperty('--owner');
      }
      const houses = tile.querySelector<HTMLElement>('.houses');
      if (houses) {
        const h = own?.houses ?? 0, want = h === 5 ? 'H' : String(h);
        if (houses.dataset.h !== want) {
          houses.dataset.h = want;
          houses.innerHTML = h === 5 ? '<i class="hotel"></i>' : Array.from({ length: h }, () => '<i class="house"></i>').join('');
        }
      }
      const d = wrap(i - base);
      const odds = range && d >= 2 && d <= 12 ? P2D6[d] / 6 : 0;
      tile.classList.toggle('range', odds > 0);
      if (odds) tile.style.setProperty('--odds', String(0.12 + odds * 0.35));
    });
    this.jackpotEl.textContent = s.settings.jackpot && s.jackpot ? `Sky Lounge jackpot $${s.jackpot}` : '';
    s.players.forEach((p) => {
      const t = this.token(p.id);
      t.classList.toggle('gone', p.bankrupt);
      t.classList.toggle('active', p.id === v.follow && s.phase !== 'gameover');
      if (!this.animating.has(p.id)) this.place(p.id, this.shown[p.id]);
    });
  }
}
