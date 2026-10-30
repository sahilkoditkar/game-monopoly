import { acceptsTrade, apply, decide, fallback, newMemory, type AiMemory } from '../game/ai';
import { BUYABLE, GROUPS, JAIL_FINE, JAIL_INDEX, TILES, houseCost, mortgageValue, unmortgageCost } from '../game/board';
import { CARD_BY_ID } from '../game/cards';
import { Game } from '../game/engine';
import type { GameEvent, GameState, Player, TradeOffer, TradeSide } from '../game/types';
import { BoardView } from './board';
import { DicePair } from './dice';
import { centerOf, confetti, countTo, el, escapeHtml, floatText, flyCoins, money, sleep, toast } from './fx';
import { button, deedCard, openModal, type ModalHandle } from './modal';
import { RULES_HTML } from './setup';
import { isMuted, play, setMuted } from './sound';

type Speed = 'normal' | 'fast' | 'turbo';
const SPEEDS: Record<Speed, { step: number; ai: number; roll: number; banner: number; card: number }> = {
  normal: { step: 180, ai: 700, roll: 1000, banner: 1100, card: 2200 },
  fast: { step: 100, ai: 320, roll: 650, banner: 650, card: 1300 },
  turbo: { step: 40, ai: 70, roll: 320, banner: 250, card: 500 },
};

const SAVE_KEY = 'st-save';

export function loadSave(): { state: GameState; mem: AiMemory[] } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.state?.version !== 1 || data.state.phase === 'gameover') return null;
    return data;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

const pref = (k: string, d: string) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const setPref = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

export class GameApp {
  private root = el('div', 'game');
  private board = new BoardView();
  private dice = new DicePair();
  private playersEl = el('div', 'players');
  private logEl = el('div', 'log');
  private controlsEl = el('div', 'controls');
  private statusEl = el('div', 'status-line');
  private bannerEl = el('div', 'turn-banner');
  private roundEl = el('span', 'round-pill');
  private busy = false;
  private looping = false;
  private destroyed = false;
  private displayCash: number[] = [];
  private speed: Speed = pref('st-speed', 'normal') as Speed;
  private tilt = pref('st-tilt', '0') === '1';
  private phaseModal: { key: string; handle: ModalHandle; update?: () => void } | null = null;
  private live = new Set<() => void>();
  private onResize = () => this.layout();
  private onKey = (e: KeyboardEvent) => this.handleKey(e);

  constructor(
    private host: HTMLElement,
    private game: Game,
    private mem: AiMemory[],
    private exit: (again?: boolean) => void,
  ) {
    if (this.mem.length !== game.state.players.length) this.mem = game.state.players.map(() => newMemory());
    this.build();
    this.displayCash = game.state.players.map((p) => p.cash);
    this.board.setTokens(game.state);
    this.board.renderTiles(game.state);
    this.dice.show(game.state.dice);
    for (const line of game.state.log.slice(-40)) this.appendLog(line);
    const opening = game.drain().filter((e) => e.type !== 'log');
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    document.addEventListener('keydown', this.onKey);
    this.layout();
    this.render();
    // Play the opening "turn" event, then hand control to the AI if needed.
    void this.playAll(opening).then(() => {
      this.render();
      void this.loop();
    });
  }

  private get s() {
    return this.game.state;
  }

  private get t() {
    return SPEEDS[this.speed];
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener('resize', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKey);
    this.phaseModal?.handle.close();
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
    this.root.remove();
  }

  // ------------------------------------------------------------------ layout

  private build() {
    const top = el('header', 'topbar');
    top.innerHTML = `<div class="brand"><span class="logo-sky">SKYLINE</span> <span class="logo-ty">TYCOON</span></div>`;
    top.appendChild(this.roundEl);
    const tools = el('div', 'tools');
    const soundBtn = el('button', 'icon-btn', isMuted() ? '🔇' : '🔊');
    soundBtn.title = 'Sound';
    soundBtn.addEventListener('click', () => {
      setMuted(!isMuted());
      soundBtn.textContent = isMuted() ? '🔇' : '🔊';
      play('click');
    });
    const tiltBtn = el('button', 'icon-btn', '🧊');
    tiltBtn.title = 'Toggle 3D view';
    tiltBtn.addEventListener('click', () => {
      this.tilt = !this.tilt;
      setPref('st-tilt', this.tilt ? '1' : '0');
      this.root.classList.toggle('tilted', this.tilt);
      play('click');
    });
    const speedBtn = el('button', 'icon-btn speed-btn', this.speedLabel());
    speedBtn.title = 'Animation speed';
    speedBtn.addEventListener('click', () => {
      const order: Speed[] = ['normal', 'fast', 'turbo'];
      this.speed = order[(order.indexOf(this.speed) + 1) % 3];
      setPref('st-speed', this.speed);
      speedBtn.textContent = this.speedLabel();
      toast(`Speed: <b>${this.speed}</b>`);
      play('click');
    });
    const menuBtn = el('button', 'icon-btn', '☰');
    menuBtn.title = 'Menu';
    menuBtn.addEventListener('click', () => this.openMenu());
    tools.append(soundBtn, tiltBtn, speedBtn, menuBtn);
    top.appendChild(tools);

    const stage = el('main', 'stage');
    const boardWrap = el('div', 'board-wrap');
    boardWrap.appendChild(this.board.root);
    this.board.onTileClick = (i) => this.openTile(i);

    const c = this.board.center;
    c.innerHTML = `
      <div class="center-glow"></div>
      <div class="center-logo"><span class="logo-sky">SKYLINE</span><span class="logo-ty">TYCOON</span></div>
      <div class="deck deck-fortune"><span>🔮</span><b>Fortune</b></div>
      <div class="deck deck-treasury"><span>💼</span><b>Treasury</b></div>`;
    const hub = el('div', 'center-hub');
    hub.append(this.dice.root, this.statusEl, this.controlsEl);
    c.appendChild(hub);

    const side = el('aside', 'side');
    const logWrap = el('div', 'log-wrap');
    logWrap.innerHTML = '<div class="log-title">Game log</div>';
    logWrap.appendChild(this.logEl);
    side.append(this.playersEl, logWrap);

    stage.append(boardWrap, side, this.bannerEl);
    this.root.append(top, stage);
    this.root.classList.toggle('tilted', this.tilt);
    this.host.innerHTML = '';
    this.host.appendChild(this.root);
  }

  private speedLabel() {
    return this.speed === 'normal' ? '▶' : this.speed === 'fast' ? '⏩' : '⚡';
  }

  private layout() {
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const topH = 52;
    const landscape = vw >= vh * 1.1 && vw >= 720;
    this.root.classList.toggle('landscape', landscape);
    this.root.classList.toggle('portrait', !landscape);
    let size: number;
    if (landscape) {
      const sideW = Math.min(360, Math.max(250, vw * 0.27));
      this.root.style.setProperty('--side-w', `${sideW}px`);
      size = Math.min(vh - topH - 48, vw - sideW - 64);
    } else {
      size = Math.min(vw - 12, (vh - topH) * 0.68, 760);
    }
    this.board.resize(Math.max(280, Math.floor(size)));
  }

  // ------------------------------------------------------------------ rendering

  private render() {
    if (this.destroyed) return;
    const s = this.s;
    this.roundEl.textContent = s.settings.roundLimit ? `Round ${Math.min(s.round, s.settings.roundLimit)} / ${s.settings.roundLimit}` : `Round ${s.round}`;
    this.board.setTokens(s);
    this.board.renderTiles(s);
    this.renderPlayers();
    this.renderControls();
    this.syncPhaseModal();
    for (const fn of this.live) fn();
  }

  private renderPlayers() {
    const s = this.s;
    const html = s.players
      .map((p) => {
        const chips: string[] = [];
        for (const g of Object.values(GROUPS)) {
          const tiles = TILES.filter((t) => t.group === g.id);
          const n = tiles.filter((t) => s.props[t.index]?.owner === p.id).length;
          if (n) chips.push(`<i class="gchip ${n === tiles.length ? 'full' : ''}" style="--g:${g.color}" title="${escapeHtml(g.name)} ${n}/${tiles.length}">${n}</i>`);
        }
        const tr = BUYABLE.filter((i) => TILES[i].kind === 'transit' && s.props[i]?.owner === p.id).length;
        const ut = BUYABLE.filter((i) => TILES[i].kind === 'utility' && s.props[i]?.owner === p.id).length;
        if (tr) chips.push(`<i class="gchip icon" title="Skyports">✈️${tr}</i>`);
        if (ut) chips.push(`<i class="gchip icon" title="Utilities">⚡${ut}</i>`);
        const badges = [
          p.ai ? `<span class="badge">AI · ${p.difficulty}</span>` : '',
          p.inJail ? '<span class="badge warn">🔒 Lockup</span>' : '',
          p.jailCards.length ? `<span class="badge">🎫×${p.jailCards.length}</span>` : '',
          p.bankrupt ? '<span class="badge bad">Bankrupt</span>' : '',
        ].join('');
        const active = p.id === s.current && s.phase !== 'gameover';
        return `<div class="pcard ${active ? 'active' : ''} ${p.bankrupt ? 'out' : ''}" data-pid="${p.id}" style="--pc:${p.color}">
          <div class="avatar">${p.token}</div>
          <div class="pinfo">
            <div class="pname">${escapeHtml(p.name)}</div>
            <div class="pbadges">${badges}</div>
          </div>
          <div class="pcash" data-cash="${p.id}">${money(this.displayCash[p.id] ?? p.cash)}</div>
          <div class="pprops">${chips.join('') || '<span class="muted small">No properties yet</span>'}</div>
        </div>`;
      })
      .join('');
    this.playersEl.innerHTML = html;
    this.playersEl.querySelectorAll<HTMLElement>('.pcard').forEach((c) =>
      c.addEventListener('click', () => this.openPortfolio(Number(c.dataset.pid))),
    );
  }

  private syncCash() {
    this.s.players.forEach((p) => {
      const from = this.displayCash[p.id];
      if (from !== p.cash) {
        const node = this.playersEl.querySelector<HTMLElement>(`[data-cash="${p.id}"]`);
        if (node) countTo(node, from, p.cash, 500);
        this.displayCash[p.id] = p.cash;
      }
    });
  }

  private humanActor(): Player | null {
    const s = this.s;
    if (s.phase === 'gameover') return null;
    const p = this.game.player(this.game.actor());
    return p.ai ? null : p;
  }

  private renderControls() {
    const s = this.s;
    const c = this.controlsEl;
    c.innerHTML = '';
    const cur = this.game.cur;
    if (s.phase === 'gameover') {
      const w = s.winner !== null ? this.game.player(s.winner) : null;
      this.statusEl.innerHTML = w ? `🏆 <b>${escapeHtml(w.name)}</b> wins!` : 'Game over';
      c.appendChild(button('New game', 'primary', () => this.exit()));
      return;
    }
    const actor = this.game.player(this.game.actor());
    if (actor.ai || this.busy) {
      this.statusEl.innerHTML = actor.ai
        ? `<span class="dot-pulse" style="--pc:${actor.color}"></span> <b>${escapeHtml(actor.name)}</b> is playing…`
        : `<b>${escapeHtml(cur.name)}</b>'s turn`;
      if (!actor.ai) {
        const b = button('…', 'primary wide', () => {}, true);
        c.appendChild(b);
      }
      return;
    }
    const name = escapeHtml(actor.name);
    const row = el('div', 'ctrl-row');
    const row2 = el('div', 'ctrl-row small');
    switch (s.phase) {
      case 'roll':
        if (cur.inJail) {
          this.statusEl.innerHTML = `🔒 <b>${name}</b> is in Lockup (try ${cur.jailTurns + 1}/3)`;
          row.appendChild(button('🎲 Roll doubles', 'primary', () => this.act(() => this.game.roll())));
          row.appendChild(button(`Pay ${money(JAIL_FINE)}`, 'gold', () => this.act(() => this.game.payJailFine()), cur.cash < JAIL_FINE));
          if (cur.jailCards.length) row.appendChild(button('🎫 Use card', 'gold', () => this.act(() => this.game.useJailCard())));
        } else {
          this.statusEl.innerHTML = s.doublesCount ? `🎉 Doubles! <b>${name}</b>, roll again` : `<b>${name}</b>, your turn`;
          row.appendChild(button(s.doublesCount ? '🎲 Roll again' : '🎲 Roll dice', 'primary wide pulse', () => this.act(() => this.game.roll())));
        }
        break;
      case 'end':
        this.statusEl.innerHTML = `<b>${name}</b>, anything else?`;
        row.appendChild(button('End turn ➜', 'primary wide', () => this.act(() => this.game.endTurn())));
        break;
      case 'buy':
        this.statusEl.innerHTML = `<b>${name}</b> is deciding…`;
        row.appendChild(button('View offer', 'primary', () => this.syncPhaseModal(true)));
        break;
      case 'auction':
        this.statusEl.innerHTML = `🔨 Auction: <b>${name}</b> to bid`;
        break;
      case 'debt':
        this.statusEl.innerHTML = `⚠️ <b>${name}</b> owes ${money(this.game.debtTotal(actor.id))}`;
        row.appendChild(button('Raise cash', 'gold', () => this.openManage(actor.id)));
        break;
    }
    if (s.phase === 'roll' || s.phase === 'end') {
      row2.appendChild(button('🏗️ Manage', 'ghost', () => this.openManage(actor.id)));
      row2.appendChild(button('🤝 Trade', 'ghost', () => this.openTrade(actor.id)));
    }
    c.append(row);
    if (row2.childElementCount) c.append(row2);
  }

  private appendLog(text: string) {
    const line = el('div', 'log-line', escapeHtml(text));
    this.logEl.prepend(line);
    while (this.logEl.childElementCount > 80) this.logEl.lastElementChild!.remove();
  }

  // ------------------------------------------------------------------ actions

  private async act(fn: () => unknown) {
    if (this.busy || this.destroyed) return;
    this.busy = true;
    this.renderControls();
    play('click');
    fn();
    await this.flush();
    this.busy = false;
    this.render();
    this.save();
    void this.loop();
  }

  private flush() {
    return this.playAll(this.game.drain());
  }

  private async playAll(events: GameEvent[]) {
    for (const e of events) {
      if (this.destroyed) return;
      await this.playEvent(e);
    }
    this.syncCash();
  }

  private save() {
    try {
      if (this.s.phase === 'gameover') localStorage.removeItem(SAVE_KEY);
      else localStorage.setItem(SAVE_KEY, JSON.stringify({ state: this.s, mem: this.mem }));
    } catch {
      /* ignore */
    }
  }

  /** Runs AI players until a human needs to act. */
  private async loop() {
    if (this.looping || this.destroyed) return;
    this.looping = true;
    let failures = 0;
    try {
      while (this.s.phase !== 'gameover' && !this.destroyed) {
        const pid = this.game.actor();
        const p = this.game.player(pid);
        if (!p.ai) break;
        this.busy = true;
        this.renderControls();
        await sleep(this.t.ai);
        if (this.destroyed) return;
        const action = decide(this.game, pid, this.mem[pid]);
        let ok: boolean;
        if (action.type === 'trade') {
          ok = await this.aiTrade(action.offer);
        } else {
          ok = apply(this.game, pid, action);
          if (!ok) ok = apply(this.game, pid, fallback(this.game, pid));
        }
        if (!ok && action.type !== 'trade') {
          if (++failures > 3) {
            // Last resort so the game can never stall.
            if (this.s.phase === 'debt') this.game.declareBankruptcy();
            else if (this.s.phase === 'end') this.game.endTurn();
            else if (this.s.phase === 'auction') this.game.passBid(pid);
            else if (this.s.phase === 'buy') this.game.decline();
            else this.game.roll();
          }
        } else failures = 0;
        await this.flush();
        this.busy = false;
        this.render();
        this.save();
      }
    } finally {
      this.looping = false;
      this.busy = false;
      if (!this.destroyed) this.render();
    }
  }

  private async aiTrade(offer: TradeOffer): Promise<boolean> {
    const to = this.game.player(offer.to);
    const from = this.game.player(offer.from);
    let accepted: boolean;
    if (to.ai) accepted = acceptsTrade(this.game, offer);
    else accepted = await this.askTrade(offer, `${escapeHtml(from.name)} wants to trade with ${escapeHtml(to.name)}`);
    if (accepted) {
      this.game.executeTrade(offer);
    } else {
      this.game.log(`${to.name} turned down ${from.name}'s trade offer.`);
      if (to.ai) toast(`🤝 ${escapeHtml(to.name)} declined ${escapeHtml(from.name)}'s offer`);
    }
    return true;
  }

  private handleKey(e: KeyboardEvent) {
    if (document.querySelector('.modal-backdrop.open') || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === ' ' || e.key === 'Enter') {
      const human = this.humanActor();
      if (!human || this.busy) return;
      if (this.s.phase === 'roll') {
        e.preventDefault();
        void this.act(() => this.game.roll());
      } else if (this.s.phase === 'end') {
        e.preventDefault();
        void this.act(() => this.game.endTurn());
      }
    }
  }

  // ------------------------------------------------------------------ event playback

  private tokenPoint(pid: number) {
    const t = this.board.tokenElement(pid);
    return t ? centerOf(t.querySelector('.token-body') ?? t) : centerOf(this.board.root);
  }

  private panelPoint(pid: number) {
    const n = this.playersEl.querySelector(`[data-cash="${pid}"]`);
    return n ? centerOf(n) : this.tokenPoint(pid);
  }

  private async playEvent(e: GameEvent) {
    const s = this.s;
    switch (e.type) {
      case 'log':
        this.appendLog(e.text);
        break;
      case 'turn': {
        const p = this.game.player(e.player);
        this.renderPlayers();
        this.board.setTokens(s);
        this.bannerEl.innerHTML = `<div class="banner-inner" style="--pc:${p.color}"><span class="banner-token">${p.token}</span><span>${escapeHtml(p.name)}'s turn</span></div>`;
        this.bannerEl.classList.remove('show');
        void this.bannerEl.offsetWidth;
        this.bannerEl.style.setProperty('--banner-ms', `${this.t.banner}ms`);
        this.bannerEl.classList.add('show');
        play('turn');
        await sleep(p.ai ? this.t.banner * 0.6 : 250);
        break;
      }
      case 'roll':
        play('dice');
        await this.dice.roll(e.dice, this.t.roll);
        if (e.doubles) floatText(centerOf(this.dice.root).x, centerOf(this.dice.root).y - 30, 'DOUBLES!', 'big gold');
        break;
      case 'move': {
        const target = e.path[e.path.length - 1];
        await this.board.moveToken(e.player, e.path, e.path.length > 14 ? this.t.step * 0.6 : this.t.step, e.jump, !!e.jump && target === JAIL_INDEX);
        this.board.highlight(target);
        break;
      }
      case 'money': {
        const pt = this.panelPoint(e.player);
        floatText(pt.x, pt.y - 10, `${e.delta > 0 ? '+' : '−'}${money(Math.abs(e.delta))}`, e.delta > 0 ? 'gain' : 'loss');
        const node = this.playersEl.querySelector<HTMLElement>(`[data-cash="${e.player}"]`);
        const from = this.displayCash[e.player];
        this.displayCash[e.player] = from + e.delta;
        if (node) {
          countTo(node, from, from + e.delta, 450);
          node.classList.remove('bump-up', 'bump-down');
          void node.offsetWidth;
          node.classList.add(e.delta > 0 ? 'bump-up' : 'bump-down');
        }
        if (e.delta > 0) play('coin');
        break;
      }
      case 'pay': {
        if (this.speed === 'turbo') break;
        const from = this.tokenPoint(e.from);
        const to = e.to !== null ? this.tokenPoint(e.to) : centerOf(this.board.center);
        if (e.to === null) play('pay');
        await flyCoins(from, to, e.to !== null ? 7 : 4, e.to !== null ? 650 : 450);
        break;
      }
      case 'buy': {
        this.board.renderTiles(s, e.tile);
        play('buy');
        const pt = centerOf(this.board.tileElement(e.tile));
        floatText(pt.x, pt.y, 'SOLD!', 'stamp');
        await sleep(this.speed === 'turbo' ? 50 : 350);
        break;
      }
      case 'card':
        await this.showCard(e.card, e.player);
        break;
      case 'jail': {
        play('jail');
        const pt = centerOf(this.board.root);
        floatText(pt.x, pt.y, '🚨 BUSTED!', 'big red');
        await sleep(this.speed === 'turbo' ? 100 : 600);
        break;
      }
      case 'leaveJail':
        this.board.setTokens(s);
        break;
      case 'build':
        this.board.renderTiles(s, e.tile, true);
        play('build');
        await sleep(this.speed === 'turbo' ? 30 : 220);
        break;
      case 'mortgage':
        this.board.renderTiles(s, e.tile);
        play(e.mortgaged ? 'coin' : 'pay');
        break;
      case 'auctionStart':
        play('gavel');
        break;
      case 'bid': {
        play('gavel');
        const box = document.querySelector('.auction-bid');
        if (box) {
          box.classList.remove('bump');
          void (box as HTMLElement).offsetWidth;
          box.classList.add('bump');
        }
        break;
      }
      case 'auctionEnd': {
        if (e.winner !== null) {
          const w = this.game.player(e.winner);
          toast(`🔨 <b>${escapeHtml(w.name)}</b> won ${escapeHtml(TILES[e.tile].name)} for ${money(e.amount)}`, 'good');
        } else toast(`🔨 No bids for ${escapeHtml(TILES[e.tile].name)}`);
        break;
      }
      case 'fullSet': {
        const p = this.game.player(e.player);
        const g = GROUPS[e.group];
        const pt = this.tokenPoint(e.player);
        confetti(pt.x, pt.y, 90, [g.color, '#ffffff', p.color]);
        play('jackpot');
        toast(`⭐ <b>${escapeHtml(p.name)}</b> owns all of <b style="color:${g.color}">${escapeHtml(g.name)}</b>!`, 'good', 3200);
        await sleep(this.speed === 'turbo' ? 50 : 500);
        break;
      }
      case 'jackpot': {
        const pt = this.tokenPoint(e.player);
        confetti(pt.x, pt.y, 140);
        play('jackpot');
        floatText(pt.x, pt.y - 30, `JACKPOT ${money(e.amount)}!`, 'big gold');
        await sleep(600);
        break;
      }
      case 'bankrupt': {
        const p = this.game.player(e.player);
        play('bankrupt');
        toast(`💥 <b>${escapeHtml(p.name)}</b> went bankrupt!`, 'bad', 3500);
        this.board.setTokens(s);
        this.board.renderTiles(s);
        await sleep(this.speed === 'turbo' ? 100 : 900);
        break;
      }
      case 'trade':
        play('buy');
        this.board.renderTiles(s);
        toast(`🤝 ${escapeHtml(this.game.player(e.offer.from).name)} and ${escapeHtml(this.game.player(e.offer.to).name)} made a trade`, 'good');
        break;
      case 'gameover':
        this.syncCash();
        this.render();
        this.showGameOver();
        break;
    }
  }

  private async showCard(id: string, pid: number) {
    const card = CARD_BY_ID[id];
    const p = this.game.player(pid);
    play('card');
    if (this.speed === 'turbo' && p.ai) {
      toast(`${card.deck === 'fortune' ? '🔮' : '💼'} <b>${escapeHtml(p.name)}</b>: ${escapeHtml(card.title)}`);
      return;
    }
    const m = openModal({ cls: 'card-modal', dismissable: false });
    const flip = el('div', `game-card ${card.deck}`);
    flip.innerHTML = `
      <div class="card-face card-back"><div class="card-back-icon">${card.deck === 'fortune' ? '🔮' : '💼'}</div><div>${card.deck === 'fortune' ? 'FORTUNE' : 'TREASURY'}</div></div>
      <div class="card-face card-front">
        <div class="card-kind">${card.deck === 'fortune' ? '🔮 Fortune' : '💼 Treasury'}</div>
        <div class="card-title">${escapeHtml(card.title)}</div>
        <div class="card-text">${escapeHtml(card.text)}</div>
        <div class="card-who" style="--pc:${p.color}">${p.token} ${escapeHtml(p.name)}</div>
      </div>`;
    m.body.appendChild(flip);
    requestAnimationFrame(() => setTimeout(() => flip.classList.add('flipped'), 80));
    if (!p.ai) {
      const ok = button('OK', 'primary', () => m.close());
      ok.classList.add('card-ok');
      m.body.appendChild(ok);
      await Promise.race([m.closed, sleep(15000)]);
    } else {
      await sleep(this.t.card);
    }
    m.close();
    await sleep(150);
  }

  // ------------------------------------------------------------------ phase modals

  /** Keeps the buy / auction / debt dialog in sync with the engine phase. */
  private syncPhaseModal(force = false) {
    const s = this.s;
    const actor = this.game.player(this.game.actor());
    let key: string | null = null;
    if (s.phase === 'buy' && !actor.ai) key = `buy:${s.turnCount}:${actor.pos}`;
    else if (s.phase === 'auction' && s.auction) key = `auction:${s.turnCount}:${s.auction.tile}`;
    else if (s.phase === 'debt' && !actor.ai) key = `debt:${actor.id}:${s.debts[0]?.amount}:${s.debts[0]?.reason}`;
    if (this.busy && !force && key?.startsWith('buy')) key = null;
    if (this.phaseModal && this.phaseModal.key !== key) {
      this.phaseModal.handle.close();
      this.phaseModal = null;
    }
    if (!key) return;
    if (this.phaseModal) {
      if (force && !document.body.contains(this.phaseModal.handle.root)) this.phaseModal = null;
      else {
        this.phaseModal.update?.();
        return;
      }
    }
    if (key.startsWith('buy')) this.openBuy(key);
    else if (key.startsWith('auction')) this.openAuction(key);
    else if (key.startsWith('debt')) this.openDebt(key);
  }

  private openBuy(key: string) {
    const p = this.game.cur;
    const tile = TILES[p.pos];
    const m = openModal({ title: 'For sale', cls: 'buy-modal', dismissable: false });
    const update = () => {
      m.body.innerHTML = '';
      m.body.appendChild(deedCard(this.s, p.pos));
      const short = p.cash < tile.price!;
      const info = el('div', 'buy-info', short
        ? `You have ${money(p.cash)}. Mortgage or sell to raise ${money(tile.price! - p.cash)} more, or let it go to auction.`
        : `You have <b>${money(p.cash)}</b>. After buying: <b>${money(p.cash - tile.price!)}</b>`);
      m.body.appendChild(info);
      const row = el('div', 'modal-actions');
      row.appendChild(button(`Buy for ${money(tile.price!)}`, 'primary', () => this.act(() => this.game.buy()), short));
      row.appendChild(button(this.s.settings.auctions ? '🔨 Auction' : 'Pass', 'ghost', () => this.act(() => this.game.decline())));
      if (short) row.appendChild(button('🏗️ Manage', 'gold', () => this.openManage(p.id)));
      m.body.appendChild(row);
    };
    update();
    this.phaseModal = { key, handle: m, update };
  }

  private openAuction(key: string) {
    const m = openModal({ title: '🔨 Auction', cls: 'auction-modal', dismissable: false });
    let draft = 0;
    const update = () => {
      const a = this.s.auction;
      if (!a) return;
      const actor = this.game.player(a.active[a.turn]);
      const leader = a.bidder !== null ? this.game.player(a.bidder) : null;
      const min = this.game.minBid();
      if (draft < min) draft = min;
      if (draft > actor.cash) draft = Math.max(min, actor.cash);
      m.body.innerHTML = '';
      const wrap = el('div', 'auction-grid');
      wrap.appendChild(deedCard(this.s, a.tile));
      const side = el('div', 'auction-side');
      side.innerHTML = `
        <div class="auction-bid">${a.bid ? money(a.bid) : 'No bids yet'}</div>
        <div class="auction-leader">${leader ? `Leading: <span class="chip" style="--pc:${leader.color}">${leader.token} ${escapeHtml(leader.name)}</span>` : `Opening bid ${money(min)}`}</div>
        <div class="bidders">${this.s.players
          .filter((p) => !p.bankrupt)
          .map((p) => {
            const st = a.active.includes(p.id) ? (p.id === actor.id ? 'turn' : 'in') : 'out';
            return `<span class="bidder ${st}" style="--pc:${p.color}">${p.token} ${escapeHtml(p.name)} <small>${st === 'out' ? 'out' : money(p.cash)}</small></span>`;
          })
          .join('')}</div>`;
      if (actor.ai) {
        side.appendChild(el('div', 'thinking', `<span class="dot-pulse" style="--pc:${actor.color}"></span> ${escapeHtml(actor.name)} is thinking…`));
      } else if (!this.busy) {
        const canBid = actor.cash >= min;
        side.appendChild(el('div', 'bid-turn', `<b>${escapeHtml(actor.name)}</b>, your bid:`));
        const stepper = el('div', 'stepper');
        const minus = button('−10', 'ghost small', () => {
          draft = Math.max(min, draft - 10);
          update();
        });
        const val = el('div', 'stepper-val', money(draft));
        const plus = (n: number) =>
          button(`+${n}`, 'ghost small', () => {
            draft = Math.min(actor.cash, draft + n);
            update();
          });
        stepper.append(minus, val, plus(10), plus(50), plus(100));
        side.appendChild(stepper);
        const row = el('div', 'modal-actions');
        row.appendChild(button(`Bid ${money(draft)}`, 'primary', () => this.act(() => this.game.bid(actor.id, draft)), !canBid));
        row.appendChild(button('Drop out', 'ghost', () => this.act(() => this.game.passBid(actor.id))));
        side.appendChild(row);
      }
      wrap.appendChild(side);
      m.body.appendChild(wrap);
    };
    update();
    this.phaseModal = { key, handle: m, update };
  }

  private openDebt(key: string) {
    const m = openModal({ title: '⚠️ Not enough cash', cls: 'debt-modal', dismissable: false });
    const update = () => {
      const d = this.s.debts[0];
      if (!d) return;
      const p = this.game.player(d.from);
      const to = d.to !== null ? this.game.player(d.to).name : 'the bank';
      const canRaise = this.game.liquidity(p.id) >= this.game.debtTotal(p.id);
      m.body.innerHTML = `
        <p><b>${escapeHtml(p.name)}</b> owes <b>${money(d.amount)}</b> to ${escapeHtml(to)} (${escapeHtml(d.reason)}) but has only <b>${money(p.cash)}</b>.</p>
        <p class="muted">Sell buildings or mortgage properties to raise ${money(d.amount - p.cash)}. The debt is paid automatically once you have the cash.</p>
        ${canRaise ? '' : '<p class="warn-text">Even selling everything won\'t cover this.</p>'}`;
      const row = el('div', 'modal-actions');
      row.appendChild(button('🏗️ Raise cash', 'primary', () => this.openManage(p.id)));
      row.appendChild(
        button('💥 Declare bankruptcy', 'danger', () => {
          this.confirm(`Declare bankruptcy? ${escapeHtml(p.name)} is out of the game.`, 'Go bankrupt').then((ok) => {
            if (ok) void this.act(() => this.game.declareBankruptcy());
          });
        }),
      );
      m.body.appendChild(row);
    };
    update();
    this.phaseModal = { key, handle: m, update };
  }

  private confirm(text: string, yes = 'Yes'): Promise<boolean> {
    return new Promise((resolve) => {
      const m = openModal({ title: 'Are you sure?', cls: 'confirm-modal' });
      m.body.innerHTML = `<p>${text}</p>`;
      const row = el('div', 'modal-actions');
      let answered = false;
      row.appendChild(
        button(yes, 'danger', () => {
          answered = true;
          resolve(true);
          m.close();
        }),
      );
      row.appendChild(button('Cancel', 'ghost', () => m.close()));
      m.body.appendChild(row);
      void m.closed.then(() => {
        if (!answered) resolve(false);
      });
    });
  }

  // ------------------------------------------------------------------ manage / tiles

  private registerLive(m: ModalHandle, fn: () => void) {
    this.live.add(fn);
    void m.closed.then(() => this.live.delete(fn));
  }

  private openManage(pid: number) {
    const p = this.game.player(pid);
    const m = openModal({ title: `🏗️ ${escapeHtml(p.name)}'s properties`, cls: 'manage-modal' });
    const update = () => {
      const owned = this.game.ownedBy(pid);
      const can = this.game.canManage(pid) && !this.busy;
      m.body.innerHTML = '';
      const head = el('div', 'manage-head', `Cash <b>${money(p.cash)}</b>${this.s.phase === 'debt' ? ` · Owes <b class="warn-text">${money(this.game.debtTotal(pid))}</b>` : ''}`);
      m.body.appendChild(head);
      if (!owned.length) {
        m.body.appendChild(el('p', 'muted', 'No properties yet. Land on a city to buy it!'));
        return;
      }
      const list = el('div', 'manage-list');
      const groups = new Map<string, number[]>();
      for (const t of owned) {
        const key = TILES[t].group ?? TILES[t].kind;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(t);
      }
      for (const [key, tiles] of groups) {
        const g = GROUPS[key];
        const sec = el('div', 'manage-group');
        sec.style.setProperty('--g', g?.color ?? (key === 'transit' ? '#64748b' : '#0e7490'));
        const full = g && this.game.hasFullSet(pid, key);
        const total = g ? TILES.filter((x) => x.group === key).length : 0;
        const progress = g ? (full ? '<span class="tag good">Full set · can build</span>' : `<span class="tag">${tiles.length}/${total} owned</span>`) : '';
        sec.innerHTML = `<div class="mg-title">${g ? escapeHtml(g.name) : key === 'transit' ? '✈️ Skyports' : '⚡ Utilities'} ${progress}</div>`;
        if (g && !full) sec.appendChild(el('div', 'build-hint', `🔒 ${escapeHtml(this.game.buildBlocker(pid, tiles[0]) ?? '')}`));
        for (const t of tiles) {
          const o = this.s.props[t];
          const row = el('div', `mrow ${o.mortgaged ? 'mortgaged' : ''}`);
          const houses = o.houses === 5 ? '🏨' : '🏠'.repeat(o.houses);
          row.innerHTML = `<div class="mname">${TILES[t].icon} ${escapeHtml(TILES[t].name)} <span class="mh">${houses}</span>${o.mortgaged ? ' <span class="tag warn">Mortgaged</span>' : ''}</div>`;
          const btns = el('div', 'mbtns');
          if (TILES[t].kind === 'property') {
            btns.appendChild(button(`+🏠 ${money(houseCost(t))}`, 'small good', () => this.act(() => this.game.build(pid, t)), !can || !this.game.canBuild(pid, t)));
            btns.appendChild(button(`−🏠 +${money(houseCost(t) / 2)}`, 'small ghost', () => this.act(() => this.game.sell(pid, t)), !can || !this.game.canSell(pid, t)));
          }
          if (o.mortgaged)
            btns.appendChild(button(`Pay off ${money(unmortgageCost(t))}`, 'small gold', () => this.act(() => this.game.unmortgage(pid, t)), !can || !this.game.canUnmortgage(pid, t)));
          else
            btns.appendChild(button(`Mortgage +${money(mortgageValue(t))}`, 'small ghost', () => this.act(() => this.game.mortgage(pid, t)), !can || !this.game.canMortgage(pid, t)));
          row.appendChild(btns);
          sec.appendChild(row);
          const why = full && can && o.houses < 5 ? this.game.buildBlocker(pid, t) : null;
          if (why) sec.appendChild(el('div', 'build-hint', `ℹ️ ${escapeHtml(why)}`));
        }
        list.appendChild(sec);
      }
      m.body.appendChild(list);
      if (!can) m.body.appendChild(el('p', 'muted small', 'You can manage properties during your own turn.'));
      else m.body.appendChild(el('p', 'muted small', 'To build, own every city in a colour set. Houses go on evenly, then a hotel. Mortgaging needs the whole set free of buildings.'));
    };
    update();
    this.registerLive(m, update);
  }

  private openPortfolio(pid: number) {
    const p = this.game.player(pid);
    if (!p.ai && this.game.canManage(pid)) return this.openManage(pid);
    const m = openModal({ title: `${p.token} ${escapeHtml(p.name)}`, cls: 'manage-modal' });
    const owned = this.game.ownedBy(pid);
    m.body.innerHTML = `
      <div class="manage-head">Cash <b>${money(p.cash)}</b> · Net worth <b>${money(this.game.netWorth(pid))}</b></div>
      <div class="portfolio">${
        owned
          .map((t) => {
            const o = this.s.props[t];
            const col = TILES[t].group ? GROUPS[TILES[t].group!].color : '#64748b';
            return `<div class="pf-item ${o.mortgaged ? 'mortgaged' : ''}" style="--g:${col}" data-tile="${t}">${TILES[t].icon} ${escapeHtml(TILES[t].name)} <span>${o.houses === 5 ? '🏨' : '🏠'.repeat(o.houses)}</span></div>`;
          })
          .join('') || '<p class="muted">No properties.</p>'
      }</div>`;
    m.body.querySelectorAll<HTMLElement>('.pf-item').forEach((n) => n.addEventListener('click', () => this.openTile(Number(n.dataset.tile))));
  }

  private openTile(i: number) {
    const t = TILES[i];
    play('click');
    if (!t.price) {
      const desc: Record<string, string> = {
        start: `Collect ${money(this.s.settings.salary)} every time you pass or land here.`,
        jail: `Just visiting, unless you were busted. Pay ${money(JAIL_FINE)}, use a card, or roll doubles to get out.`,
        lounge: this.s.settings.jackpot ? `Taxes and fines pile up here. Current jackpot: <b>${money(this.s.jackpot)}</b>.` : 'Relax. Nothing happens here.',
        gotojail: 'Go directly to Lockup. Do not pass the Launch Pad.',
        tax: `Pay ${money(t.tax ?? 0)} to the city.`,
        fortune: 'Draw a Fortune card.',
        treasury: 'Draw a Treasury card.',
      };
      const m = openModal({ title: `${t.icon} ${escapeHtml(t.name)}`, cls: 'tile-modal' });
      m.body.innerHTML = `<p>${desc[t.kind] ?? ''}</p>`;
      return;
    }
    const m = openModal({ title: 'Deed', cls: 'tile-modal' });
    const update = () => {
      m.body.innerHTML = '';
      m.body.appendChild(deedCard(this.s, i));
      const own = this.s.props[i];
      const human = this.humanActor();
      if (own && human && own.owner === human.id && this.game.canManage(human.id)) {
        const row = el('div', 'modal-actions');
        const pid = human.id;
        if (t.kind === 'property') {
          row.appendChild(button(`+🏠 ${money(houseCost(i))}`, 'small good', () => this.act(() => this.game.build(pid, i)), this.busy || !this.game.canBuild(pid, i)));
          row.appendChild(button('−🏠', 'small ghost', () => this.act(() => this.game.sell(pid, i)), this.busy || !this.game.canSell(pid, i)));
        }
        if (own.mortgaged) row.appendChild(button('Pay off', 'small gold', () => this.act(() => this.game.unmortgage(pid, i)), this.busy || !this.game.canUnmortgage(pid, i)));
        else row.appendChild(button('Mortgage', 'small ghost', () => this.act(() => this.game.mortgage(pid, i)), this.busy || !this.game.canMortgage(pid, i)));
        m.body.appendChild(row);
      }
      if (own && t.kind === 'property' && own.houses < 5) {
        const viewer = human ?? this.s.players.find((p) => !p.ai && p.id === own.owner);
        if (viewer && viewer.id === own.owner) {
          const why = this.game.buildBlocker(viewer.id, i);
          if (why) m.body.appendChild(el('div', 'build-hint center', `🔒 ${escapeHtml(why)}`));
        }
      }
    };
    update();
    this.registerLive(m, update);
  }

  // ------------------------------------------------------------------ trading

  private sideHtml(side: TradeSide, owner: Player) {
    const parts = side.tiles.map((t) => {
      const col = TILES[t].group ? GROUPS[TILES[t].group!].color : '#64748b';
      return `<span class="tchip on" style="--g:${col}">${TILES[t].icon} ${escapeHtml(TILES[t].name)}${this.s.props[t]?.mortgaged ? ' (M)' : ''}</span>`;
    });
    if (side.cash) parts.push(`<span class="tchip cash on">💵 ${money(side.cash)}</span>`);
    if (side.jailCards) parts.push(`<span class="tchip on">🎫 ×${side.jailCards}</span>`);
    return `<div class="tside"><div class="tside-title" style="--pc:${owner.color}">${owner.token} ${escapeHtml(owner.name)} gives</div>${parts.join('') || '<span class="muted">Nothing</span>'}</div>`;
  }

  /** Shows a trade to a human player and resolves with their answer. */
  private askTrade(offer: TradeOffer, title: string): Promise<boolean> {
    return new Promise((resolve) => {
      const from = this.game.player(offer.from);
      const to = this.game.player(offer.to);
      const m = openModal({ title: '🤝 Trade offer', cls: 'trade-modal', dismissable: false });
      play('card');
      m.body.innerHTML = `<p class="center">${title}</p>
        <div class="trade-review">${this.sideHtml(offer.give, from)}<div class="swap">⇄</div>${this.sideHtml(offer.get, to)}</div>
        <p class="muted center small">${escapeHtml(to.name)}, do you accept?</p>`;
      const row = el('div', 'modal-actions');
      row.appendChild(
        button('✅ Accept', 'primary', () => {
          m.close();
          resolve(true);
        }),
      );
      row.appendChild(
        button('❌ Decline', 'ghost', () => {
          m.close();
          resolve(false);
        }),
      );
      m.body.appendChild(row);
    });
  }

  private openTrade(pid: number) {
    const me = this.game.player(pid);
    const others = this.s.players.filter((p) => p.id !== pid && !p.bankrupt);
    if (!others.length) return;
    let partner = others[0].id;
    const empty = (): TradeSide => ({ cash: 0, tiles: [], jailCards: 0 });
    let give = empty();
    let get = empty();
    const m = openModal({ title: '🤝 Trade', cls: 'trade-modal' });

    const column = (owner: Player, side: TradeSide, label: string) => {
      const col = el('div', 'tcol');
      col.innerHTML = `<div class="tcol-title" style="--pc:${owner.color}">${label}</div>`;
      const chips = el('div', 'tchips');
      const tradable = this.game.ownedBy(owner.id).filter((t) => {
        const g = TILES[t].group;
        return !g || TILES.filter((x) => x.group === g).every((x) => (this.s.props[x.index]?.houses ?? 0) === 0);
      });
      for (const t of tradable) {
        const colr = TILES[t].group ? GROUPS[TILES[t].group!].color : '#64748b';
        const on = side.tiles.includes(t);
        const chip = el('button', `tchip ${on ? 'on' : ''}`, `${TILES[t].icon} ${escapeHtml(TILES[t].short)}${this.s.props[t].mortgaged ? ' (M)' : ''}`);
        chip.style.setProperty('--g', colr);
        chip.addEventListener('click', () => {
          side.tiles = on ? side.tiles.filter((x) => x !== t) : [...side.tiles, t];
          play('click');
          draw();
        });
        chips.appendChild(chip);
      }
      if (!tradable.length) chips.innerHTML = '<span class="muted small">No tradable properties</span>';
      col.appendChild(chips);
      const cash = el('label', 'tcash');
      cash.innerHTML = `💵 Cash <input type="range" min="0" max="${owner.cash}" step="10" value="${side.cash}"/><input type="number" min="0" max="${owner.cash}" value="${side.cash}"/>`;
      const [range, num] = cash.querySelectorAll('input');
      const set = (v: number) => {
        side.cash = Math.max(0, Math.min(owner.cash, Math.floor(v || 0)));
        range.value = num.value = String(side.cash);
        refreshFooter();
      };
      range.addEventListener('input', () => set(Number(range.value)));
      num.addEventListener('change', () => set(Number(num.value)));
      col.appendChild(cash);
      if (owner.jailCards.length) {
        const jc = el('label', 'tcash', `🎫 Get-out cards <input type="number" min="0" max="${owner.jailCards.length}" value="${side.jailCards}"/>`);
        const inp = jc.querySelector('input')!;
        inp.addEventListener('change', () => {
          side.jailCards = Math.max(0, Math.min(owner.jailCards.length, Number(inp.value) || 0));
          inp.value = String(side.jailCards);
          refreshFooter();
        });
        col.appendChild(jc);
      }
      return col;
    };

    const footer = el('div', 'trade-footer');
    const refreshFooter = () => {
      footer.innerHTML = '';
      const offer: TradeOffer = { from: pid, to: partner, give, get };
      const err = this.game.validateTrade(offer);
      footer.appendChild(el('div', 'trade-msg muted small', err ? escapeHtml(err) : 'Ready to send'));
      footer.appendChild(button('Propose trade', 'primary', () => void propose(offer), !!err || this.busy || !this.game.canTradeNow(pid)));
    };

    const propose = async (offer: TradeOffer) => {
      const target = this.game.player(offer.to);
      let ok: boolean;
      if (target.ai) {
        footer.innerHTML = `<div class="thinking"><span class="dot-pulse" style="--pc:${target.color}"></span> ${escapeHtml(target.name)} is considering…</div>`;
        await sleep(700);
        ok = acceptsTrade(this.game, offer);
        if (!ok) {
          play('error');
          footer.innerHTML = '';
          footer.appendChild(el('div', 'trade-msg bad-text', `${escapeHtml(target.name)} declined. Try sweetening the deal.`));
          footer.appendChild(button('Propose again', 'primary', () => void propose({ from: pid, to: partner, give, get })));
          m.body.querySelector('.modal')?.classList.add('shake');
          return;
        }
      } else {
        m.close();
        ok = await this.askTrade(offer, `${escapeHtml(me.name)} proposes a trade. Pass the device to <b>${escapeHtml(target.name)}</b>.`);
        if (!ok) {
          toast(`${escapeHtml(target.name)} declined the trade`);
          return;
        }
      }
      m.close();
      void this.act(() => this.game.executeTrade(offer));
    };

    const draw = () => {
      m.body.innerHTML = '';
      const tabs = el('div', 'seg partner-seg');
      for (const o of others) {
        const b = el('button', o.id === partner ? 'on' : '', `${o.token} ${escapeHtml(o.name)}`);
        b.addEventListener('click', () => {
          partner = o.id;
          get = empty();
          draw();
        });
        tabs.appendChild(b);
      }
      m.body.appendChild(tabs);
      const grid = el('div', 'trade-grid');
      grid.appendChild(column(me, give, 'You give'));
      grid.appendChild(el('div', 'swap', '⇄'));
      grid.appendChild(column(this.game.player(partner), get, `You get from ${escapeHtml(this.game.player(partner).name)}`));
      m.body.appendChild(grid);
      m.body.appendChild(footer);
      refreshFooter();
    };
    draw();
  }

  // ------------------------------------------------------------------ menus

  private openMenu() {
    const m = openModal({ title: 'Menu', cls: 'menu-modal' });
    const list = el('div', 'menu-list');
    list.appendChild(button('▶ Resume', 'primary', () => m.close()));
    list.appendChild(
      button('📖 How to play', 'ghost', () => {
        m.close();
        openModal({ title: 'How to play', html: RULES_HTML, cls: 'rules-modal' });
      }),
    );
    list.appendChild(
      button('🏁 End game now (richest wins)', 'ghost', () => {
        m.close();
        void this.confirm('End the game now? The player with the highest net worth wins.', 'End game').then((ok) => {
          if (!ok) return;
          this.game.forfeitToWorth();
          void this.flush().then(() => {
            this.render();
            this.save();
          });
        });
      }),
    );
    list.appendChild(
      button('🏠 Main menu', 'ghost', () => {
        m.close();
        this.exit();
      }),
    );
    list.appendChild(el('p', 'muted small center', 'Your game is saved automatically.'));
    m.body.appendChild(list);
  }

  private showGameOver() {
    const s = this.s;
    clearSave();
    const ranked = [...s.players].sort((a, b) => {
      if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
      return this.game.netWorth(b.id) - this.game.netWorth(a.id);
    });
    const w = s.winner !== null ? this.game.player(s.winner) : ranked[0];
    play('win');
    confetti(window.innerWidth / 2, window.innerHeight / 3, 220);
    setTimeout(() => confetti(window.innerWidth * 0.25, window.innerHeight / 2, 120), 400);
    setTimeout(() => confetti(window.innerWidth * 0.75, window.innerHeight / 2, 120), 800);
    const m = openModal({ cls: 'gameover-modal', dismissable: false });
    m.body.innerHTML = `
      <div class="trophy">🏆</div>
      <div class="winner" style="--pc:${w.color}">${w.token} ${escapeHtml(w.name)} wins!</div>
      <p class="muted center">Finished in ${s.round} round${s.round === 1 ? '' : 's'}</p>
      <ol class="standings">${ranked
        .map((p) => `<li style="--pc:${p.color}" class="${p.bankrupt ? 'out' : ''}"><span>${p.token} ${escapeHtml(p.name)}</span><b>${p.bankrupt ? 'Bankrupt' : money(this.game.netWorth(p.id))}</b></li>`)
        .join('')}</ol>`;
    const row = el('div', 'modal-actions');
    row.appendChild(
      button('🔁 Play again', 'primary', () => {
        m.close();
        this.exit(true);
      }),
    );
    row.appendChild(
      button('🏠 Main menu', 'ghost', () => {
        m.close();
        this.exit();
      }),
    );
    row.appendChild(button('👀 View board', 'ghost', () => m.close()));
    m.body.appendChild(row);
  }
}
