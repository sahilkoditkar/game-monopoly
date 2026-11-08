import { acceptsTrade, apply, decide, fallback, newMemory, tradeOutlook, type AiMemory } from '../game/ai';
import { BUYABLE, GROUPS, JAIL_FINE, JAIL_INDEX, TILES, TRANSIT_RENTS, groupTiles, houseCost, mortgageValue, unmortgageCost } from '../game/board';
import { CARD_BY_ID } from '../game/cards';
import { capitalize, currentEdition, localize } from '../game/editions';
import { missionText } from '../game/extras';
import { dailyNumber, dailyStreak, recordDaily } from './daily';
import type { ActionCard } from '../game/types';
import { tr, trText } from '../i18n';
import { Game } from '../game/engine';
import type { GameEvent, GameState, Player, TradeOffer, TradeSide } from '../game/types';
import { BoardView } from './board';
import { DicePair } from './dice';
import { centerOf, confetti, countTo, el, escapeHtml, floatText, flyCoins, money, sleep, toast } from './fx';
import { button, deedCard, openModal, setWho, whoChip, type ModalHandle } from './modal';
import { legacyToken, rulesHtml } from './setup';
import { isMuted, play, setMuted } from './sound';

type Speed = 'normal' | 'fast' | 'turbo';
const SPEEDS: Record<Speed, { step: number; ai: number; roll: number; banner: number; card: number }> = {
  normal: { step: 180, ai: 700, roll: 1000, banner: 1100, card: 2200 },
  fast: { step: 100, ai: 320, roll: 650, banner: 650, card: 1300 },
  turbo: { step: 40, ai: 70, roll: 320, banner: 250, card: 500 },
};

const SAVE_KEY = 'st-save';

const CARD_ICONS: Record<ActionCard, string> = { boost: '🚀', holiday: '🏖️', half: '🏷️', free: '🏗️' };
const CARD_LABELS: Record<ActionCard, string> = { boost: 'Boost +3', holiday: 'Rent holiday', half: 'Half price', free: 'Free house' };
const CARD_HELP: Record<ActionCard, string> = {
  boost: 'Move 3 extra spaces on your next roll. Play before rolling.',
  holiday: 'Pay no rent for the rest of this turn. Play before rolling.',
  half: 'Buy the city you are on for half price.',
  free: 'Your next house this turn is free.',
};

export function loadSave(): { state: GameState; mem: AiMemory[] } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.state?.version !== 1 || data.state.phase === 'gameover') return null;
    data.state.players.forEach((p: { token: string }, i: number) => (p.token = legacyToken(p.token, i)));
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
  /** Shows the tiles 2-12 steps ahead before a human rolls. */
  private reach = pref('st-reach', '1') === '1';
  private bannerEl = el('div', 'turn-banner');
  private roundEl = el('span', 'round-pill');
  private busy = false;
  private looping = false;
  private destroyed = false;
  private displayCash: number[] = [];
  private speed: Speed = pref('st-speed', 'normal') as Speed;
  private tilt = pref('st-tilt', '0') === '1';
  /** AI turns play at Fast speed even when the game speed is Normal. */
  private aiFast = pref('st-aifast', '1') === '1';
  /** Set by "Skip": the rest of the AI turns run at Turbo until a human is up again. */
  private skipping = false;
  private soundBtn = el('button', 'icon-btn', isMuted() ? '🔇' : '🔊');
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
    this.maybeShowTips();
    void this.playAll(opening).then(() => {
      this.render();
      void this.loop();
    });
  }

  /** A one-time card explaining the hidden shortcuts. */
  private maybeShowTips() {
    if (pref('st-tips', '0') === '1' || this.s.players.every((p) => p.ai)) return;
    const tip = el(
      'div',
      'tip-card',
      `<div class="tip-title">💡 ${tr('Quick tips')}</div>
       <ul>
         <li>${tr('Tap any <b>tile</b> to see its price and rents.')}</li>
         <li>${tr('Tap a <b>player</b> to see their properties on the board.')}</li>
         <li>${tr('Glowing tiles show where your next roll can land.')}</li>
         <li>${tr('Press <b>Space</b> to roll or end your turn. ⏩ <b>Skip</b> speeds through computer turns.')}</li>
       </ul>`,
    );
    tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-label', tr('Quick tips'));
    const ok = button(tr('Got it'), 'primary small', () => {
      setPref('st-tips', '1');
      tip.classList.add('gone');
      setTimeout(() => tip.remove(), 300);
    });
    tip.appendChild(ok);
    this.root.appendChild(tip);
  }

  private get s() {
    return this.game.state;
  }

  private get t() {
    if (this.s.phase !== 'gameover' && this.game.player(this.game.actor()).ai) {
      if (this.skipping) return SPEEDS.turbo;
      if (this.aiFast && this.speed === 'normal') return SPEEDS.fast;
    }
    return SPEEDS[this.speed];
  }

  private get turbo() {
    return this.t === SPEEDS.turbo;
  }

  /** Fast-forwards the AI players until a human has to act. */
  private skipAi() {
    this.skipping = true;
    for (const a of document.getAnimations()) if (a.effect && isFinite(a.effect.getComputedTiming().endTime as number)) a.finish();
    play('click');
    this.renderControls();
  }

  destroy() {
    this.destroyed = true;
    document.body.classList.remove('docked');
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
    this.soundBtn.setAttribute('aria-label', tr('Sound on or off'));
    this.soundBtn.title = tr('Sound');
    this.soundBtn.addEventListener('click', () => this.toggleSound());
    const menuBtn = el('button', 'icon-btn menu-btn', `☰<span>${tr('Menu')}</span>`);
    menuBtn.setAttribute('aria-label', tr('Menu and settings'));
    menuBtn.addEventListener('click', () => this.openMenu());
    tools.append(this.soundBtn, menuBtn);
    top.appendChild(tools);

    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    const stage = el('main', 'stage');
    const boardWrap = el('div', 'board-wrap');
    boardWrap.appendChild(this.board.root);
    this.board.onTileClick = (i) => this.openTile(i);

    const c = this.board.center;
    c.innerHTML = `
      <div class="center-glow"></div>
      <div class="center-logo"><span class="logo-sky">SKYLINE</span><span class="logo-ty">TYCOON</span></div>
      <div class="deck deck-fortune"><span>🔮</span><b>${currentEdition().decks.fortune}</b></div>
      <div class="deck deck-treasury"><span>💼</span><b>${currentEdition().decks.treasury}</b></div>`;
    const hub = el('div', 'center-hub');
    hub.append(this.dice.root, this.statusEl, this.controlsEl);
    c.appendChild(hub);

    const side = el('aside', 'side');
    const logWrap = el('div', 'log-wrap');
    logWrap.innerHTML = `<div class="log-title"><span>${tr('Game log')}</span><button class="log-more" aria-expanded="false">${tr('Show all ▾')}</button></div>`;
    logWrap.appendChild(this.logEl);
    const more = logWrap.querySelector<HTMLButtonElement>('.log-more')!;
    more.addEventListener('click', () => {
      const open = logWrap.classList.toggle('expanded');
      more.textContent = open ? tr('Show less ▴') : tr('Show all ▾');
      more.setAttribute('aria-expanded', String(open));
    });
    side.append(this.playersEl, logWrap);

    stage.append(boardWrap, side, this.bannerEl);
    this.root.append(top, stage);
    this.root.classList.toggle('tilted', this.tilt);
    this.host.innerHTML = '';
    this.host.appendChild(this.root);
    // The setup screen may have been scrolled down to its Start button.
    window.scrollTo(0, 0);
  }

  private toggleSound() {
    setMuted(!isMuted());
    this.soundBtn.textContent = isMuted() ? '🔇' : '🔊';
    play('click');
  }

  private layout() {
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const landscape = vw >= vh * 1.1 && vw >= 720;
    const topH = landscape && vh < 520 ? 44 : 52;
    this.root.classList.toggle('landscape', landscape);
    this.root.classList.toggle('portrait', !landscape);
    let size: number;
    const short = landscape && vh < 520;
    this.root.classList.toggle('short', short);
    if (landscape) {
      const sideW = short ? Math.min(300, Math.max(220, vw * 0.3)) : Math.min(360, Math.max(250, vw * 0.27));
      this.root.style.setProperty('--side-w', `${sideW}px`);
      size = Math.min(vh - topH - (short ? 14 : 48), vw - sideW - (short ? 36 : 64));
    } else {
      size = Math.min(vw - 12, (vh - topH) * 0.68, 760);
    }
    this.board.resize(Math.max(280, Math.floor(size)));
    // Wide screens: decisions (buy, auction, debt) dock to the right instead of covering the board.
    const free = vw - this.board.root.getBoundingClientRect().right;
    const dock = landscape && !short && free >= 380;
    document.body.classList.toggle('docked', dock);
    if (dock) document.body.style.setProperty('--dock-w', `${Math.min(440, free - 24)}px`);
  }

  // ------------------------------------------------------------------ rendering

  private render() {
    if (this.destroyed) return;
    const s = this.s;
    this.roundEl.textContent =
      (s.settings.daily ? '📅 ' : '') +
      (s.settings.roundLimit ? tr('Round {n} / {max}', { n: Math.min(s.round, s.settings.roundLimit), max: s.settings.roundLimit }) : tr('Round {n}', { n: s.round })) +
      (s.settings.goal ? ` · 🏁 ${s.settings.goal === 'sets3' ? tr('3 sets') : money(this.game.raceProgress(this.s.current)?.target ?? 0)}` : '');
    this.board.setTokens(s);
    this.board.renderTiles(s);
    this.renderPlayers();
    this.renderControls();
    this.syncPhaseModal();
    const human = this.humanActor();
    this.board.showReach(this.reach && human && s.phase === 'roll' && !human.inJail && !this.busy ? human.pos : null);
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
          // One mini bar per colour set: a filled cell for each city owned, glowing when complete.
          if (n)
            chips.push(
              `<i class="gset ${n === tiles.length ? 'full' : ''}" style="--g:${g.color}" title="${tr('{set}: {n} of {total}', { set: escapeHtml(g.name), n, total: tiles.length })}">${tiles
                .map((t) => `<b class="${s.props[t.index]?.owner === p.id ? 'on' : ''}"></b>`)
                .join('')}</i>`,
            );
        }
        const stations = BUYABLE.filter((i) => TILES[i].kind === 'transit' && s.props[i]?.owner === p.id).length;
        const ut = BUYABLE.filter((i) => TILES[i].kind === 'utility' && s.props[i]?.owner === p.id).length;
        if (stations) chips.push(`<i class="gchip icon" title="${capitalize(localize('Skyports'))}">${TILES[5].icon}${stations}</i>`);
        if (ut) chips.push(`<i class="gchip icon" title="${tr('Utilities')}">⚡${ut}</i>`);
        const badges = [
          p.ai ? `<span class="badge ai-badge">${tr('AI')} · ${tr(p.difficulty)}</span>` : '',
          p.inJail ? `<span class="badge warn">🔒 ${escapeHtml(TILES[JAIL_INDEX].name)}</span>` : '',
          p.jailCards.length ? `<span class="badge">🎫×${p.jailCards.length}</span>` : '',
          s.missions?.[p.id] ? `<span class="badge ${s.missions[p.id].done ? 'good' : ''}" title="${tr('Secret mission')}">🎯${s.missions[p.id].done ? '✓' : ''}</span>` : '',
          s.hands?.[p.id]?.length ? `<span class="badge" title="${tr('Action cards')}">🃏×${s.hands[p.id].length}</span>` : '',
          s.settings.teams && p.team !== undefined ? `<span class="badge team team-${p.team}">${tr('Team {t}', { t: 'AB'[p.team] })}</span>` : '',
          this.raceBadge(p),
          p.bankrupt ? `<span class="badge bad">${tr('Bankrupt')}</span>` : '',
        ].join('');
        const active = p.id === s.current && s.phase !== 'gameover';
        return `<div class="pcard ${active ? 'active' : ''} ${p.bankrupt ? 'out' : ''}" data-pid="${p.id}" style="--pc:${p.color}">
          <div class="avatar">${p.token}</div>
          <div class="pinfo">
            <div class="pname">${escapeHtml(p.name)}</div>
            <div class="pbadges">${badges}</div>
          </div>
          <div class="pcash" data-cash="${p.id}">${money(this.displayCash[p.id] ?? p.cash)}</div>
          <div class="pprops">${chips.join('') || `<span class="muted small">${tr('No properties yet')}</span>`}</div>
        </div>`;
      })
      .join('');
    this.playersEl.innerHTML = html;
    this.playersEl.querySelectorAll<HTMLElement>('.pcard').forEach((c) =>
      c.addEventListener('click', () => this.openPortfolio(Number(c.dataset.pid))),
    );
  }

  /** Race mode: how close a player (or their team) is to the goal. */
  private raceBadge(p: Player): string {
    if (p.bankrupt) return '';
    const r = this.game.raceProgress(p.id);
    if (!r) return '';
    const label = this.s.settings.goal === 'sets3' ? `${r.value}/${r.target}` : `${Math.min(99, Math.floor((r.value / r.target) * 100))}%`;
    return `<span class="badge race" title="${escapeHtml(this.goalLabel())}">🏁 ${label}</span>`;
  }

  private goalLabel(): string {
    const goal = this.s.settings.goal;
    if (!goal) return '';
    return goal === 'sets3' ? tr('Race to 3 full colour sets') : tr('Race to {amount} net worth', { amount: money(this.game.raceProgress(this.s.current)?.target ?? 0) });
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
      this.statusEl.innerHTML = w ? tr('🏆 {name} wins!', { name: `<b>${escapeHtml(w.name)}</b>` }) : tr('Game over');
      c.appendChild(button(tr('New game'), 'primary', () => this.exit()));
      return;
    }
    const actor = this.game.player(this.game.actor());
    if (actor.ai || this.busy) {
      this.statusEl.innerHTML = actor.ai
        ? tr('{name} is playing…', { name: whoChip(actor) })
        : tr("{name}'s turn", { name: `<b>${escapeHtml(cur.name)}</b>` });
      if (!actor.ai) {
        const b = button('…', 'primary wide', () => {}, true);
        c.appendChild(b);
      } else if (!this.skipping) {
        const row = el('div', 'ctrl-row small');
        const skip = button(tr('⏩ Skip'), 'ghost', () => this.skipAi());
        skip.setAttribute('aria-label', tr("Skip the computer players' animations"));
        row.appendChild(skip);
        c.appendChild(row);
      }
      return;
    }
    const name = whoChip(actor);
    const row = el('div', 'ctrl-row');
    const row2 = el('div', 'ctrl-row small');
    switch (s.phase) {
      case 'roll':
        if (cur.inJail) {
          this.statusEl.innerHTML = tr('🔒 {name} is in {jail} (try {n}/3)', { name, jail: escapeHtml(TILES[JAIL_INDEX].name), n: cur.jailTurns + 1 });
          row.appendChild(button(tr('🎲 Roll doubles'), 'primary', () => this.act(() => this.game.roll())));
          row.appendChild(button(tr('Pay {amount}', { amount: money(JAIL_FINE) }), 'gold', () => this.act(() => this.game.payJailFine()), cur.cash < JAIL_FINE));
          if (cur.jailCards.length) row.appendChild(button(tr('🎫 Use card'), 'gold', () => this.act(() => this.game.useJailCard())));
        } else {
          this.statusEl.innerHTML = s.doublesCount ? tr('🎉 Doubles! {name}, roll again', { name }) : tr('{name}, your turn', { name });
          row.appendChild(button(s.doublesCount ? tr('🎲 Roll again') : tr('🎲 Roll dice'), 'primary wide pulse', () => this.act(() => this.game.roll())));
        }
        break;
      case 'end': {
        this.statusEl.innerHTML = tr('{name}, anything else?', { name });
        const sets = [...new Set(BUYABLE.filter((i) => this.game.canBuild(actor.id, i)).map((i) => GROUPS[TILES[i].group!].name))];
        if (sets.length) this.statusEl.innerHTML += `<div class="ctrl-hint">${tr('💡 You can build on {sets}', { sets: sets.map((n) => `<b>${escapeHtml(n)}</b>`).join(', ') })}</div>`;
        row.appendChild(button(tr('End turn ➜'), 'primary wide', () => this.act(() => this.game.endTurn())));
        break;
      }
      case 'buy':
        this.statusEl.innerHTML = tr('{name} is deciding…', { name });
        row.appendChild(button(tr('View offer'), 'primary', () => this.syncPhaseModal(true)));
        break;
      case 'auction':
        this.statusEl.innerHTML = tr('🔨 Auction: {name} to bid', { name });
        break;
      case 'debt':
        this.statusEl.innerHTML = tr('⚠️ {name} owes {amount}', { name, amount: money(this.game.debtTotal(actor.id)) });
        row.appendChild(button(tr('Raise cash'), 'gold', () => this.openManage(actor.id)));
        break;
    }
    if (s.phase === 'roll' || s.phase === 'end') {
      row2.appendChild(button(tr('🏗️ Manage'), 'ghost', () => this.openManage(actor.id)));
      row2.appendChild(button(tr('🤝 Trade'), 'ghost', () => this.openTrade(actor.id)));
      if (s.hands?.[actor.id]) row2.appendChild(button(`🃏 ${s.hands[actor.id].length}`, 'ghost cards-btn', () => this.openHand(actor.id)));
    }
    const fx = s.turnFx;
    const active = fx ? (['boost', 'holiday', 'half', 'free'] as ActionCard[]).filter((k) => fx[k]) : [];
    if (active.length) this.statusEl.innerHTML += `<div class="ctrl-hint">${active.map((k) => `${CARD_ICONS[k]} ${tr(CARD_LABELS[k])}`).join(' · ')}</div>`;
    c.append(row);
    if (row2.childElementCount) c.append(row2);
  }

  private appendLog(raw: string) {
    const en = localize(raw);
    const text = trText(en);
    // Lines start with the player's name: show their token in their colour instead.
    const who = [...this.s.players].sort((a, b) => b.name.length - a.name.length).find((p) => text.startsWith(p.name));
    let html = escapeHtml(text);
    if (who) {
      const roll = /^ rolled (\d) \+ (\d)( \(doubles!\))?\.$/.exec(en.slice(who.name.length));
      html = roll
        ? `<b>${escapeHtml(who.name)}</b> <span class="log-dice">🎲 ${roll[1]} + ${roll[2]}${roll[3] ? ` ${tr('(doubles!)')}` : ''}</span>`
        : `<b>${escapeHtml(who.name)}</b>${escapeHtml(text.slice(who.name.length))}`;
      html = `<span class="log-tok">${who.token}</span><span>${html}</span>`;
    }
    const line = el('div', `log-line ${who ? 'has-who' : ''}`, html);
    if (who) line.style.setProperty('--pc', who.color);
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
        if (!p.ai) {
          this.skipping = false;
          break;
        }
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
    else accepted = await this.askTrade(offer, tr('{from} wants to trade with {to}', { from: escapeHtml(from.name), to: escapeHtml(to.name) }));
    if (accepted) {
      this.game.executeTrade(offer);
    } else {
      this.game.log(`${to.name} turned down ${from.name}'s trade offer.`);
      if (to.ai) toast(tr("🤝 {to} declined {from}'s offer", { to: escapeHtml(to.name), from: escapeHtml(from.name) }));
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
        if (this.logEl.firstElementChild && !this.logEl.firstElementChild.classList.contains('log-sep')) this.logEl.prepend(el('div', 'log-sep'));
        this.bannerEl.innerHTML = `<div class="banner-inner" style="--pc:${p.color}"><span class="banner-token">${p.token}</span><span>${tr("{name}'s turn", { name: escapeHtml(p.name) })}</span></div>`;
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
        if (e.doubles) floatText(centerOf(this.dice.root).x, centerOf(this.dice.root).y - 30, tr('DOUBLES!'), 'big gold');
        break;
      case 'move': {
        const target = e.path[e.path.length - 1];
        await this.board.moveToken(e.player, e.path, e.path.length > 14 ? this.t.step * 0.6 : this.t.step, e.jump, !!e.jump && target === JAIL_INDEX);
        this.board.highlight(target);
        const mover = this.game.player(e.player);
        const land = TILES[target];
        this.statusEl.innerHTML = `${mover.token} <b>${escapeHtml(mover.name)}</b> → ${land.icon} <b>${escapeHtml(land.name)}</b>`;
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
        if (this.turbo) break;
        const from = this.tokenPoint(e.from);
        const to = e.to !== null ? this.tokenPoint(e.to) : centerOf(this.board.center);
        if (e.to === null) play('pay');
        await flyCoins(from, to, e.to !== null ? 7 : 4, Math.round(((e.to !== null ? 650 : 450) * this.t.step) / 180));
        break;
      }
      case 'buy': {
        this.board.renderTiles(s, e.tile);
        play('buy');
        const pt = centerOf(this.board.tileElement(e.tile));
        floatText(pt.x, pt.y, tr('SOLD!'), 'stamp');
        await sleep(this.turbo ? 50 : 350);
        break;
      }
      case 'card':
        await this.showCard(e.card, e.player);
        break;
      case 'jail': {
        play('jail');
        const pt = centerOf(this.board.root);
        floatText(pt.x, pt.y, tr('🚨 BUSTED!'), 'big red');
        await sleep(this.turbo ? 100 : 600);
        break;
      }
      case 'leaveJail':
        this.board.setTokens(s);
        break;
      case 'build':
        this.board.renderTiles(s, e.tile, true);
        play('build');
        await sleep(this.turbo ? 30 : 220);
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
          toast(tr('🔨 {name} won {tile} for {amount}', { name: `<b>${escapeHtml(w.name)}</b>`, tile: escapeHtml(TILES[e.tile].name), amount: money(e.amount) }), 'good');
        } else toast(tr('🔨 No bids for {tile}', { tile: escapeHtml(TILES[e.tile].name) }));
        break;
      }
      case 'fullSet': {
        const p = this.game.player(e.player);
        const g = GROUPS[e.group];
        const pt = this.tokenPoint(e.player);
        confetti(pt.x, pt.y, 90, [g.color, '#ffffff', p.color]);
        play('jackpot');
        toast(tr('⭐ {name} owns all of {set}!', { name: `<b>${escapeHtml(p.name)}</b>`, set: `<b style="color:${g.color}">${escapeHtml(g.name)}</b>` }), 'good', 3200);
        await sleep(this.turbo ? 50 : 500);
        break;
      }
      case 'jackpot': {
        const pt = this.tokenPoint(e.player);
        confetti(pt.x, pt.y, 140);
        play('jackpot');
        floatText(pt.x, pt.y - 30, tr('JACKPOT {amount}!', { amount: money(e.amount) }), 'big gold');
        await sleep(600);
        break;
      }
      case 'bankrupt': {
        const p = this.game.player(e.player);
        play('bankrupt');
        toast(tr('💥 {name} went bankrupt!', { name: `<b>${escapeHtml(p.name)}</b>` }), 'bad', 3500);
        this.board.setTokens(s);
        this.board.renderTiles(s);
        await sleep(this.turbo ? 100 : 900);
        break;
      }
      case 'news':
        play('turn');
        toast(`<b>${escapeHtml(trText(localize(e.text)))}</b>`, 'news', 4500);
        this.board.renderTiles(s);
        await sleep(this.turbo ? 80 : 900);
        break;
      case 'mission': {
        const p = this.game.player(e.player);
        const pt = this.tokenPoint(e.player);
        confetti(pt.x, pt.y, 100, ['#ffd166', '#ffffff', p.color]);
        play('jackpot');
        toast(tr('🎯 {name} completed a secret mission: {mission}!', { name: `<b>${escapeHtml(p.name)}</b>`, mission: escapeHtml(trText(localize(missionText(s.missions![e.player])))) }), 'good', 4000);
        await sleep(this.turbo ? 80 : 600);
        break;
      }
      case 'actionCard': {
        const p = this.game.player(e.player);
        play('card');
        if (p.ai) toast(`${CARD_ICONS[e.card]} ${tr('{name} played {card}', { name: `<b>${escapeHtml(p.name)}</b>`, card: tr(CARD_LABELS[e.card]) })}`);
        break;
      }
      case 'trade':
        play('buy');
        this.board.renderTiles(s);
        toast(tr('🤝 {a} and {b} made a trade', { a: escapeHtml(this.game.player(e.offer.from).name), b: escapeHtml(this.game.player(e.offer.to).name) }), 'good');
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
    if (p.ai && this.turbo) {
      toast(`${card.deck === 'fortune' ? '🔮' : '💼'} <b>${escapeHtml(p.name)}</b>: ${escapeHtml(card.title)}`);
      return;
    }
    const m = openModal({ cls: 'card-modal', dismissable: false, peek: tr('card') });
    const flip = el('div', `game-card ${card.deck}`);
    flip.innerHTML = `
      <div class="card-face card-back"><div class="card-back-icon">${card.deck === 'fortune' ? '🔮' : '💼'}</div><div>${currentEdition().decks[card.deck].toUpperCase()}</div></div>
      <div class="card-face card-front">
        <div class="card-kind">${card.deck === 'fortune' ? '🔮' : '💼'} ${currentEdition().decks[card.deck]}</div>
        <div class="card-title">${escapeHtml(card.title)}</div>
        <div class="card-text">${escapeHtml(card.text)}</div>
        <div class="card-who" style="--pc:${p.color}">${p.token} ${escapeHtml(p.name)}</div>
      </div>`;
    m.body.appendChild(flip);
    requestAnimationFrame(() => setTimeout(() => flip.classList.add('flipped'), 80));
    if (!p.ai) {
      const ok = button(tr('OK'), 'primary', () => m.close());
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
        // "View offer" also brings back a dialog the player hid to look at the board.
        if (force && this.phaseModal.handle.root.classList.contains('peeking')) document.querySelector<HTMLElement>('.peek-back')?.click();
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
    const m = openModal({ title: tr('For sale'), cls: 'buy-modal', dismissable: false, peek: tr('decision'), who: p });
    const update = () => {
      m.body.innerHTML = '';
      m.body.appendChild(deedCard(this.s, p.pos));
      const price = this.game.buyPrice();
      const short = p.cash < price;
      const info = el('div', 'buy-info', short
        ? tr('You have {cash}. Mortgage or sell to raise {more} more, or let it go to auction.', { cash: money(p.cash), more: money(price - p.cash) })
        : tr('You have {cash}. After buying: {after}', { cash: `<b>${money(p.cash)}</b>`, after: `<b>${money(p.cash - price)}</b>` }));
      m.body.appendChild(info);
      const advice = this.buyAdvice(p.id, p.pos);
      if (advice) m.body.appendChild(el('div', 'advice', advice));
      const row = el('div', 'modal-actions');
      row.appendChild(button(tr('Buy for {price}', { price: money(price) }), 'primary', () => this.act(() => this.game.buy()), short));
      if (this.game.cardBlocker(p.id, 'half') === null) row.appendChild(button(`🏷️ ${tr('Half price')}`, 'gold', () => this.act(() => this.game.playCard(p.id, 'half'))));
      row.appendChild(button(this.s.settings.auctions ? tr('🔨 Auction') : tr('Pass'), 'ghost', () => this.act(() => this.game.decline())));
      if (short) row.appendChild(button(tr('🏗️ Manage'), 'gold', () => this.openManage(p.id)));
      m.body.appendChild(row);
    };
    update();
    this.phaseModal = { key, handle: m, update };
  }

  /** One line on what owning `tile` would mean for `pid`: completing a set, blocking a rival, etc. */
  private buyAdvice(pid: number, tile: number): string {
    const t = TILES[tile];
    const owner = (i: number) => this.s.props[i]?.owner ?? null;
    if (t.kind === 'property' && t.group) {
      const g = GROUPS[t.group];
      const tiles = groupTiles(t.group);
      const mine = tiles.filter((i) => owner(i) === pid).length + 1;
      const set = `<b style="color:${g.color}">${escapeHtml(g.name)}</b>`;
      if (mine === tiles.length) return tr('⭐ Completes your {set} set. Rent doubles and you can build!', { set });
      // A rival who owns every other city in this set would be blocked.
      const others = tiles.filter((i) => i !== tile && owner(i) !== pid).map(owner);
      const rival = others.length && others.every((o) => o !== null && o === others[0]) ? this.game.player(others[0]!) : null;
      if (rival && mine === 1) return tr('🛡️ Blocks {name} from completing {set}.', { name: `<b>${escapeHtml(rival.name)}</b>`, set });
      const taken = tiles.filter((i) => owner(i) !== null && owner(i) !== pid);
      const own = tr("You'd own {n} of {total} {set}.", { n: mine, total: tiles.length, set });
      if (taken.length) return `${own} ${taken.map((i) => tr('{tile} belongs to {name}', { tile: escapeHtml(TILES[i].name), name: escapeHtml(this.game.player(owner(i)!).name) })).join(', ')}.`;
      return `${own} ${tr('Nobody else owns any yet.')}`;
    }
    if (t.kind === 'transit') {
      const n = BUYABLE.filter((i) => TILES[i].kind === 'transit' && owner(i) === pid).length + 1;
      return tr("{icon} You'd own {n} of 4 {transit}: rent {rent} per visit.", { icon: t.icon, n, transit: escapeHtml(localize('Skyports')), rent: money(TRANSIT_RENTS[n - 1]) });
    }
    if (t.kind === 'utility') {
      const both = BUYABLE.some((i) => i !== tile && TILES[i].kind === 'utility' && owner(i) === pid);
      return both ? tr('⚡ Both utilities: rent becomes 10× the dice roll.') : tr('⚡ Rent is 4× the dice roll, or 10× with both utilities.');
    }
    return '';
  }

  private openAuction(key: string) {
    const m = openModal({ title: tr('🔨 Auction'), cls: 'auction-modal', dismissable: false, peek: tr('auction') });
    let draft = 0;
    const update = () => {
      const a = this.s.auction;
      if (!a) return;
      const actor = this.game.player(a.active[a.turn]);
      // The person at this device: the bidder now, or a human waiting for their next go.
      const me = actor.ai ? a.active.map((id) => this.game.player(id)).find((p) => !p.ai) : actor;
      const leader = a.bidder !== null ? this.game.player(a.bidder) : null;
      const min = this.game.minBid();
      if (draft < min) draft = min;
      if (me && draft > me.cash) draft = Math.max(min, me.cash);
      // Rebuilding the panel must not throw away the player's scroll position.
      const scroller = m.root.querySelector<HTMLElement>('.modal');
      const scrollTop = scroller?.scrollTop ?? 0;
      setWho(m, actor);
      m.body.innerHTML = '';
      const wrap = el('div', 'auction-grid');
      wrap.appendChild(deedCard(this.s, a.tile));
      const side = el('div', 'auction-side');
      side.innerHTML = `
        <div class="now-bidding ${actor.ai ? '' : 'mine'}" style="--pc:${actor.color}">${actor.ai ? tr('Now bidding: {name}', { name: whoChip(actor) }) : tr('Your turn to bid, {name}', { name: whoChip(actor) })}</div>
        <div class="auction-bid">${a.bid ? money(a.bid) : tr('No bids yet')}</div>
        <div class="auction-leader">${leader ? tr('Leading: {name}', { name: `<span class="chip" style="--pc:${leader.color}">${leader.token} ${escapeHtml(leader.name)}</span>` }) : tr('Opening bid {amount}', { amount: money(min) })}</div>
        <div class="bidders">${this.s.players
          .filter((p) => !p.bankrupt)
          .map((p) => {
            const st = a.active.includes(p.id) ? (p.id === actor.id ? 'turn' : 'in') : 'out';
            return `<span class="bidder ${st}" style="--pc:${p.color}">${p.token} ${escapeHtml(p.name)} <small>${st === 'out' ? tr('out') : money(p.cash)}</small></span>`;
          })
          .join('')}</div>`;
      if (actor.ai) {
        side.appendChild(el('div', 'thinking', `<span class="dot-pulse" style="--pc:${actor.color}"></span> ${tr('{name} is thinking…', { name: escapeHtml(actor.name) })}`));
      }
      // Short of cash? Mortgage or sell right here, then come back and bid.
      if (me && me === actor && !this.busy) {
        const extra = this.game.liquidity(me.id) - me.cash;
        if (extra > 0) {
          const raise = button(tr('🏦 Raise cash (up to {amount})', { amount: money(extra) }), 'gold small raise-btn', () => this.openManage(me.id));
          side.appendChild(raise);
        }
      }
      // While someone else bids, a human still in the auction keeps their (disabled) controls,
      // so the panel doesn't shrink and jump back to the top.
      let row: HTMLElement | null = null;
      if (me) {
        const myTurn = me === actor && !this.busy;
        const advice = this.buyAdvice(me.id, a.tile);
        if (advice) side.appendChild(el('div', 'advice', advice));
        const stepper = el('div', 'stepper');
        const minus = button('−10', 'ghost small', () => {
          draft = Math.max(min, draft - 10);
          update();
        }, !myTurn);
        const val = el('div', 'stepper-val', money(draft));
        const plus = (n: number) =>
          button(`+${n}`, 'ghost small', () => {
            draft = Math.min(me.cash, draft + n);
            update();
          }, !myTurn);
        stepper.append(minus, val, plus(10), plus(50), plus(100));
        side.appendChild(stepper);
        row = el('div', 'modal-actions');
        row.appendChild(button(tr('Bid {amount}', { amount: money(draft) }), 'primary', () => this.act(() => this.game.bid(me.id, draft)), !myTurn || me.cash < min));
        row.appendChild(button(tr('Drop out'), 'ghost', () => this.act(() => this.game.passBid(me.id)), !myTurn));
        side.appendChild(row);
      }
      wrap.appendChild(side);
      m.body.appendChild(wrap);
      if (scroller) {
        scroller.scrollTop = scrollTop;
        // When it comes back to you, make sure the Bid buttons are on screen.
        if (row && me === actor && scroller.scrollHeight > scroller.clientHeight) {
          const r = row.getBoundingClientRect();
          const box = scroller.getBoundingClientRect();
          if (r.bottom > box.bottom) scroller.scrollTop += r.bottom - box.bottom + 12;
        }
      }
    };
    update();
    this.phaseModal = { key, handle: m, update };
  }

  private openDebt(key: string) {
    const m = openModal({ title: tr('⚠️ Not enough cash'), cls: 'debt-modal', dismissable: false, peek: tr('decision') });
    const update = () => {
      const d = this.s.debts[0];
      if (!d) return;
      const p = this.game.player(d.from);
      setWho(m, p);
      const to = d.to !== null ? this.game.player(d.to).name : tr('the bank');
      const canRaise = this.game.liquidity(p.id) >= this.game.debtTotal(p.id);
      m.body.innerHTML = `
        <p>${tr('{name} owes {amount} to {to} ({reason}) but has only {cash}.', { name: `<b>${escapeHtml(p.name)}</b>`, amount: `<b>${money(d.amount)}</b>`, to: escapeHtml(to), reason: escapeHtml(trText(localize(d.reason))), cash: `<b>${money(p.cash)}</b>` })}</p>
        <p class="muted">${tr('Sell buildings or mortgage properties to raise {amount}. The debt is paid automatically once you have the cash.', { amount: money(d.amount - p.cash) })}</p>
        ${canRaise ? '' : `<p class="warn-text">${tr("Even selling everything won't cover this.")}</p>`}`;
      const row = el('div', 'modal-actions');
      row.appendChild(button(tr('🏗️ Raise cash'), 'primary', () => this.openManage(p.id)));
      row.appendChild(
        button(tr('💥 Declare bankruptcy'), 'danger', () => {
          this.confirm(tr('Declare bankruptcy? {name} is out of the game.', { name: escapeHtml(p.name) }), tr('Go bankrupt')).then((ok) => {
            if (ok) void this.act(() => this.game.declareBankruptcy());
          });
        }),
      );
      m.body.appendChild(row);
    };
    update();
    this.phaseModal = { key, handle: m, update };
  }

  private confirm(text: string, yes = tr('Yes')): Promise<boolean> {
    return new Promise((resolve) => {
      const m = openModal({ title: tr('Are you sure?'), cls: 'confirm-modal' });
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
      row.appendChild(button(tr('Cancel'), 'ghost', () => m.close()));
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
    const m = openModal({ title: tr("🏗️ {name}'s properties", { name: escapeHtml(p.name) }), cls: 'manage-modal', peek: tr('properties'), who: p });
    this.markOwner(m, pid);
    const update = () => {
      const owned = this.game.ownedBy(pid);
      const can = this.game.canManage(pid) && !this.busy;
      m.body.innerHTML = '';
      const head = el('div', 'manage-head', `${tr('Cash {cash}', { cash: `<b>${money(p.cash)}</b>` })}${this.s.phase === 'debt' ? ` · ${tr('Owes {amount}', { amount: `<b class="warn-text">${money(this.game.debtTotal(pid))}</b>` })}` : ''}`);
      m.body.appendChild(head);
      const mission = this.s.missions?.[pid];
      if (mission) m.body.appendChild(el('div', `mission-box ${mission.done ? 'done' : ''}`, `${mission.done ? '✅' : '🎯'} ${tr('Your secret mission: {mission}', { mission: `<b>${escapeHtml(trText(localize(missionText(mission))))}</b>` })} <small>${mission.done ? tr('Done!') : tr('Bonus {amount}', { amount: money(500) })}</small>`));
      if (!owned.length) {
        m.body.appendChild(el('p', 'muted', tr('No properties yet. Land on a city to buy it!')));
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
        const progress = g ? (full ? `<span class="tag good">${tr('Full set · can build')}</span>` : `<span class="tag">${tr('{n}/{total} owned', { n: tiles.length, total })}</span>`) : '';
        sec.innerHTML = `<div class="mg-title">${g ? escapeHtml(g.name) : key === 'transit' ? `${TILES[5].icon} ${capitalize(localize('Skyports'))}` : tr('⚡ Utilities')} ${progress}</div>`;
        if (g && !full) sec.appendChild(el('div', 'build-hint', `🔒 ${escapeHtml(trText(localize(this.game.buildBlocker(pid, tiles[0]) ?? '')))}`));
        for (const t of tiles) {
          const o = this.s.props[t];
          const row = el('div', `mrow ${o.mortgaged ? 'mortgaged' : ''}`);
          const houses = o.houses === 5 ? '🏨' : '🏠'.repeat(o.houses);
          row.innerHTML = `<div class="mname">${TILES[t].icon} ${escapeHtml(TILES[t].name)} <span class="mh">${houses}</span>${o.mortgaged ? ` <span class="tag warn">${tr('Mortgaged')}</span>` : ''}</div>`;
          const btns = el('div', 'mbtns');
          // Build and sell only appear where they can apply: a full set, or a tile with buildings.
          if (TILES[t].kind === 'property' && can && (full || this.s.settings.earlyBuild) && o.houses < 5)
            btns.appendChild(button(`+🏠 ${money(houseCost(t))}`, 'small good', () => this.act(() => this.game.build(pid, t)), !can || !this.game.canBuild(pid, t)));
          if (TILES[t].kind === 'property' && o.houses > 0)
            btns.appendChild(button(`−🏠 +${money(houseCost(t) / 2)}`, 'small ghost', () => this.act(() => this.game.sell(pid, t)), this.busy || !this.game.canSell(pid, t)));
          if (o.mortgaged)
            btns.appendChild(button(tr('Pay off {amount}', { amount: money(unmortgageCost(t)) }), 'small gold', () => this.act(() => this.game.unmortgage(pid, t)), !can || !this.game.canUnmortgage(pid, t)));
          else
            btns.appendChild(button(tr('Mortgage +{amount}', { amount: money(mortgageValue(t)) }), 'small ghost', () => this.act(() => this.game.mortgage(pid, t)), this.busy || !this.game.canMortgage(pid, t)));
          row.appendChild(btns);
          sec.appendChild(row);
          const why = (full || this.s.settings.earlyBuild) && can && o.houses < 5 ? this.game.buildBlocker(pid, t) : null;
          if (why) sec.appendChild(el('div', 'build-hint', `ℹ️ ${escapeHtml(trText(localize(why)))}`));
        }
        list.appendChild(sec);
      }
      m.body.appendChild(list);
      if (this.game.canRaiseForAuction(pid)) m.body.appendChild(el('p', 'muted small', tr('Auction: mortgage or sell here to raise cash, then go back and bid.')));
      else if (!can) m.body.appendChild(el('p', 'muted small', tr('You can manage properties during your own turn.')));
      else m.body.appendChild(el('p', 'muted small', tr('To build, own every city in a colour set. Houses go on evenly, then a hotel. Mortgaging needs the whole set free of buildings.')));
    };
    update();
    this.registerLive(m, update);
  }

  /** The player's action cards, each with a Play button (or why it can't be played now). */
  private openHand(pid: number) {
    const m = openModal({ title: `🃏 ${tr('Action cards')}`, cls: 'hand-modal', peek: tr('cards'), who: this.game.player(pid) });
    const update = () => {
      const hand = this.s.hands?.[pid] ?? [];
      m.body.innerHTML = '';
      if (!hand.length) m.body.appendChild(el('p', 'muted', tr('No cards right now. You get one each time you pass {start}.', { start: escapeHtml(TILES[0].name) })));
      const list = el('div', 'hand');
      hand.forEach((card) => {
        const why = this.game.cardBlocker(pid, card);
        const c = el('div', `action-card ac-${card}`, `<div class="ac-icon">${CARD_ICONS[card]}</div><div class="ac-name">${tr(CARD_LABELS[card])}</div><div class="ac-text">${tr(CARD_HELP[card])}</div>`);
        const b = button(tr('Play'), 'primary small', () => {
          m.close();
          void this.act(() => this.game.playCard(pid, card));
        }, why !== null || this.busy);
        c.appendChild(b);
        if (why) c.appendChild(el('div', 'ac-why', escapeHtml(trText(why))));
        list.appendChild(c);
      });
      m.body.appendChild(list);
      m.body.appendChild(el('p', 'muted small', tr('One card per turn. You can hold up to 3 and get a new one each time you pass {start}.', { start: escapeHtml(TILES[0].name) })));
    };
    update();
    this.registerLive(m, update);
  }

  /** Highlights a player's tiles on the board while their property list is open. */
  private markOwner(m: ModalHandle, pid: number) {
    this.board.markOwner(this.s, pid);
    void m.closed.then(() => this.board.markOwner(this.s, null));
  }

  private openPortfolio(pid: number) {
    const p = this.game.player(pid);
    if (!p.ai && this.game.canManage(pid)) return this.openManage(pid);
    const m = openModal({ title: `${p.token} ${escapeHtml(p.name)}`, cls: 'manage-modal', peek: tr('properties') });
    this.markOwner(m, pid);
    const owned = this.game.ownedBy(pid);
    m.body.innerHTML = `
      <div class="manage-head">${tr('Cash {cash}', { cash: `<b>${money(p.cash)}</b>` })} · ${tr('Net worth {worth}', { worth: `<b>${money(this.game.netWorth(pid))}</b>` })}</div>
      ${this.s.missions?.[pid] ? `<div class="mission-box ${this.s.missions[pid].done ? 'done' : ''}">${this.s.missions[pid].done ? `✅ ${escapeHtml(trText(localize(missionText(this.s.missions[pid]))))}` : `🎯 ${tr('Secret mission: hidden')}`}</div>` : ''}
      <div class="portfolio">${
        owned
          .map((t) => {
            const o = this.s.props[t];
            const col = TILES[t].group ? GROUPS[TILES[t].group!].color : '#64748b';
            return `<div class="pf-item ${o.mortgaged ? 'mortgaged' : ''}" style="--g:${col}" data-tile="${t}">${TILES[t].icon} ${escapeHtml(TILES[t].name)} <span>${o.houses === 5 ? '🏨' : '🏠'.repeat(o.houses)}</span></div>`;
          })
          .join('') || `<p class="muted">${tr('No properties.')}</p>`
      }</div>`;
    m.body.querySelectorAll<HTMLElement>('.pf-item').forEach((n) => n.addEventListener('click', () => this.openTile(Number(n.dataset.tile))));
  }

  private openTile(i: number) {
    const t = TILES[i];
    play('click');
    if (!t.price) {
      const desc: Record<string, string> = {
        start: tr('Collect {amount} every time you pass or land here.', { amount: money(this.s.settings.salary) }),
        jail: tr('Just visiting, unless you were busted. Pay {fine}, use a card, or roll doubles to get out.', { fine: money(JAIL_FINE) }),
        lounge: this.s.settings.jackpot ? tr('Taxes and fines pile up here. Current jackpot: {amount}.', { amount: `<b>${money(this.s.jackpot)}</b>` }) : tr('Relax. Nothing happens here.'),
        gotojail: tr('Go directly to {jail}. Do not pass {start}.', { jail: escapeHtml(TILES[JAIL_INDEX].name), start: escapeHtml(TILES[0].name) }),
        tax: tr('Pay {amount} to the city.', { amount: money(t.tax ?? 0) }),
        fortune: tr('Draw a {deck} card.', { deck: currentEdition().decks.fortune }),
        treasury: tr('Draw a {deck} card.', { deck: currentEdition().decks.treasury }),
      };
      const m = openModal({ title: `${t.icon} ${escapeHtml(t.name)}`, cls: 'tile-modal' });
      m.body.innerHTML = `<p>${desc[t.kind] ?? ''}</p>`;
      return;
    }
    const m = openModal({ title: tr('Deed'), cls: 'tile-modal' });
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
        if (own.mortgaged) row.appendChild(button(tr('Pay off'), 'small gold', () => this.act(() => this.game.unmortgage(pid, i)), this.busy || !this.game.canUnmortgage(pid, i)));
        else row.appendChild(button(tr('Mortgage'), 'small ghost', () => this.act(() => this.game.mortgage(pid, i)), this.busy || !this.game.canMortgage(pid, i)));
        m.body.appendChild(row);
      }
      if (own && t.kind === 'property' && own.houses < 5) {
        const viewer = human ?? this.s.players.find((p) => !p.ai && p.id === own.owner);
        if (viewer && viewer.id === own.owner) {
          const why = this.game.buildBlocker(viewer.id, i);
          if (why) m.body.appendChild(el('div', 'build-hint center', `🔒 ${escapeHtml(trText(localize(why)))}`));
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
    return `<div class="tside"><div class="tside-title" style="--pc:${owner.color}">${tr('{name} gives', { name: `${owner.token} ${escapeHtml(owner.name)}` })}</div>${parts.join('') || `<span class="muted">${tr('Nothing')}</span>`}</div>`;
  }

  /** Shows a trade to a human player and resolves with their answer. */
  private askTrade(offer: TradeOffer, title: string): Promise<boolean> {
    return new Promise((resolve) => {
      const from = this.game.player(offer.from);
      const to = this.game.player(offer.to);
      const m = openModal({ title: tr('🤝 Trade offer'), cls: 'trade-modal', dismissable: false, peek: tr('trade offer'), who: this.game.player(offer.to) });
      play('card');
      m.body.innerHTML = `<p class="center">${title}</p>
        <div class="trade-review">${this.sideHtml(offer.give, from)}<div class="swap">⇄</div>${this.sideHtml(offer.get, to)}</div>
        <p class="muted center small">${escapeHtml(to.name)}, do you accept?</p>`;
      const row = el('div', 'modal-actions');
      row.appendChild(
        button(tr('✅ Accept'), 'primary', () => {
          m.close();
          resolve(true);
        }),
      );
      row.appendChild(
        button(tr('❌ Decline'), 'ghost', () => {
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
    const m = openModal({ title: tr('🤝 Trade'), cls: 'trade-modal', peek: tr('trade'), who: this.game.player(pid) });

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
      if (!tradable.length) chips.innerHTML = `<span class="muted small">${tr('No tradable properties')}</span>`;
      col.appendChild(chips);
      const cash = el('label', 'tcash');
      cash.innerHTML = `💵 ${tr('Cash')} <input type="range" min="0" max="${owner.cash}" step="10" value="${side.cash}"/><input type="number" min="0" max="${owner.cash}" value="${side.cash}"/>`;
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
        const jc = el('label', 'tcash', `🎫 ${tr('Get-out cards')} <input type="number" min="0" max="${owner.jailCards.length}" value="${side.jailCards}"/>`);
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
      const target = this.game.player(partner);
      if (!err && target.ai) {
        const name = `<b>${escapeHtml(target.name)}</b>`;
        const view = {
          yes: ['good', '✅', tr('{name} would accept this.', { name })],
          close: ['warn', '🤔', tr('Close. {name} wants a little more.', { name })],
          no: ['bad', '❌', tr('{name} would turn this down.', { name })],
          cash: ['bad', '💸', tr("{name} can't spare that much cash.", { name })],
          nothing: ['', '', ''],
        }[tradeOutlook(this.game, offer)];
        footer.appendChild(el('div', `trade-outlook ${view[0]}`, `${view[1]} ${view[2]}`));
      } else footer.appendChild(el('div', 'trade-msg muted small', err ? escapeHtml(trText(localize(err))) : tr('Ready to send')));
      footer.appendChild(button(tr('Propose trade'), 'primary', () => void propose(offer), !!err || this.busy || !this.game.canTradeNow(pid)));
    };

    const propose = async (offer: TradeOffer) => {
      const target = this.game.player(offer.to);
      let ok: boolean;
      if (target.ai) {
        footer.innerHTML = `<div class="thinking"><span class="dot-pulse" style="--pc:${target.color}"></span> ${tr('{name} is considering…', { name: escapeHtml(target.name) })}</div>`;
        await sleep(700);
        ok = acceptsTrade(this.game, offer);
        if (!ok) {
          play('error');
          footer.innerHTML = '';
          footer.appendChild(el('div', 'trade-msg bad-text', tr('{name} declined. Try sweetening the deal.', { name: escapeHtml(target.name) })));
          footer.appendChild(button(tr('Propose again'), 'primary', () => void propose({ from: pid, to: partner, give, get })));
          m.body.querySelector('.modal')?.classList.add('shake');
          return;
        }
      } else {
        m.close();
        ok = await this.askTrade(offer, tr('{me} proposes a trade. Pass the device to {target}.', { me: escapeHtml(me.name), target: `<b>${escapeHtml(target.name)}</b>` }));
        if (!ok) {
          toast(tr('{name} declined the trade', { name: escapeHtml(target.name) }));
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
      grid.appendChild(column(me, give, tr('You give')));
      grid.appendChild(el('div', 'swap', '⇄'));
      grid.appendChild(column(this.game.player(partner), get, tr('You get from {name}', { name: escapeHtml(this.game.player(partner).name) })));
      m.body.appendChild(grid);
      m.body.appendChild(footer);
      refreshFooter();
    };
    draw();
  }

  // ------------------------------------------------------------------ menus

  private openMenu() {
    const m = openModal({ title: tr('Menu'), cls: 'menu-modal' });
    const list = el('div', 'menu-list');
    list.appendChild(button(tr('▶ Resume'), 'primary', () => m.close()));
    list.appendChild(
      button(tr('📖 How to play'), 'ghost', () => {
        m.close();
        openModal({ title: tr('How to play'), html: rulesHtml(), cls: 'rules-modal' });
      }),
    );

    const settings = el('div', 'menu-settings');
    settings.innerHTML = `
      <div class="section-title">${tr('Settings')}</div>
      <label class="switch"><input type="checkbox" data-set="sound" ${isMuted() ? '' : 'checked'}/><span></span>${tr('🔊 Sound effects')}</label>
      <div class="set-row"><span>${tr('🎬 Animation speed')}</span><div class="seg small speed-seg">${(['normal', 'fast', 'turbo'] as Speed[])
        .map((v) => `<button class="${v === this.speed ? 'on' : ''}" data-speed="${v}">${tr(v[0].toUpperCase() + v.slice(1))}</button>`)
        .join('')}</div></div>
      <label class="switch"><input type="checkbox" data-set="aifast" ${this.aiFast ? 'checked' : ''}/><span></span>${tr("⏩ Speed up computer players' turns")}</label>
      <label class="switch"><input type="checkbox" data-set="reach" ${this.reach ? 'checked' : ''}/><span></span>${tr('🎯 Show where I can land')}</label>
      <label class="switch"><input type="checkbox" data-set="tilt" ${this.tilt ? 'checked' : ''}/><span></span>${tr('🧊 Tilted 3D board')}</label>`;
    settings.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) =>
      b.addEventListener('click', () => {
        this.speed = b.dataset.speed as Speed;
        setPref('st-speed', this.speed);
        settings.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b));
        play('click');
      }),
    );
    settings.querySelectorAll<HTMLInputElement>('[data-set]').forEach((inp) =>
      inp.addEventListener('change', () => {
        const on = inp.checked;
        if (inp.dataset.set === 'sound') {
          if (on === isMuted()) this.toggleSound();
        } else if (inp.dataset.set === 'aifast') {
          this.aiFast = on;
          setPref('st-aifast', on ? '1' : '0');
        } else if (inp.dataset.set === 'reach') {
          this.reach = on;
          setPref('st-reach', on ? '1' : '0');
          this.render();
        } else {
          this.tilt = on;
          setPref('st-tilt', on ? '1' : '0');
          this.root.classList.toggle('tilted', on);
        }
        play('click');
      }),
    );
    list.appendChild(settings);

    list.appendChild(
      button(tr('🏁 End game now (richest wins)'), 'ghost', () => {
        m.close();
        void this.confirm(tr('End the game now? The player with the highest net worth wins.'), tr('End game')).then((ok) => {
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
      button(tr('🏠 Main menu'), 'ghost', () => {
        m.close();
        this.exit();
      }),
    );
    list.appendChild(el('p', 'muted small center', tr('Your game is saved automatically.')));
    m.body.appendChild(list);
  }

  /**
   * Final standings, each with a small net-worth line over the rounds. Every line shares one
   * scale so they compare directly; one line per row means players never have to be told
   * apart by colour alone.
   */
  private standingsHtml(ranked: Player[]): string {
    const worth = this.game.stats.worth;
    const max = Math.max(1, ...worth.flat());
    const W = 120;
    const H = 32;
    const spark = (pid: number) => {
      const pts = worth.map((row, r) => [worth.length > 1 ? (r / (worth.length - 1)) * W : W / 2, H - 3 - (row[pid] / max) * (H - 6)] as const);
      if (!pts.length) return '';
      const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
      const [ex, ey] = pts[pts.length - 1];
      const step = W / Math.max(1, worth.length - 1);
      const hits = worth
        .map((row, r) => `<rect x="${Math.max(0, pts[r][0] - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H}" fill="transparent"><title>${r === 0 ? tr('Start') : r === worth.length - 1 ? tr('End') : tr('Round {n}', { n: r + 1 })}: ${money(row[pid])}</title></rect>`)
        .join('');
      return `<svg class="spark" viewBox="-5 0 ${W + 10} ${H}" role="img" aria-label="${tr('Net worth over the game')}">
        <line x1="0" x2="${W}" y1="${H - 3}" y2="${H - 3}" class="spark-base"/>
        <path d="${line}" class="spark-line"/>
        <circle cx="${ex}" cy="${ey}" r="4" class="spark-dot"/>${hits}</svg>`;
    };
    return `<ol class="standings">${ranked
      .map(
        (p) => `<li style="--pc:${p.color}" class="${p.bankrupt ? 'out' : ''}">
          <span class="st-name">${p.token} ${escapeHtml(p.name)}</span>${spark(p.id)}
          <b>${p.bankrupt ? tr('Bankrupt') : money(this.game.netWorth(p.id))}</b></li>`,
      )
      .join('')}</ol>
      <p class="muted small center spark-note">${tr("Lines show each player's net worth across the game, on the same scale.")}</p>`;
  }

  /** Daily challenge result: your score, your first and best today, and your streak. */
  private dailyHtml(): string {
    const key = this.s.settings.daily;
    const you = this.s.players.find((p) => !p.ai);
    if (!key || !you) return '';
    const score = you.bankrupt ? 0 : this.game.netWorth(you.id);
    const r = recordDaily(key, score);
    const streak = dailyStreak(key);
    return `<div class="daily-result">
      <div class="daily-head"><b>📅 ${tr('Daily challenge')} #${dailyNumber(key)}</b><small>${key}</small></div>
      <div class="daily-score">${money(score)}</div>
      <div class="daily-meta">
        <span>${r.isFirst ? tr('Your official score for today') : tr('Practice game · your score today: {first}', { first: money(r.first) })}</span>
        <span>${r.isBest && !r.isFirst ? '⭐ ' : ''}${tr('Best today: {best}', { best: money(r.best) })}</span>
        ${streak ? `<span>🔥 ${tr('{n}-day streak', { n: streak })}</span>` : ''}
      </div>
    </div>`;
  }

  /** Fun facts for the end screen. */
  private statsHtml(): string {
    const st = this.game.stats;
    const ps = this.s.players;
    const who = (id: number) => `${ps[id].token} ${escapeHtml(ps[id].name)}`;
    const top = (arr: number[]) => arr.reduce((b, v, i) => (v > arr[b] ? i : b), 0);
    const facts: [string, string, string][] = [];
    const rk = top(st.rentGot);
    if (st.rentGot[rk] > 0) facts.push(['💰', tr('Most rent collected'), tr('{name} collected {amount}', { name: who(rk), amount: money(st.rentGot[rk]) })]);
    const best = Object.entries(st.tileRent).sort((a, b) => b[1] - a[1])[0];
    if (best) facts.push(['🏙️', tr('Best property'), tr('{tile} earned {amount}', { tile: `${TILES[+best[0]].icon} ${escapeHtml(TILES[+best[0]].name)}`, amount: money(best[1]) })]);
    if (st.biggest) facts.push(['💥', tr('Biggest hit'), tr('{name} paid {amount} at {tile}', { name: who(st.biggest.from), amount: money(st.biggest.amount), tile: escapeHtml(TILES[st.biggest.tile].name) })]);
    const jb = top(st.jail);
    if (st.jail[jb] > 0) facts.push(['🔒', tr('Jailbird'), st.jail[jb] === 1 ? tr('{name}, 1 time', { name: who(jb) }) : tr('{name}, {n} times', { name: who(jb), n: st.jail[jb] })]);
    if (!facts.length) return '';
    return `<div class="facts">${facts.map(([i, t, d]) => `<div class="fact"><div class="fact-i">${i}</div><div><div class="fact-t">${t}</div><div class="fact-d">${d}</div></div></div>`).join('')}</div>`;
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
      <div class="winner" style="--pc:${w.color}">${
        s.winnerTeam !== undefined && s.winnerTeam !== null
          ? `${tr('Team {t} wins!', { t: 'AB'[s.winnerTeam] })}<small>${s.players.filter((p) => p.team === s.winnerTeam).map((p) => `${p.token} ${escapeHtml(p.name)}`).join(' · ')}</small>`
          : tr('{name} wins!', { name: `${w.token} ${escapeHtml(w.name)}` })
      }</div>
      ${s.settings.goal ? `<p class="muted center">🏁 ${escapeHtml(this.goalLabel())}</p>` : ''}
      <p class="muted center">${s.round === 1 ? tr('Finished in 1 round') : tr('Finished in {n} rounds', { n: s.round })}</p>
      ${this.dailyHtml()}
      ${this.standingsHtml(ranked)}
      ${this.statsHtml()}`;
    const row = el('div', 'modal-actions');
    row.appendChild(
      button(tr('🔁 Play again'), 'primary', () => {
        m.close();
        this.exit(true);
      }),
    );
    row.appendChild(
      button(tr('🏠 Main menu'), 'ghost', () => {
        m.close();
        this.exit();
      }),
    );
    row.appendChild(button(tr('👀 View board'), 'ghost', () => m.close()));
    m.body.appendChild(row);
  }
}
