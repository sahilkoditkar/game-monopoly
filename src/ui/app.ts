import { acceptsTrade, apply, decide, fallback, newMemory, type AiMemory } from '../game/ai';
import { GROUPS, JAIL_FINE, TILES, houseCost, mortgageValue, unmortgageCost } from '../game/board';
import { CARD_BY_ID } from '../game/cards';
import { Game } from '../game/engine';
import type { GameEvent, GameState, Player, TradeOffer, TradeSide } from '../game/types';
import { DicePair } from './dice';
import { confetti, countTo, el, escapeHtml, money, sleep, toast } from './fx';
import { button, openModal, type ModalHandle } from './modal';
import { pieceIcon, pieceKind } from './pieces';
import type { GameScene, HandoffMode, SceneView } from './scene';
import { RULES_HTML } from './setup';
import { isMuted, play, setMuted } from './sound';
import { StreetScene } from './street';

type Speed = 'normal' | 'fast' | 'turbo';
const SPEEDS: Record<Speed, { scene: number; ai: number; roll: number; card: number; step: number }> = {
  normal: { scene: 1, ai: 650, roll: 900, card: 2200, step: 210 },
  fast: { scene: 0.55, ai: 300, roll: 600, card: 1300, step: 130 },
  turbo: { scene: 0.25, ai: 70, roll: 300, card: 500, step: 60 },
};
const P2D6: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const SAVE_KEY = 'st-save';
const PREFS_KEY = 'st-prefs';

export type ViewMode = 'street' | 'board3d';

/** Everything the player can switch on or off. Defaults keep the screen simple. */
interface Prefs {
  view: ViewMode;
  handoff: HandoffMode;
  speed: Speed;
  nextUp: boolean;
  markers: boolean;
  minimap: boolean;
  ticker: boolean;
}
const DEFAULT_PREFS: Prefs = { view: 'street', handoff: 'zoom', speed: 'normal', nextUp: true, markers: true, minimap: true, ticker: true };

function loadPrefs(): Prefs {
  try {
    const p = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
    const legacy = localStorage.getItem('st-speed');
    if (legacy && !localStorage.getItem(PREFS_KEY)) p.speed = legacy as Speed;
    return p;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

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

const icon = (p: Player, size = 26) => pieceIcon(pieceKind(p.token), p.color, size);
const groupColor = (i: number) => (TILES[i].group ? GROUPS[TILES[i].group!].color : TILES[i].kind === 'transit' ? '#64748b' : '#0e7490');

export class GameApp {
  private root = el('div', 'shell');
  private sceneHost = el('div', 'scene');
  private minimap = el('div', 'minimap');
  private chipsEl = el('div', 'chips');
  private roundEl = el('span', 'round');
  private promptEl = el('div', 'prompt');
  private actionsEl = el('div', 'actions');
  private toolsEl = el('div', 'dock-tools');
  private nextEl = el('div', 'next');
  private tickerEl = el('button', 'ticker');
  private logEl = el('div', 'log');
  private rulesDrawer = this.drawer('Rules', RULES_HTML);
  private settingsDrawer = this.drawer('Settings', '');
  private logDrawer = this.drawer('Game log', '');
  private dice = new DicePair();
  private scene!: GameScene;
  private view: SceneView;
  private prefs = loadPrefs();
  private busy = false;
  private looping = false;
  private destroyed = false;
  private displayCash: number[] = [];
  private auctionModal: { key: string; handle: ModalHandle; update: () => void } | null = null;
  private live = new Set<() => void>();
  private onResize = () => this.scene?.resize();
  private onKey = (e: KeyboardEvent) => this.handleKey(e);

  constructor(
    private host: HTMLElement,
    private game: Game,
    private mem: AiMemory[],
    private exit: (again?: boolean) => void,
  ) {
    if (this.mem.length !== game.state.players.length) this.mem = game.state.players.map(() => newMemory());
    this.view = {
      state: game.state,
      disp: game.state.players.map((p) => p.pos),
      follow: game.state.current,
      selected: game.state.players[game.state.current].pos,
      moving: null,
      showRange: true,
      rentOf: (i) => game.rentFor(i, 7),
      onSelect: (i) => this.openPlace(i),
    };
    this.displayCash = game.state.players.map((p) => p.cash);
    this.build();
    for (const line of game.state.log.slice(-60)) this.appendLog(line);
    const opening = game.drain().filter((e) => e.type !== 'log' && e.type !== 'turn');
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    document.addEventListener('keydown', this.onKey);
    requestAnimationFrame(() => {
      void this.mountScene().then(() => {
        this.render();
        void this.playAll(opening).then(() => {
          this.render();
          void this.loop();
        });
      });
    });
  }

  private get s() {
    return this.game.state;
  }

  private get t() {
    return SPEEDS[this.prefs.speed];
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener('resize', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKey);
    this.scene?.destroy();
    this.auctionModal?.handle.close();
    document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
    [this.rulesDrawer, this.settingsDrawer, this.logDrawer].forEach((d) => d.remove());
    this.root.remove();
  }

  /** Creates the view picked in settings (the 3D board is loaded only when chosen). */
  private async mountScene() {
    this.scene?.destroy();
    let scene: GameScene;
    if (this.prefs.view === 'board3d') {
      try {
        const { Board3D } = await import('./board3d');
        scene = new Board3D(this.sceneHost, this.view);
      } catch {
        toast('The 3D board could not load here, so the street is shown instead.', 'bad');
        this.prefs.view = 'street';
        savePrefs(this.prefs);
        scene = new StreetScene(this.sceneHost, this.view);
      }
    } else scene = new StreetScene(this.sceneHost, this.view);
    scene.speed = this.t.scene;
    this.scene = scene;
    this.sceneHost.classList.toggle('is-3d', this.prefs.view === 'board3d');
    scene.start();
  }

  // ------------------------------------------------------------------ layout

  private drawer(title: string, html: string) {
    const d = el('div', 'drawer');
    d.setAttribute('aria-hidden', 'true');
    d.innerHTML = `<div class="drawer-panel" role="dialog" aria-label="${title}"><h2>${title} <button class="btn tbtn icon" aria-label="Close">✕</button></h2><div class="drawer-body">${html}</div></div>`;
    d.querySelector('h2 button')!.addEventListener('click', () => this.toggleDrawer(d, false));
    d.addEventListener('click', (e) => {
      if (e.target === d) this.toggleDrawer(d, false);
    });
    document.body.appendChild(d);
    return d;
  }

  private toggleDrawer(d: HTMLElement, open: boolean) {
    if (open) [this.rulesDrawer, this.settingsDrawer, this.logDrawer].forEach((x) => x !== d && this.toggleDrawer(x, false));
    d.classList.toggle('open', open);
    d.setAttribute('aria-hidden', String(!open));
  }

  private build() {
    const top = el('header', 'topbar');
    const rules = button('📖', 'tbtn icon', () => this.toggleDrawer(this.rulesDrawer, true));
    rules.setAttribute('aria-label', 'Rules');
    rules.title = 'Rules';
    const settings = button('⚙️', 'tbtn icon', () => this.openSettings());
    settings.setAttribute('aria-label', 'Settings');
    settings.title = 'Settings';
    top.append(this.chipsEl, this.roundEl, rules, settings);

    this.sceneHost.appendChild(this.minimap);
    const dock = el('div', 'dock');
    dock.append(this.dice.root, this.promptEl, this.actionsEl, this.toolsEl);
    this.tickerEl.addEventListener('click', () => this.toggleDrawer(this.logDrawer, true));
    this.logDrawer.querySelector('.drawer-body')!.appendChild(this.logEl);
    this.root.append(top, this.sceneHost, dock, this.tickerEl, this.nextEl);
    this.host.innerHTML = '';
    this.host.appendChild(this.root);
    this.dice.show(this.s.dice);
    this.applyPrefs();
  }

  private applyPrefs() {
    this.minimap.hidden = !this.prefs.minimap;
    this.nextEl.hidden = !this.prefs.nextUp;
    this.tickerEl.hidden = !this.prefs.ticker;
    if (this.scene) this.scene.speed = this.t.scene;
  }

  private openSettings() {
    const body = this.settingsDrawer.querySelector('.drawer-body')!;
    const seg = <T extends string>(key: keyof Prefs, label: string, opts: [T, string][], note = '') => `
      <div class="set-row"><div class="set-label">${label}${note ? `<small>${note}</small>` : ''}</div>
      <div class="seg">${opts.map(([v, l]) => `<button data-key="${key}" data-val="${v}" class="${this.prefs[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
    const toggle = (key: keyof Prefs, label: string, note: string) => `
      <label class="set-row switch"><input type="checkbox" data-toggle="${key}" ${this.prefs[key] ? 'checked' : ''}/><span></span><div class="set-label">${label}<small>${note}</small></div></label>`;
    body.innerHTML = `
      <h4>Look</h4>
      ${seg<ViewMode>('view', 'View', [['street', '🚗 Street'], ['board3d', '🎲 3D board']])}
      ${seg<HandoffMode>('handoff', 'Turn change', [['zoom', 'Zoom + card'], ['card', 'Card'], ['instant', 'Instant']])}
      ${seg<Speed>('speed', 'Speed', [['normal', 'Normal'], ['fast', 'Fast'], ['turbo', 'Turbo']])}
      <h4>Helpers</h4>
      ${toggle('nextUp', 'Next up strip', 'The next 12 spaces and what happens there')}
      ${toggle('markers', 'Landing marks', 'Gold marks where you can land')}
      ${toggle('minimap', 'Mini-map', 'All 40 spaces at a glance')}
      ${toggle('ticker', 'Latest event', 'One line about what just happened')}
      <h4>Sound</h4>
      <label class="set-row switch"><input type="checkbox" data-sound ${isMuted() ? '' : 'checked'}/><span></span><div class="set-label">Sound effects</div></label>
      <h4>Game</h4>
      <div class="set-actions"></div>
      <p class="muted small">Your game saves automatically.</p>`;
    body.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((b) =>
      b.addEventListener('click', () => {
        const key = b.dataset.key as keyof Prefs;
        (this.prefs as unknown as Record<string, string>)[key] = b.dataset.val!;
        savePrefs(this.prefs);
        play('click');
        if (key === 'view') void this.mountScene().then(() => this.render());
        this.applyPrefs();
        this.openSettings();
      }),
    );
    body.querySelectorAll<HTMLInputElement>('[data-toggle]').forEach((inp) =>
      inp.addEventListener('change', () => {
        (this.prefs as unknown as Record<string, boolean>)[inp.dataset.toggle!] = inp.checked;
        savePrefs(this.prefs);
        this.applyPrefs();
        this.render();
      }),
    );
    body.querySelector<HTMLInputElement>('[data-sound]')!.addEventListener('change', (e) => {
      setMuted(!(e.target as HTMLInputElement).checked);
      play('click');
    });
    body.querySelector('.set-actions')!.append(
      button('🏁 End game (richest wins)', 'ghost', () => {
        this.toggleDrawer(this.settingsDrawer, false);
        void this.confirm('End the game now? The player with the highest net worth wins.', 'End game').then((ok) => {
          if (!ok) return;
          this.game.forfeitToWorth();
          void this.flush().then(() => {
            this.render();
            this.save();
          });
        });
      }),
      button('🏠 Main menu', 'ghost', () => {
        this.toggleDrawer(this.settingsDrawer, false);
        this.exit();
      }),
    );
    this.toggleDrawer(this.settingsDrawer, true);
  }

  // ------------------------------------------------------------------ rendering

  private render() {
    if (this.destroyed) return;
    this.view.state = this.s;
    this.view.showRange = this.prefs.markers && this.s.phase === 'roll' && !this.busy;
    this.renderChips();
    this.renderControls();
    this.renderNext();
    this.renderMinimap();
    this.syncAuction();
    for (const fn of this.live) fn();
  }

  private renderChips() {
    const s = this.s;
    this.roundEl.textContent = s.settings.roundLimit ? `Round ${Math.min(s.round, s.settings.roundLimit)}/${s.settings.roundLimit}` : `Round ${s.round}`;
    this.roundEl.title = `Round ${s.round}`;
    this.chipsEl.innerHTML = s.players
      .map((p) => {
        const on = p.id === s.current && s.phase !== 'gameover';
        const marks = `${p.inJail ? '<i title="In Lockup">🔒</i>' : ''}${p.jailCards.length ? '<i title="Get-out card">🎫</i>' : ''}`;
        return `<button class="chip ${on ? 'on' : ''} ${p.bankrupt ? 'out' : ''}" data-pid="${p.id}" style="--pc:${p.color}" title="${escapeHtml(p.name)}${p.ai ? ' (AI)' : ''}">
          <span class="av">${icon(p, 24)}</span>
          <span class="nm">${escapeHtml(p.name)}${marks}</span>
          <span class="cash" data-cash="${p.id}">${p.bankrupt ? 'Out' : money(this.displayCash[p.id] ?? p.cash)}</span>
        </button>`;
      })
      .join('');
    this.chipsEl.querySelectorAll<HTMLElement>('.chip').forEach((c) => c.addEventListener('click', () => this.openPortfolio(Number(c.dataset.pid))));
  }

  private renderMinimap() {
    if (this.minimap.hidden) return;
    const s = this.s;
    this.minimap.innerHTML =
      TILES.map((t) => {
        const o = s.props[t.index];
        const style = `${t.group ? `--g:${GROUPS[t.group].color};` : ''}${o ? `--oc:${s.players[o.owner].color}` : ''}`;
        return `<i data-i="${t.index}" class="${o ? 'own' : ''}" style="${style}" title="${escapeHtml(t.name)}"></i>`;
      }).join('') +
      s.players.filter((p) => !p.bankrupt).map((p) => `<span class="mm-p ${p.id === s.current ? 'cur' : ''}" style="--pc:${p.color};left:${((p.pos + 0.5) / 40) * 100}%"></span>`).join('');
    this.minimap.querySelectorAll<HTMLElement>('i').forEach((c) =>
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openPlace(Number(c.dataset.i));
      }),
    );
  }

  /** What landing on `i` would mean for player `pid`, in a couple of words. */
  private describe(i: number, pid: number): { text: string; cls: string } {
    const t = TILES[i], o = this.s.props[i];
    if (t.price) {
      if (!o) return { text: money(t.price), cls: 'buy' };
      if (o.owner === pid) return { text: 'Yours', cls: 'mine' };
      if (o.mortgaged) return { text: 'Free', cls: '' };
      return { text: `−${money(this.game.rentFor(i, 7))}`, cls: 'bad' };
    }
    switch (t.kind) {
      case 'tax':
        return { text: `−${money(t.tax!)}`, cls: 'bad' };
      case 'gotojail':
        return { text: 'Jail', cls: 'bad' };
      case 'fortune':
      case 'treasury':
        return { text: 'Card', cls: '' };
      case 'start':
        return { text: `+${money(this.s.settings.salary)}`, cls: 'buy' };
      case 'lounge':
        return this.s.settings.jackpot && this.s.jackpot ? { text: `+${money(this.s.jackpot)}`, cls: 'buy' } : { text: 'Safe', cls: '' };
      default:
        return { text: 'Safe', cls: '' };
    }
  }

  /** Compact strip of the next 12 spaces; brighter = more likely to land there. */
  private renderNext() {
    if (this.nextEl.hidden) return;
    const s = this.s, p = this.game.cur;
    let html = `<div class="next-head"><span>Next up</span><small>${p.inJail ? `${escapeHtml(p.name)} is in Lockup` : 'tap a space for details'}</small><span class="legend"><i class="buy"></i>buy <i class="bad"></i>pay <i class="mine"></i>yours</span></div><div class="next-row">`;
    for (let d = 1; d <= 12; d++) {
      const i = (p.pos + d) % 40, t = TILES[i], o = s.props[i], ds = this.describe(i, p.id), pr = P2D6[d] ?? 0;
      html += `<button class="nx ${ds.cls}" data-i="${i}" style="--g:${groupColor(i)};--odds:${0.35 + (pr / 6) * 0.65}" title="${escapeHtml(t.name)} · ${pr ? Math.round((pr / 36) * 100) + '% chance' : 'can’t land'}">
        ${o ? `<span class="own" style="--oc:${s.players[o.owner].color}"></span>` : ''}<span class="ic">${t.icon}</span><span class="v">${ds.text}</span><span class="d">${d}</span></button>`;
    }
    this.nextEl.innerHTML = html + '</div>';
    this.nextEl.querySelectorAll<HTMLElement>('.nx').forEach((b) => b.addEventListener('click', () => this.openPlace(Number(b.dataset.i))));
  }

  /** Details for one space, opened on tap. Owners can build or mortgage from here. */
  private openPlace(i: number) {
    this.view.selected = i;
    play('click');
    const m = openModal({ title: '', cls: 'place-modal' });
    const update = () => {
      const t = TILES[i], o = this.s.props[i], s = this.s;
      const kind = t.group ? GROUPS[t.group].name : ({ start: 'Corner', jail: 'Corner', lounge: 'Corner', gotojail: 'Corner', tax: 'Tax', fortune: 'Card', treasury: 'Card', transit: 'Skyport', utility: 'Utility' } as Record<string, string>)[t.kind];
      let status = '';
      if (o) {
        const p = s.players[o.owner];
        status = `<div class="place-status" style="--pc:${p.color}">${icon(p, 22)}<span><b>${escapeHtml(p.name)}</b> owns it${o.houses ? ` · ${o.houses === 5 ? 'Landmark' : 'Level ' + o.houses}` : ''}</span><b class="place-rent">${o.mortgaged ? 'No rent (mortgaged)' : `Rent ${t.kind === 'utility' ? '~' : ''}${money(this.game.rentFor(i, 7))}`}</b></div>`;
      } else if (t.price) status = `<div class="place-status free"><span>For sale</span><b class="place-rent">${money(t.price)}</b></div>`;
      const desc: Record<string, string> = {
        start: `Collect ${money(s.settings.salary)} every time you pass.`,
        jail: `Just visiting, unless you were sent here. Leave by paying ${money(JAIL_FINE)}, using a card, or rolling doubles.`,
        lounge: s.settings.jackpot ? `Land here to win the jackpot: <b>${money(s.jackpot)}</b>.` : 'A free rest stop.',
        gotojail: 'Go straight to Lockup.',
        tax: `Pay ${money(t.tax ?? 0)}.`,
        fortune: 'Draw a Fortune card.',
        treasury: 'Draw a Treasury card.',
        utility: 'Rent is 4× the dice, or 10× if the owner has both utilities.',
        transit: 'Rent $25, doubling with each Skyport the owner has.',
      };
      let details = '';
      if (t.kind === 'property') {
        const r = t.rents!;
        const cur = o ? (o.houses ? o.houses + 1 : this.game.hasFullSet(o.owner, t.group!) ? 1 : 0) : -1;
        const rows: [string, number][] = [['Rent', r[0]], ['Full set', r[0] * 2], ['Level 1', r[1]], ['Level 2', r[2]], ['Level 3', r[3]], ['Level 4', r[4]], ['Landmark', r[5]]];
        details = `<details class="place-more"><summary>Rent at each level</summary><table class="rent">${rows.map(([l, v], k) => `<tr class="${k === cur ? 'cur' : ''}"><td>${l}</td><td>${money(v)}</td></tr>`).join('')}<tr class="sep"><td>Each build</td><td>${money(houseCost(i))}</td></tr><tr><td>Mortgage value</td><td>${money(mortgageValue(i))}</td></tr></table></details>`;
      } else if (desc[t.kind]) details = `<p class="muted">${desc[t.kind]}</p>`;
      m.body.innerHTML = `<div class="place-head" style="--g:${groupColor(i)}"><span class="place-ic">${t.icon}</span><div><div class="place-title">${escapeHtml(t.name)}</div><div class="muted small">${kind}</div></div></div>${status}${details}`;
      const human = this.humanActor();
      if (o && human && o.owner === human.id && this.game.canManage(human.id)) {
        const pid = human.id, row = el('div', 'modal-actions');
        if (t.kind === 'property') row.append(button(`Build ${money(houseCost(i))}`, 'good', () => this.act(() => this.game.build(pid, i)), this.busy || !this.game.canBuild(pid, i)), button('Sell', 'ghost', () => this.act(() => this.game.sell(pid, i)), this.busy || !this.game.canSell(pid, i)));
        row.append(o.mortgaged ? button(`Pay off ${money(unmortgageCost(i))}`, 'gold', () => this.act(() => this.game.unmortgage(pid, i)), this.busy || !this.game.canUnmortgage(pid, i)) : button('Mortgage', 'ghost', () => this.act(() => this.game.mortgage(pid, i)), this.busy || !this.game.canMortgage(pid, i)));
        m.body.appendChild(row);
        const why = t.kind === 'property' && o.houses < 5 ? this.game.buildBlocker(pid, i) : null;
        if (why) m.body.appendChild(el('p', 'build-hint', `🔒 ${escapeHtml(why)}`));
      }
    };
    update();
    this.registerLive(m, update);
  }

  private humanActor(): Player | null {
    if (this.s.phase === 'gameover') return null;
    const p = this.game.player(this.game.actor());
    return p.ai ? null : p;
  }

  private setActions(...btns: HTMLElement[]) {
    this.actionsEl.innerHTML = '';
    this.actionsEl.append(...btns);
  }

  private setTools(pid: number | null) {
    this.toolsEl.innerHTML = '';
    if (pid === null) return;
    const manage = button('🏗️', 'tbtn icon', () => this.openManage(pid));
    manage.title = 'Build & mortgage';
    manage.setAttribute('aria-label', 'Build and mortgage');
    const trade = button('🤝', 'tbtn icon', () => this.openTrade(pid));
    trade.title = 'Trade';
    trade.setAttribute('aria-label', 'Trade');
    this.toolsEl.append(manage, trade);
  }

  /** One short instruction and the buttons for it. */
  private say(title: string, sub = '') {
    this.promptEl.innerHTML = `<b>${title}</b>${sub ? `<small>${sub}</small>` : ''}`;
  }

  private renderControls() {
    const s = this.s, cur = this.game.cur;
    this.setTools(null);
    if (s.phase === 'gameover') {
      const w = s.winner !== null ? this.game.player(s.winner) : null;
      this.say(w ? `🏆 ${escapeHtml(w.name)} wins!` : 'Game over');
      this.setActions(button('New game', 'primary', () => this.exit()));
      return;
    }
    const actor = this.game.player(this.game.actor());
    if (actor.ai || this.busy) {
      this.promptEl.innerHTML = actor.ai ? `<span class="dot-pulse" style="--pc:${actor.color}"></span> <b>${escapeHtml(actor.name)}</b> is playing…` : '';
      this.setActions();
      return;
    }
    const you = this.s.players.filter((p) => !p.ai).length > 1 ? escapeHtml(actor.name) + ', ' : '';
    switch (s.phase) {
      case 'roll':
        if (cur.inJail) {
          this.say(`🔒 ${you}you're in Lockup`, `Roll doubles to get out (try ${cur.jailTurns + 1} of 3), or pay ${money(JAIL_FINE)}.`);
          const btns = [button('🎲 Roll', 'primary', () => this.act(() => this.game.roll())), button(`Pay ${money(JAIL_FINE)}`, 'gold', () => this.act(() => this.game.payJailFine()), cur.cash < JAIL_FINE)];
          if (cur.jailCards.length) btns.push(button('🎫 Use card', 'gold', () => this.act(() => this.game.useJailCard())));
          this.setActions(...btns);
        } else {
          this.say(s.doublesCount ? `🎉 Doubles! ${you}roll again` : `${you}your turn`);
          this.setActions(button(s.doublesCount ? '🎲 Roll again' : '🎲 Roll', 'primary pulse', () => this.act(() => this.game.roll())));
        }
        this.setTools(actor.id);
        break;
      case 'end':
        this.say(`${you}done?`, 'Build or trade first if you like.');
        this.setActions(button('End turn ➜', 'primary', () => this.act(() => this.game.endTurn())));
        this.setTools(actor.id);
        break;
      case 'buy': {
        const t = TILES[cur.pos], short = cur.cash < t.price!;
        const rent = t.kind === 'property' ? `Rent ${money(t.rents![0])}` : t.kind === 'transit' ? 'Rent from $25' : 'Rent 4× dice';
        this.say(`Buy ${t.icon} ${escapeHtml(t.name)}?`, short ? `You need ${money(t.price! - cur.cash)} more. Mortgage something or let it go.` : `${rent} · you'd keep ${money(cur.cash - t.price!)}`);
        const btns = [button(`Buy ${money(t.price!)}`, 'primary', () => this.act(() => this.game.buy()), short), button(s.settings.auctions ? 'Auction' : 'Skip', 'ghost', () => this.act(() => this.game.decline()))];
        const info = button('ⓘ', 'tbtn icon', () => this.openPlace(cur.pos));
        info.setAttribute('aria-label', 'Details');
        this.setActions(...btns, info);
        if (short) this.setTools(actor.id);
        break;
      }
      case 'auction':
        this.say('🔨 Auction');
        this.setActions();
        break;
      case 'debt': {
        const d = s.debts[0];
        this.say(`⚠️ ${you}you owe ${money(d.amount)}`, `You have ${money(actor.cash)}. Sell buildings or mortgage to pay.`);
        this.setActions(
          button('Raise cash', 'primary', () => this.openManage(actor.id)),
          button('Give up', 'danger', () => {
            void this.confirm(`Declare bankruptcy? ${escapeHtml(actor.name)} is out of the game.`, 'Go bankrupt').then((ok) => {
              if (ok) void this.act(() => this.game.declareBankruptcy());
            });
          }),
        );
        break;
      }
    }
  }

  private appendLog(text: string) {
    const line = el('div', 'log-line', escapeHtml(text));
    this.logEl.prepend(line);
    while (this.logEl.childElementCount > 120) this.logEl.lastElementChild!.remove();
    this.tickerEl.innerHTML = `<span>${escapeHtml(text)}</span><small>Log</small>`;
  }

  private syncCash() {
    this.s.players.forEach((p) => {
      const from = this.displayCash[p.id];
      if (from !== p.cash) {
        const node = this.chipsEl.querySelector<HTMLElement>(`[data-cash="${p.id}"]`);
        if (node && !p.bankrupt) countTo(node, from, p.cash, 500);
        this.displayCash[p.id] = p.cash;
      }
    });
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
        if (!this.game.player(pid).ai) break;
        this.busy = true;
        this.renderControls();
        await sleep(this.t.ai);
        if (this.destroyed) return;
        const action = decide(this.game, pid, this.mem[pid]);
        let ok: boolean;
        if (action.type === 'trade') ok = await this.aiTrade(action.offer);
        else {
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
    const to = this.game.player(offer.to), from = this.game.player(offer.from);
    const accepted = to.ai ? acceptsTrade(this.game, offer) : await this.askTrade(offer, `${escapeHtml(from.name)} wants to trade with ${escapeHtml(to.name)}`);
    if (accepted) this.game.executeTrade(offer);
    else {
      this.game.log(`${to.name} turned down ${from.name}'s trade offer.`);
      if (to.ai) toast(`🤝 ${escapeHtml(to.name)} declined ${escapeHtml(from.name)}'s offer`);
    }
    return true;
  }

  private handleKey(e: KeyboardEvent) {
    const drawers = [this.rulesDrawer, this.settingsDrawer, this.logDrawer];
    if (e.key === 'Escape') drawers.forEach((d) => this.toggleDrawer(d, false));
    if (document.querySelector('.modal-backdrop.open') || drawers.some((d) => d.classList.contains('open')) || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (!this.humanActor() || this.busy) return;
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

  /** Page coordinates of a point in the scene, for page-level effects. */
  private pagePoint(p: { x: number; y: number }) {
    const r = this.sceneHost.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }

  private floatAtPlayer(pid: number, text: string, color: string) {
    const p = this.scene.playerPoint(pid);
    this.scene.overlay('float', escapeHtml(text), p.x, p.y - 60, 1600, `color:${color}`);
  }

  private async playEvent(e: GameEvent) {
    const fast = this.prefs.speed === 'turbo';
    switch (e.type) {
      case 'log':
        this.appendLog(e.text);
        break;
      case 'turn': {
        const p = this.game.player(e.player);
        this.renderChips();
        this.renderControls();
        this.renderNext();
        this.view.showRange = false;
        const card = el('div', 'turn-card', `<div class="tc" style="--pc:${p.color}">${icon(p, 44)}<span>${escapeHtml(p.name)}'s turn</span></div>`);
        play('turn');
        await this.scene.handoff(e.player, fast ? null : card, fast ? 'instant' : this.prefs.handoff);
        this.view.selected = p.pos;
        break;
      }
      case 'roll':
        play('dice');
        await this.dice.roll(e.dice, this.t.roll);
        if (e.doubles) this.floatAtPlayer(e.player, 'DOUBLES!', '#ffc23d');
        break;
      case 'move': {
        const target = e.path[e.path.length - 1];
        play('step');
        if (e.jump) await this.scene.jump(e.player, target);
        else await this.scene.walk(e.player, e.path, this.t.step);
        this.view.selected = target;
        this.renderMinimap();
        break;
      }
      case 'money': {
        this.floatAtPlayer(e.player, `${e.delta > 0 ? '+' : '−'}${money(Math.abs(e.delta))}`, e.delta > 0 ? '#3ddc84' : '#ff5a6e');
        const node = this.chipsEl.querySelector<HTMLElement>(`[data-cash="${e.player}"]`);
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
      case 'pay':
        if (fast) break;
        if (e.to === null) play('pay');
        else play('coin');
        await this.scene.coins(e.from, e.to);
        break;
      case 'buy': {
        const p = this.game.player(e.player);
        play('buy');
        const pt = this.scene.pointFor(e.tile);
        this.scene.overlay('stamp', `SOLD<small>to ${escapeHtml(p.name)}</small>`, pt.x, pt.y, 1700, `--sc:${p.color}`);
        this.scene.raiseFlag(e.tile);
        this.scene.grow(e.tile);
        this.renderMinimap();
        await sleep(fast ? 50 : 500);
        break;
      }
      case 'card':
        await this.showCard(e.card, e.player);
        break;
      case 'jail': {
        play('jail');
        const pt = this.scene.playerPoint(e.player);
        this.scene.overlay('stamp', 'BUSTED!<small>off to Lockup</small>', pt.x, pt.y - 80, 1500, '--sc:#ef4444');
        await sleep(fast ? 100 : 700);
        break;
      }
      case 'build':
        this.scene.grow(e.tile);
        play('build');
        await sleep(fast ? 30 : 300);
        break;
      case 'mortgage':
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
      case 'auctionEnd':
        if (e.winner !== null) toast(`🔨 <b>${escapeHtml(this.game.player(e.winner).name)}</b> won ${escapeHtml(TILES[e.tile].name)} for ${money(e.amount)}`, 'good');
        else toast(`🔨 No bids for ${escapeHtml(TILES[e.tile].name)}`);
        break;
      case 'fullSet': {
        const p = this.game.player(e.player), g = GROUPS[e.group];
        const pt = this.pagePoint(this.scene.playerPoint(e.player));
        confetti(pt.x, pt.y, 90, [g.color, '#ffffff', p.color]);
        play('jackpot');
        toast(`⭐ <b>${escapeHtml(p.name)}</b> owns all of <b style="color:${g.color}">${escapeHtml(g.name)}</b>!`, 'good', 3200);
        await sleep(fast ? 50 : 500);
        break;
      }
      case 'jackpot': {
        const pt = this.pagePoint(this.scene.playerPoint(e.player));
        confetti(pt.x, pt.y, 140);
        play('jackpot');
        this.floatAtPlayer(e.player, `JACKPOT ${money(e.amount)}!`, '#ffc23d');
        await sleep(600);
        break;
      }
      case 'bankrupt':
        play('bankrupt');
        toast(`💥 <b>${escapeHtml(this.game.player(e.player).name)}</b> went bankrupt!`, 'bad', 3500);
        await sleep(fast ? 100 : 900);
        break;
      case 'trade':
        play('buy');
        toast(`🤝 ${escapeHtml(this.game.player(e.offer.from).name)} and ${escapeHtml(this.game.player(e.offer.to).name)} made a trade`, 'good');
        break;
      case 'gameover':
        this.syncCash();
        this.render();
        this.showGameOver();
        break;
    }
  }

  /** Fortune/Treasury card flips over the street. */
  private async showCard(id: string, pid: number) {
    const card = CARD_BY_ID[id], p = this.game.player(pid);
    play('card');
    if (this.prefs.speed === 'turbo' && p.ai) {
      toast(`${card.deck === 'fortune' ? '🔮' : '💼'} <b>${escapeHtml(p.name)}</b>: ${escapeHtml(card.title)}`);
      return;
    }
    const wrap = el('div', 'card-pop');
    const flip = el('div', `game-card ${card.deck}`);
    flip.innerHTML = `
      <div class="card-face card-back"><div class="card-back-icon">${card.deck === 'fortune' ? '🔮' : '💼'}</div><div>${card.deck === 'fortune' ? 'FORTUNE' : 'TREASURY'}</div></div>
      <div class="card-face card-front">
        <div class="card-kind">${card.deck === 'fortune' ? '🔮 Fortune' : '💼 Treasury'}</div>
        <div class="card-title">${escapeHtml(card.title)}</div>
        <div class="card-text">${escapeHtml(card.text)}</div>
        <div class="card-who" style="--pc:${p.color}">${icon(p, 18)} ${escapeHtml(p.name)}</div>
      </div>`;
    wrap.appendChild(flip);
    this.sceneHost.appendChild(wrap);
    requestAnimationFrame(() => setTimeout(() => flip.classList.add('flipped'), 60));
    if (!p.ai) {
      await new Promise<void>((res) => {
        const ok = button('OK', 'primary card-ok', () => res());
        wrap.appendChild(ok);
        ok.focus();
        setTimeout(res, 15000);
      });
    } else await sleep(this.t.card);
    wrap.classList.add('out');
    await sleep(200);
    wrap.remove();
  }

  // ------------------------------------------------------------------ auction (the one phase that needs a dialog)

  private syncAuction() {
    const s = this.s;
    const key = s.phase === 'auction' && s.auction ? `auction:${s.turnCount}:${s.auction.tile}` : null;
    if (this.auctionModal && this.auctionModal.key !== key) {
      this.auctionModal.handle.close();
      this.auctionModal = null;
    }
    if (!key) return;
    if (this.auctionModal) return this.auctionModal.update();
    this.openAuction(key);
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
      const t = TILES[a.tile];
      if (draft < min) draft = min;
      if (draft > actor.cash) draft = Math.max(min, actor.cash);
      m.body.innerHTML = `
        <div class="auction-lot" style="--g:${groupColor(a.tile)}"><span class="ic">${t.icon}</span><div><b>${escapeHtml(t.name)}</b><small>${t.group ? escapeHtml(GROUPS[t.group].name) + ' · ' : ''}list price ${money(t.price!)}</small></div></div>
        <div class="auction-bid">${a.bid ? money(a.bid) : 'No bids yet'}</div>
        <div class="auction-leader">${leader ? `Leading: <span class="chip-inline" style="--pc:${leader.color}">${icon(leader, 18)} ${escapeHtml(leader.name)}</span>` : `Opening bid ${money(min)}`}</div>
        <div class="bidders">${this.s.players
          .filter((p) => !p.bankrupt)
          .map((p) => {
            const st = a.active.includes(p.id) ? (p.id === actor.id ? 'turn' : 'in') : 'out';
            return `<span class="bidder ${st}" style="--pc:${p.color}">${icon(p, 16)} ${escapeHtml(p.name)} <small>${st === 'out' ? 'out' : money(p.cash)}</small></span>`;
          })
          .join('')}</div>`;
      if (actor.ai) m.body.appendChild(el('div', 'thinking', `<span class="dot-pulse" style="--pc:${actor.color}"></span> ${escapeHtml(actor.name)} is thinking…`));
      else if (!this.busy) {
        m.body.appendChild(el('div', 'bid-turn', `<b>${escapeHtml(actor.name)}</b>, your bid:`));
        const stepper = el('div', 'stepper');
        const val = el('div', 'stepper-val', money(draft));
        const plus = (n: number) =>
          button(`+${n}`, 'ghost small', () => {
            draft = Math.min(actor.cash, draft + n);
            update();
          });
        stepper.append(
          button('−10', 'ghost small', () => {
            draft = Math.max(min, draft - 10);
            update();
          }),
          val,
          plus(10),
          plus(50),
          plus(100),
        );
        m.body.appendChild(stepper);
        const row = el('div', 'modal-actions');
        row.append(button(`Bid ${money(draft)}`, 'primary', () => this.act(() => this.game.bid(actor.id, draft)), actor.cash < min), button('Drop out', 'ghost', () => this.act(() => this.game.passBid(actor.id))));
        m.body.appendChild(row);
      }
    };
    update();
    this.auctionModal = { key, handle: m, update };
  }

  private confirm(text: string, yes = 'Yes'): Promise<boolean> {
    return new Promise((resolve) => {
      const m = openModal({ title: 'Are you sure?', cls: 'confirm-modal' });
      m.body.innerHTML = `<p>${text}</p>`;
      const row = el('div', 'modal-actions');
      let answered = false;
      row.append(
        button(yes, 'danger', () => {
          answered = true;
          resolve(true);
          m.close();
        }),
        button('Cancel', 'ghost', () => m.close()),
      );
      m.body.appendChild(row);
      void m.closed.then(() => {
        if (!answered) resolve(false);
      });
    });
  }

  // ------------------------------------------------------------------ manage / portfolio

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
      m.body.appendChild(el('div', 'manage-head', `Cash <b>${money(p.cash)}</b>${this.s.phase === 'debt' ? ` · Owes <b class="warn-text">${money(this.game.debtTotal(pid))}</b>` : ''}`));
      if (!owned.length) {
        m.body.appendChild(el('p', 'muted', 'No properties yet. Land on a FOR SALE plot to buy one.'));
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
        const full = !!g && this.game.hasFullSet(pid, key);
        const total = g ? TILES.filter((x) => x.group === key).length : 0;
        const progress = g ? (full ? '<span class="tag good">Full set · can build</span>' : `<span class="tag">${tiles.length}/${total} owned</span>`) : '';
        sec.innerHTML = `<div class="mg-title">${g ? escapeHtml(g.name) : key === 'transit' ? '✈️ Skyports' : '⚡ Utilities'} ${progress}</div>`;
        if (g && !full) sec.appendChild(el('div', 'build-hint', `🔒 ${escapeHtml(this.game.buildBlocker(pid, tiles[0]) ?? '')}`));
        for (const t of tiles) {
          const o = this.s.props[t];
          const row = el('div', `mrow ${o.mortgaged ? 'mortgaged' : ''}`);
          const lvl = o.houses === 5 ? '<span class="tag gold">Landmark</span>' : o.houses ? `<span class="tag">Level ${o.houses}</span>` : '';
          row.innerHTML = `<div class="mname">${TILES[t].icon} ${escapeHtml(TILES[t].name)} ${lvl}${o.mortgaged ? ' <span class="tag warn">Mortgaged</span>' : ''}</div>`;
          const btns = el('div', 'mbtns');
          if (TILES[t].kind === 'property') {
            btns.append(
              button(`Build ${money(houseCost(t))}`, 'small good', () => this.act(() => this.game.build(pid, t)), !can || !this.game.canBuild(pid, t)),
              button(`Sell +${money(houseCost(t) / 2)}`, 'small ghost', () => this.act(() => this.game.sell(pid, t)), !can || !this.game.canSell(pid, t)),
            );
          }
          if (o.mortgaged) btns.appendChild(button(`Pay off ${money(unmortgageCost(t))}`, 'small gold', () => this.act(() => this.game.unmortgage(pid, t)), !can || !this.game.canUnmortgage(pid, t)));
          else btns.appendChild(button(`Mortgage +${money(mortgageValue(t))}`, 'small ghost', () => this.act(() => this.game.mortgage(pid, t)), !can || !this.game.canMortgage(pid, t)));
          row.appendChild(btns);
          sec.appendChild(row);
          const why = full && can && o.houses < 5 ? this.game.buildBlocker(pid, t) : null;
          if (why) sec.appendChild(el('div', 'build-hint', `ℹ️ ${escapeHtml(why)}`));
        }
        list.appendChild(sec);
      }
      m.body.appendChild(list);
      m.body.appendChild(el('p', 'muted small', can ? 'Own every city in a set to build. Each build adds floors; level 5 is the landmark. Build evenly across the set.' : 'You can manage properties during your own turn.'));
    };
    update();
    this.registerLive(m, update);
  }

  private openPortfolio(pid: number) {
    const p = this.game.player(pid);
    if (!p.ai && this.game.canManage(pid)) return this.openManage(pid);
    const m = openModal({ title: `${escapeHtml(p.name)}`, cls: 'manage-modal' });
    const owned = this.game.ownedBy(pid);
    m.body.innerHTML = `
      <div class="manage-head">${icon(p, 30)} Cash <b>${money(p.cash)}</b> · Net worth <b>${money(this.game.netWorth(pid))}</b></div>
      <div class="portfolio">${
        owned
          .map((t) => {
            const o = this.s.props[t];
            return `<button class="pf-item ${o.mortgaged ? 'mortgaged' : ''}" style="--g:${groupColor(t)}" data-tile="${t}">${TILES[t].icon} ${escapeHtml(TILES[t].name)} <span>${o.houses === 5 ? 'Landmark' : o.houses ? 'Level ' + o.houses : ''}</span></button>`;
          })
          .join('') || '<p class="muted">No properties.</p>'
      }</div>`;
    m.body.querySelectorAll<HTMLElement>('.pf-item').forEach((n) =>
      n.addEventListener('click', () => {
        m.close();
        this.openPlace(Number(n.dataset.tile));
      }),
    );
  }

  // ------------------------------------------------------------------ trading

  private sideHtml(side: TradeSide, owner: Player) {
    const parts = side.tiles.map((t) => `<span class="tchip on" style="--g:${groupColor(t)}">${TILES[t].icon} ${escapeHtml(TILES[t].name)}${this.s.props[t]?.mortgaged ? ' (M)' : ''}</span>`);
    if (side.cash) parts.push(`<span class="tchip cash on">💵 ${money(side.cash)}</span>`);
    if (side.jailCards) parts.push(`<span class="tchip on">🎫 ×${side.jailCards}</span>`);
    return `<div class="tside"><div class="tside-title" style="--pc:${owner.color}">${icon(owner, 18)} ${escapeHtml(owner.name)} gives</div>${parts.join('') || '<span class="muted">Nothing</span>'}</div>`;
  }

  /** Shows a trade to a human player and resolves with their answer. */
  private askTrade(offer: TradeOffer, title: string): Promise<boolean> {
    return new Promise((resolve) => {
      const from = this.game.player(offer.from), to = this.game.player(offer.to);
      const m = openModal({ title: '🤝 Trade offer', cls: 'trade-modal', dismissable: false });
      play('card');
      m.body.innerHTML = `<p class="center">${title}</p>
        <div class="trade-review">${this.sideHtml(offer.give, from)}<div class="swap">⇄</div>${this.sideHtml(offer.get, to)}</div>
        <p class="muted center small">${escapeHtml(to.name)}, do you accept?</p>`;
      const row = el('div', 'modal-actions');
      row.append(
        button('✅ Accept', 'primary', () => {
          m.close();
          resolve(true);
        }),
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
        const on = side.tiles.includes(t);
        const chip = el('button', `tchip ${on ? 'on' : ''}`, `${TILES[t].icon} ${escapeHtml(TILES[t].short)}${this.s.props[t].mortgaged ? ' (M)' : ''}`);
        chip.style.setProperty('--g', groupColor(t));
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
      if (target.ai) {
        footer.innerHTML = `<div class="thinking"><span class="dot-pulse" style="--pc:${target.color}"></span> ${escapeHtml(target.name)} is considering…</div>`;
        await sleep(700);
        if (!acceptsTrade(this.game, offer)) {
          play('error');
          footer.innerHTML = '';
          footer.appendChild(el('div', 'trade-msg bad-text', `${escapeHtml(target.name)} declined. Try sweetening the deal.`));
          footer.appendChild(button('Propose again', 'primary', () => void propose({ from: pid, to: partner, give, get })));
          return;
        }
      } else {
        m.close();
        const ok = await this.askTrade(offer, `${escapeHtml(me.name)} proposes a trade. Pass the device to <b>${escapeHtml(target.name)}</b>.`);
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
        const b = el('button', o.id === partner ? 'on' : '', `${icon(o, 18)} ${escapeHtml(o.name)}`);
        b.addEventListener('click', () => {
          partner = o.id;
          get = empty();
          draw();
        });
        tabs.appendChild(b);
      }
      m.body.appendChild(tabs);
      const grid = el('div', 'trade-grid');
      grid.append(column(me, give, 'You give'), el('div', 'swap', '⇄'), column(this.game.player(partner), get, `You get from ${escapeHtml(this.game.player(partner).name)}`));
      m.body.append(grid, footer);
      refreshFooter();
    };
    draw();
  }

  // ------------------------------------------------------------------ menus

  private showGameOver() {
    const s = this.s;
    clearSave();
    const ranked = [...s.players].sort((a, b) => (a.bankrupt !== b.bankrupt ? (a.bankrupt ? 1 : -1) : this.game.netWorth(b.id) - this.game.netWorth(a.id)));
    const w = s.winner !== null ? this.game.player(s.winner) : ranked[0];
    play('win');
    confetti(window.innerWidth / 2, window.innerHeight / 3, 220);
    setTimeout(() => confetti(window.innerWidth * 0.25, window.innerHeight / 2, 120), 400);
    setTimeout(() => confetti(window.innerWidth * 0.75, window.innerHeight / 2, 120), 800);
    const m = openModal({ cls: 'gameover-modal', dismissable: false });
    m.body.innerHTML = `
      <div class="trophy">🏆</div>
      <div class="winner" style="--pc:${w.color}">${icon(w, 40)} ${escapeHtml(w.name)} wins!</div>
      <p class="muted center">Finished in ${s.round} round${s.round === 1 ? '' : 's'}</p>
      <ol class="standings">${ranked.map((p) => `<li style="--pc:${p.color}" class="${p.bankrupt ? 'out' : ''}"><span>${icon(p, 18)} ${escapeHtml(p.name)}</span><b>${p.bankrupt ? 'Bankrupt' : money(this.game.netWorth(p.id))}</b></li>`).join('')}</ol>`;
    const row = el('div', 'modal-actions');
    row.append(
      button('🔁 Play again', 'primary', () => {
        m.close();
        this.exit(true);
      }),
      button('🏠 Main menu', 'ghost', () => {
        m.close();
        this.exit();
      }),
      button('👀 View street', 'ghost', () => m.close()),
    );
    m.body.appendChild(row);
  }
}
