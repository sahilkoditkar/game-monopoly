import {
  BUYABLE,
  GROUPS,
  JAIL_FINE,
  JAIL_INDEX,
  MAX_HOTELS,
  MAX_HOUSES,
  TILES,
  TRANSIT_RENTS,
  UTILITY_MULTIPLIERS,
  groupTiles,
  houseCost,
  isBuyable,
  mortgageValue,
  unmortgageCost,
} from './board';
import { CARDS, CARD_BY_ID } from './cards';
import { nextRandom, randomSeed } from './rng';
import {
  ACTION_CARDS,
  BOOST_STEPS,
  CARD_NAMES,
  HAND_LIMIT,
  MISSION_CASH,
  MISSION_KINDS,
  MISSION_PROPS,
  MISSION_RENT,
  MISSION_REWARD,
  NEWS_BONUS,
  NEWS_EVENTS,
  NEWS_TAX,
  missionText,
} from './extras';
import type {
  ActionCard,
  Deck,
  GameEvent,
  GameState,
  GameStats,
  Player,
  PlayerConfig,
  Settings,
  TradeOffer,
  TradeSide,
} from './types';

export const DEFAULT_SETTINGS: Settings = {
  startingCash: 1500,
  salary: 200,
  auctions: true,
  jackpot: true,
  roundLimit: 0,
};

export const MIN_BID = 10;
const LOG_LIMIT = 300;

export class Game {
  state: GameState;
  private events: GameEvent[] = [];
  /** Dice to use for the next roll (tests and debugging). */
  forcedDice: [number, number][] = [];

  constructor(state: GameState) {
    this.state = state;
  }

  static create(configs: PlayerConfig[], settings: Partial<Settings> = {}, seed = randomSeed()): Game {
    if (configs.length < 2 || configs.length > 4) throw new Error('A game needs 2 to 4 players');
    const s: Settings = { ...DEFAULT_SETTINGS, ...settings };
    const players: Player[] = configs.map((c, id) => ({
      id,
      name: c.name,
      token: c.token,
      color: c.color,
      ai: c.ai,
      difficulty: c.difficulty ?? 'normal',
      cash: s.startingCash,
      pos: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: [],
      bankrupt: false,
    }));
    const state: GameState = {
      version: 1,
      seed,
      players,
      props: {},
      current: 0,
      phase: 'roll',
      dice: [1, 1],
      doublesCount: 0,
      rollAgain: false,
      auction: null,
      debts: [],
      resume: 'end',
      decks: { fortune: [], treasury: [] },
      jackpot: 0,
      round: 1,
      turnCount: 0,
      winner: null,
      settings: s,
      log: [],
      lastCard: null,
    };
    const game = new Game(state);
    for (const deck of ['fortune', 'treasury'] as Deck[]) {
      state.decks[deck] = game.shuffle(CARDS.filter((c) => c.deck === deck).map((c) => c.id));
    }
    // Dice get their own stream so a seed always means the same rolls, whatever players decide.
    state.diceSeed = (seed ^ 0x5bd1e995) >>> 0;
    if (s.quickStart) game.dealQuickStart();
    if (s.missions) game.dealMissions();
    if (s.actionCards) {
      state.hands = players.map(() => []);
      for (const p of players) for (let k = 0; k < 2; k++) game.drawActionCard(p, true);
    }
    game.stats.worth.push(players.map((p) => game.netWorth(p.id)));
    game.emit({ type: 'turn', player: 0 });
    game.log(`${players[0].name} goes first.`);
    return game;
  }

  // ---------------------------------------------------------------- helpers

  /** Returns and clears the events produced since the last call. Secret missions are checked here, after every action. */
  drain(): GameEvent[] {
    this.checkMissions();
    const out = this.events;
    this.events = [];
    return out;
  }

  private emit(e: GameEvent) {
    this.events.push(e);
  }

  log(text: string) {
    this.state.log.push(text);
    if (this.state.log.length > LOG_LIMIT) this.state.log.splice(0, this.state.log.length - LOG_LIMIT);
    this.emit({ type: 'log', text });
  }

  random(): number {
    const [r, seed] = nextRandom(this.state.seed);
    this.state.seed = seed;
    return r;
  }

  private shuffle<T>(items: T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private rollDice(): [number, number] {
    const forced = this.forcedDice.shift();
    if (forced) return forced;
    const s = this.state;
    if (s.diceSeed === undefined) return [1 + Math.floor(this.random() * 6), 1 + Math.floor(this.random() * 6)];
    const [a, s1] = nextRandom(s.diceSeed);
    const [b, s2] = nextRandom(s1);
    s.diceSeed = s2;
    return [1 + Math.floor(a * 6), 1 + Math.floor(b * 6)];
  }

  get cur(): Player {
    return this.state.players[this.state.current];
  }

  player(id: number): Player {
    return this.state.players[id];
  }

  activePlayers(): Player[] {
    return this.state.players.filter((p) => !p.bankrupt);
  }

  ownerOf(tile: number): number | null {
    return this.state.props[tile]?.owner ?? null;
  }

  ownedBy(pid: number): number[] {
    return BUYABLE.filter((i) => this.state.props[i]?.owner === pid);
  }

  hasFullSet(pid: number, group: string): boolean {
    return groupTiles(group).every((i) => this.state.props[i]?.owner === pid);
  }

  fullSets(pid: number): string[] {
    return Object.keys(GROUPS).filter((g) => this.hasFullSet(pid, g));
  }

  housesInUse(): { houses: number; hotels: number } {
    let houses = 0;
    let hotels = 0;
    for (const o of Object.values(this.state.props)) {
      if (o.houses === 5) hotels++;
      else houses += o.houses;
    }
    return { houses, hotels };
  }

  /** Rent owed for landing on `tile` given the dice total. */
  rentFor(tile: number, diceTotal: number, cardBoost = false): number {
    return Math.round(this.baseRent(tile, diceTotal, cardBoost) * this.newsMultiplier(tile));
  }

  /** The combined news effect on a tile's rent (1 when there's no news about it). */
  newsMultiplier(tile: number): number {
    const def = TILES[tile];
    const target = def.kind === 'property' ? def.group : def.kind;
    return (this.state.news ?? []).filter((n) => n.target === target).reduce((m, n) => m * n.mult, 1);
  }

  private baseRent(tile: number, diceTotal: number, cardBoost: boolean): number {
    const own = this.state.props[tile];
    if (!own || own.mortgaged) return 0;
    const def = TILES[tile];
    if (def.kind === 'property') {
      if (own.houses > 0) return def.rents![own.houses];
      const base = def.rents![0];
      return this.hasFullSet(own.owner, def.group!) ? base * 2 : base;
    }
    if (def.kind === 'transit') {
      const n = BUYABLE.filter((i) => TILES[i].kind === 'transit' && this.state.props[i]?.owner === own.owner).length;
      return TRANSIT_RENTS[n - 1] * (cardBoost ? 2 : 1);
    }
    if (def.kind === 'utility') {
      const n = BUYABLE.filter((i) => TILES[i].kind === 'utility' && this.state.props[i]?.owner === own.owner).length;
      const mult = cardBoost ? 10 : UTILITY_MULTIPLIERS[n - 1];
      return mult * diceTotal;
    }
    return 0;
  }

  /** Total assets: cash plus property and building value at cost (mortgaged at half). */
  /** Quick game: deals two random cities to each player, never two from the same colour set. */
  private dealQuickStart() {
    const pool = this.shuffle(TILES.filter((t) => t.kind === 'property').map((t) => t.index));
    for (const p of this.state.players) {
      const got: number[] = [];
      for (let k = 0; k < pool.length && got.length < 2; k++) {
        const t = pool[k];
        if (got.some((g) => TILES[g].group === TILES[t].group)) continue;
        got.push(t);
        pool.splice(k--, 1);
      }
      for (const t of got) this.state.props[t] = { owner: p.id, houses: 0, mortgaged: false };
      this.log(`Quick start: ${p.name} gets ${got.map((t) => TILES[t].name).join(' and ')}.`);
    }
  }

  /** End-of-game statistics, created on first use (older saves have none). */
  get stats(): GameStats {
    const n = this.state.players.length;
    this.state.stats ??= { worth: [], rentPaid: Array(n).fill(0), rentGot: Array(n).fill(0), jail: Array(n).fill(0), tileRent: {}, biggest: null };
    return this.state.stats;
  }

  private recordWorth() {
    this.stats.worth.push(this.state.players.map((p) => (p.bankrupt ? 0 : this.netWorth(p.id))));
  }

  netWorth(pid: number): number {
    const p = this.player(pid);
    if (p.bankrupt) return 0;
    let total = p.cash;
    for (const i of this.ownedBy(pid)) {
      const o = this.state.props[i];
      total += o.mortgaged ? mortgageValue(i) : TILES[i].price!;
      total += o.houses * houseCost(i);
    }
    return total;
  }

  /** Cash a player could raise right now by selling buildings and mortgaging. */
  liquidity(pid: number): number {
    const p = this.player(pid);
    let total = p.cash;
    for (const i of this.ownedBy(pid)) {
      const o = this.state.props[i];
      total += (o.houses * houseCost(i)) / 2;
      if (!o.mortgaged) total += mortgageValue(i);
    }
    return Math.floor(total);
  }

  /** The player who must act right now (bidder during auctions, debtor during debt). */
  actor(): number {
    const s = this.state;
    if (s.phase === 'auction' && s.auction) return s.auction.active[s.auction.turn];
    if (s.phase === 'debt' && s.debts.length) return s.debts[0].from;
    return s.current;
  }

  canManage(pid: number): boolean {
    const s = this.state;
    if (this.player(pid).bankrupt) return false;
    if (s.phase === 'debt') return s.debts[0]?.from === pid;
    return pid === s.current && (s.phase === 'roll' || s.phase === 'end' || s.phase === 'buy');
  }

  // ------------------------------------------------------------- turn flow

  canRoll(): boolean {
    return this.state.phase === 'roll';
  }

  roll(): [number, number] | null {
    const s = this.state;
    if (s.phase !== 'roll') return null;
    const p = this.cur;
    const dice = this.rollDice();
    s.dice = dice;
    const doubles = dice[0] === dice[1];
    const total = dice[0] + dice[1];
    this.emit({ type: 'roll', player: p.id, dice, doubles });
    this.log(`${p.name} rolled ${dice[0]} + ${dice[1]}${doubles ? ' (doubles!)' : ''}.`);

    if (p.inJail) {
      if (doubles) {
        this.releaseFromJail(p, 'rolled doubles');
        s.rollAgain = false;
        this.moveBy(p, total);
        return dice;
      }
      p.jailTurns++;
      if (p.jailTurns >= 3) {
        this.log(`${p.name} must pay the $${JAIL_FINE} fine after three tries.`);
        this.charge(p.id, null, JAIL_FINE, 'Lockup fine', true);
        this.releaseFromJail(p, 'paid the fine');
        s.rollAgain = false;
        this.moveBy(p, total);
        return dice;
      }
      this.log(`${p.name} stays in Lockup.`);
      s.rollAgain = false;
      this.afterLanding();
      return dice;
    }

    if (doubles) {
      s.doublesCount++;
      if (s.doublesCount >= 3) {
        this.log(`${p.name} rolled doubles three times. Busted!`);
        this.sendToJail(p);
        s.rollAgain = false;
        this.afterLanding();
        return dice;
      }
    }
    s.rollAgain = doubles;
    const fx = s.turnFx;
    const extra = fx?.boost ? BOOST_STEPS : 0;
    if (fx) fx.boost = false;
    this.moveBy(p, total + extra);
    return dice;
  }

  payJailFine(): boolean {
    const p = this.cur;
    if (this.state.phase !== 'roll' || !p.inJail || p.cash < JAIL_FINE) return false;
    this.pay(p.id, null, JAIL_FINE, 'Lockup fine', true);
    this.releaseFromJail(p, `paid $${JAIL_FINE}`);
    return true;
  }

  useJailCard(): boolean {
    const p = this.cur;
    if (this.state.phase !== 'roll' || !p.inJail || p.jailCards.length === 0) return false;
    const deck = p.jailCards.shift()!;
    const card = CARDS.find((c) => c.deck === deck && c.effect.type === 'jailFree')!;
    this.state.decks[deck].push(card.id);
    this.releaseFromJail(p, 'used a get-out card');
    return true;
  }

  private releaseFromJail(p: Player, how: string) {
    p.inJail = false;
    p.jailTurns = 0;
    this.emit({ type: 'leaveJail', player: p.id });
    this.log(`${p.name} left Lockup (${how}).`);
  }

  private sendToJail(p: Player) {
    const from = p.pos;
    p.pos = JAIL_INDEX;
    p.inJail = true;
    p.jailTurns = 0;
    this.state.doublesCount = 0;
    this.state.rollAgain = false;
    this.emit({ type: 'move', player: p.id, path: [from, JAIL_INDEX], jump: true });
    this.emit({ type: 'jail', player: p.id });
    this.log(`${p.name} was sent to Lockup.`);
    this.stats.jail[p.id]++;
  }

  private moveBy(p: Player, steps: number) {
    this.travel(p, (p.pos + steps) % 40, true, {});
  }

  private land(p: Player, opts: LandOpts) {
    const s = this.state;
    const tile = TILES[p.pos];
    switch (tile.kind) {
      case 'property':
      case 'transit':
      case 'utility': {
        const own = s.props[p.pos];
        if (!own) {
          s.resume = 'buy';
          this.setPhaseAfter('buy');
          return;
        }
        if (own.owner === p.id) {
          this.log(`${p.name} landed on their own ${tile.name}.`);
        } else if (own.mortgaged) {
          this.log(`${tile.name} is mortgaged, so no rent is due.`);
        } else if (s.turnFx?.holiday && p.id === s.current) {
          this.log(`${p.name} is on a rent holiday: no rent for ${tile.name}.`);
        } else {
          let total = s.dice[0] + s.dice[1];
          if (opts.utilityRoll) {
            const d = this.rollDice();
            s.dice = d;
            total = d[0] + d[1];
            this.emit({ type: 'roll', player: p.id, dice: d, doubles: false });
          }
          const rent = this.rentFor(p.pos, total, opts.cardBoost);
          const owner = this.player(own.owner);
          this.log(`${p.name} owes ${owner.name} $${rent} rent for ${tile.name}.`);
          this.charge(p.id, own.owner, rent, `Rent: ${tile.name}`);
          const st = this.stats;
          st.rentPaid[p.id] += rent;
          st.rentGot[own.owner] += rent;
          st.tileRent[p.pos] = (st.tileRent[p.pos] ?? 0) + rent;
          if (!st.biggest || rent > st.biggest.amount) st.biggest = { amount: rent, from: p.id, to: own.owner, tile: p.pos };
        }
        break;
      }
      case 'tax':
        this.log(`${p.name} pays $${tile.tax} ${tile.name}.`);
        this.charge(p.id, null, tile.tax!, tile.name, true);
        break;
      case 'fortune':
      case 'treasury':
        this.drawCard(p, tile.kind);
        return;
      case 'gotojail':
        this.sendToJail(p);
        break;
      case 'lounge':
        if (s.settings.jackpot && s.jackpot > 0) {
          const amount = s.jackpot;
          s.jackpot = 0;
          p.cash += amount;
          this.emit({ type: 'jackpot', player: p.id, amount });
          this.emit({ type: 'money', player: p.id, delta: amount, reason: 'Sky Lounge jackpot' });
          this.log(`${p.name} hit the Sky Lounge jackpot: $${amount}!`);
        } else {
          this.log(`${p.name} relaxes in the Sky Lounge.`);
        }
        break;
      default:
        break;
    }
    this.afterLanding();
  }

  private drawCard(p: Player, deck: Deck) {
    const s = this.state;
    const id = s.decks[deck].shift()!;
    const card = CARD_BY_ID[id];
    s.lastCard = id;
    if (card.effect.type !== 'jailFree') s.decks[deck].push(id);
    this.emit({ type: 'card', player: p.id, card: id });
    this.log(`${p.name} drew "${card.title}": ${card.text}`);
    const e = card.effect;
    switch (e.type) {
      case 'advance':
        this.travel(p, e.to, e.collectStart, {});
        return;
      case 'nearest': {
        let i = p.pos;
        do i = (i + 1) % 40;
        while (TILES[i].kind !== e.kind);
        this.travel(p, i, true, e.kind === 'transit' ? { cardBoost: true } : { cardBoost: true, utilityRoll: true });
        return;
      }
      case 'back': {
        const from = p.pos;
        const path: number[] = [];
        for (let k = 1; k <= e.steps; k++) path.push((from - k + 40) % 40);
        p.pos = path[path.length - 1];
        this.emit({ type: 'move', player: p.id, path });
        this.land(p, {});
        return;
      }
      case 'money':
        if (e.amount >= 0) this.gain(p, e.amount, card.title);
        else this.charge(p.id, null, -e.amount, card.title, true);
        break;
      case 'each':
        for (const o of this.activePlayers()) {
          if (o.id === p.id) continue;
          if (e.amount < 0) this.charge(p.id, o.id, -e.amount, card.title);
          else this.charge(o.id, p.id, e.amount, card.title);
        }
        break;
      case 'repairs': {
        let cost = 0;
        for (const i of this.ownedBy(p.id)) {
          const h = s.props[i].houses;
          cost += h === 5 ? e.hotel : h * e.house;
        }
        if (cost > 0) this.charge(p.id, null, cost, card.title, true);
        else this.log(`${p.name} has no buildings, so nothing is owed.`);
        break;
      }
      case 'jail':
        this.sendToJail(p);
        break;
      case 'jailFree':
        p.jailCards.push(deck);
        break;
    }
    this.afterLanding();
  }

  private travel(p: Player, target: number, collectStart: boolean, opts: LandOpts) {
    const path: number[] = [];
    let pos = p.pos;
    while (pos !== target) {
      pos = (pos + 1) % 40;
      path.push(pos);
      if (pos === 0 && collectStart) {
        this.emit({ type: 'move', player: p.id, path: [...path] });
        path.length = 0;
        p.cash += this.state.settings.salary;
        this.emit({ type: 'money', player: p.id, delta: this.state.settings.salary, reason: 'Launch Pad salary' });
        this.log(`${p.name} passed the Launch Pad and collected $${this.state.settings.salary}.`);
        if (this.state.settings.actionCards) this.drawActionCard(p);
      }
    }
    if (path.length) this.emit({ type: 'move', player: p.id, path });
    p.pos = target;
    this.land(p, opts);
  }

  private gain(p: Player, amount: number, reason: string) {
    p.cash += amount;
    this.emit({ type: 'money', player: p.id, delta: amount, reason });
  }

  /** Moves cash immediately. Callers must ensure the payer can afford it. */
  private pay(from: number, to: number | null, amount: number, reason: string, toPot = false) {
    if (amount <= 0) return;
    const payer = this.player(from);
    payer.cash -= amount;
    this.emit({ type: 'money', player: from, delta: -amount, reason });
    if (to !== null) {
      this.player(to).cash += amount;
      this.emit({ type: 'money', player: to, delta: amount, reason });
    } else if (toPot && this.state.settings.jackpot) {
      this.state.jackpot += amount;
    }
    this.emit({ type: 'pay', from, to, amount, reason });
  }

  /** Pays now if possible, otherwise records a debt the payer must settle. */
  private charge(from: number, to: number | null, amount: number, reason: string, toPot = false) {
    if (amount <= 0) return;
    const payer = this.player(from);
    if (payer.bankrupt) return;
    const behind = this.state.debts.some((d) => d.from === from);
    if (!behind && payer.cash >= amount) {
      this.pay(from, to, amount, reason, toPot);
    } else {
      this.state.debts.push({ from, to, amount, reason, toPot });
      this.log(`${payer.name} needs to raise $${amount - payer.cash} to pay ${reason}.`);
    }
  }

  private setPhaseAfter(next: 'buy' | 'roll' | 'end') {
    const s = this.state;
    s.resume = next;
    if (s.debts.length) {
      this.settleDebts();
      if (s.debts.length) {
        s.phase = 'debt';
        return;
      }
    }
    s.phase = next;
  }

  private afterLanding() {
    const p = this.cur;
    const again = this.state.rollAgain && !p.inJail && !p.bankrupt;
    if (!again) this.state.rollAgain = false;
    this.setPhaseAfter(again ? 'roll' : 'end');
    this.checkGameOver();
  }

  /** Pays off queued debts in order while the debtor has the cash. */
  private settleDebts() {
    const s = this.state;
    while (s.debts.length) {
      const d = s.debts[0];
      const payer = this.player(d.from);
      if (payer.bankrupt) {
        s.debts.shift();
        continue;
      }
      if (payer.cash < d.amount) break;
      s.debts.shift();
      this.pay(d.from, d.to, d.amount, d.reason, d.toPot);
    }
    if (s.phase === 'debt' && s.debts.length === 0) {
      s.phase = s.resume;
    }
  }

  // ------------------------------------------------------------- buying

  buy(): boolean {
    const s = this.state;
    const p = this.cur;
    if (s.phase !== 'buy') return false;
    const tile = TILES[p.pos];
    const price = this.buyPrice();
    if (!isBuyable(p.pos) || s.props[p.pos] || p.cash < price) return false;
    if (s.turnFx) s.turnFx.half = false;
    this.pay(p.id, null, price, `Bought ${tile.name}`);
    s.props[p.pos] = { owner: p.id, houses: 0, mortgaged: false };
    this.emit({ type: 'buy', player: p.id, tile: p.pos, price });
    this.log(`${p.name} bought ${tile.name} for $${price}.`);
    this.checkFullSet(p.id, p.pos);
    this.finishBuyStep();
    return true;
  }

  /** What the current player pays for the tile they stand on (half with a Half price card). */
  buyPrice(): number {
    const price = TILES[this.cur.pos].price ?? 0;
    return this.state.turnFx?.half ? Math.floor(price / 2) : price;
  }

  /** Declines to buy. Starts an auction when enabled. */
  decline(): boolean {
    const s = this.state;
    if (s.phase !== 'buy') return false;
    const p = this.cur;
    const tile = TILES[p.pos];
    this.log(`${p.name} passed on ${tile.name}.`);
    if (s.settings.auctions) {
      const order: number[] = [];
      for (let k = 0; k < s.players.length; k++) {
        const pl = s.players[(s.current + 1 + k) % s.players.length];
        if (!pl.bankrupt) order.push(pl.id);
      }
      s.auction = { tile: p.pos, bid: 0, bidder: null, active: order, turn: 0 };
      s.phase = 'auction';
      this.emit({ type: 'auctionStart', tile: p.pos });
      this.log(`${tile.name} goes up for auction!`);
      return true;
    }
    this.finishBuyStep();
    return true;
  }

  private finishBuyStep() {
    const s = this.state;
    s.resume = 'end';
    this.afterLanding();
  }

  minBid(): number {
    const a = this.state.auction;
    if (!a) return MIN_BID;
    return a.bid === 0 ? MIN_BID : a.bid + 1;
  }

  bid(pid: number, amount: number): boolean {
    const s = this.state;
    const a = s.auction;
    if (s.phase !== 'auction' || !a || a.active[a.turn] !== pid) return false;
    amount = Math.floor(amount);
    if (amount < this.minBid() || amount > this.player(pid).cash) return false;
    a.bid = amount;
    a.bidder = pid;
    this.emit({ type: 'bid', player: pid, amount });
    this.log(`${this.player(pid).name} bids $${amount}.`);
    this.advanceAuction(false);
    return true;
  }

  passBid(pid: number): boolean {
    const s = this.state;
    const a = s.auction;
    if (s.phase !== 'auction' || !a || a.active[a.turn] !== pid) return false;
    this.emit({ type: 'auctionPass', player: pid });
    this.log(`${this.player(pid).name} drops out of the auction.`);
    this.advanceAuction(true);
    return true;
  }

  private advanceAuction(removeCurrent: boolean) {
    const a = this.state.auction!;
    if (removeCurrent) {
      a.active.splice(a.turn, 1);
      if (a.turn >= a.active.length) a.turn = 0;
    } else {
      a.turn = (a.turn + 1) % a.active.length;
    }
    const others = a.active.filter((id) => id !== a.bidder);
    if (others.length === 0) {
      this.endAuction();
      return;
    }
    // The leading bidder never has to act until outbid.
    if (a.active[a.turn] === a.bidder) a.turn = (a.turn + 1) % a.active.length;
  }

  private endAuction() {
    const s = this.state;
    const a = s.auction!;
    const tile = TILES[a.tile];
    s.auction = null;
    if (a.bidder !== null) {
      this.pay(a.bidder, null, a.bid, `Auction: ${tile.name}`);
      s.props[a.tile] = { owner: a.bidder, houses: 0, mortgaged: false };
      this.emit({ type: 'auctionEnd', tile: a.tile, winner: a.bidder, amount: a.bid });
      this.emit({ type: 'buy', player: a.bidder, tile: a.tile, price: a.bid });
      this.log(`${this.player(a.bidder).name} won ${tile.name} for $${a.bid}.`);
      this.checkFullSet(a.bidder, a.tile);
    } else {
      this.emit({ type: 'auctionEnd', tile: a.tile, winner: null, amount: 0 });
      this.log(`Nobody bid on ${tile.name}.`);
    }
    s.phase = 'end';
    this.finishBuyStep();
  }

  private checkFullSet(pid: number, tile: number) {
    const g = TILES[tile].group;
    if (g && this.hasFullSet(pid, g)) {
      this.emit({ type: 'fullSet', player: pid, group: g });
      this.log(`${this.player(pid).name} owns all of ${GROUPS[g].name}! Rents double and building is unlocked.`);
    }
  }

  endTurn(): boolean {
    const s = this.state;
    if (s.phase !== 'end') return false;
    this.nextTurn();
    return true;
  }

  private nextTurn() {
    const s = this.state;
    if (s.phase === 'gameover') return;
    s.rollAgain = false;
    s.doublesCount = 0;
    s.lastCard = null;
    s.debts = [];
    const prev = s.current;
    let next = s.current;
    do next = (next + 1) % s.players.length;
    while (s.players[next].bankrupt);
    if (next <= s.current) {
      s.round++;
      this.recordWorth();
    }
    s.current = next;
    s.turnCount++;
    s.phase = 'roll';
    s.turnFx = undefined;
    if (s.settings.roundLimit > 0 && s.round > s.settings.roundLimit) {
      this.finishByWorth();
      return;
    }
    if (s.settings.news && next <= prev) this.breakingNews();
    this.emit({ type: 'turn', player: next });
  }

  // ------------------------------------------------------------- building

  private sameGroupTiles(tile: number): number[] {
    const g = TILES[tile].group;
    return g ? groupTiles(g) : [tile];
  }

  /** House cost for `pid`, or 0 when they played a Free house card this turn. */
  buildCost(pid: number, tile: number): number {
    return this.state.turnFx?.free && pid === this.state.current ? 0 : houseCost(tile);
  }

  canBuild(pid: number, tile: number): boolean {
    return this.buildBlocker(pid, tile) === null;
  }

  /** Why `pid` can't build on `tile` right now, or null if they can. */
  buildBlocker(pid: number, tile: number): string | null {
    const own = this.state.props[tile];
    const def = TILES[tile];
    if (!own || own.owner !== pid || def.kind !== 'property') return 'Only your own cities can have houses.';
    if (own.houses >= 5) return 'Fully built: it already has a hotel.';
    if (!this.hasFullSet(pid, def.group!)) {
      const tiles = groupTiles(def.group!);
      const missing = tiles
        .filter((i) => this.state.props[i]?.owner !== pid)
        .map((i) => {
          const o = this.ownerOf(i);
          return `${TILES[i].name} (${o === null ? 'unowned' : this.player(o).name})`;
        });
      return `Own all ${tiles.length} ${GROUPS[def.group!].name} cities to build. Missing: ${missing.join(', ')}.`;
    }
    if (this.state.phase === 'debt') return 'Pay what you owe before building.';
    if (!this.canManage(pid)) return 'You can build during your own turn.';
    const group = this.sameGroupTiles(tile).map((i) => this.state.props[i]);
    if (group.some((o) => o.mortgaged)) return 'Pay off the mortgages in this set first.';
    if (own.houses > Math.min(...group.map((o) => o.houses)))
      return 'Build evenly: add a house to the other cities in this set first.';
    if (this.player(pid).cash < this.buildCost(pid, tile)) return `You need $${houseCost(tile)} to build here.`;
    const supply = this.housesInUse();
    if (own.houses === 4 && supply.hotels >= MAX_HOTELS) return 'The bank has run out of hotels.';
    if (own.houses < 4 && supply.houses >= MAX_HOUSES) return 'The bank has run out of houses.';
    return null;
  }

  build(pid: number, tile: number): boolean {
    if (!this.canBuild(pid, tile)) return false;
    const own = this.state.props[tile];
    const cost = this.buildCost(pid, tile);
    if (cost === 0 && this.state.turnFx) this.state.turnFx.free = false;
    this.pay(pid, null, cost, `Built on ${TILES[tile].name}`);
    own.houses++;
    this.emit({ type: 'build', player: pid, tile, houses: own.houses });
    this.log(`${this.player(pid).name} built ${own.houses === 5 ? 'a hotel' : 'a house'} on ${TILES[tile].name}.`);
    return true;
  }

  canSell(pid: number, tile: number): boolean {
    const own = this.state.props[tile];
    if (!this.canManage(pid) || !own || own.owner !== pid || own.houses === 0) return false;
    const group = this.sameGroupTiles(tile).map((i) => this.state.props[i]);
    return own.houses >= Math.max(...group.map((o) => o.houses));
  }

  sell(pid: number, tile: number): boolean {
    if (!this.canSell(pid, tile)) return false;
    const own = this.state.props[tile];
    let next = own.houses - 1;
    // A hotel normally breaks down into 4 houses; if the bank is short, take what's left.
    if (own.houses === 5) next = Math.min(4, MAX_HOUSES - this.housesInUse().houses);
    const refund = ((own.houses - next) * houseCost(tile)) / 2;
    own.houses = next;
    this.gain(this.player(pid), refund, `Sold building on ${TILES[tile].name}`);
    this.emit({ type: 'build', player: pid, tile, houses: own.houses });
    this.log(`${this.player(pid).name} sold a building on ${TILES[tile].name}.`);
    this.settleDebts();
    return true;
  }

  canMortgage(pid: number, tile: number): boolean {
    const own = this.state.props[tile];
    if (!this.canManage(pid) || !own || own.owner !== pid || own.mortgaged) return false;
    return this.sameGroupTiles(tile).every((i) => (this.state.props[i]?.houses ?? 0) === 0);
  }

  mortgage(pid: number, tile: number): boolean {
    if (!this.canMortgage(pid, tile)) return false;
    this.state.props[tile].mortgaged = true;
    this.gain(this.player(pid), mortgageValue(tile), `Mortgaged ${TILES[tile].name}`);
    this.emit({ type: 'mortgage', player: pid, tile, mortgaged: true });
    this.log(`${this.player(pid).name} mortgaged ${TILES[tile].name} for $${mortgageValue(tile)}.`);
    this.settleDebts();
    return true;
  }

  canUnmortgage(pid: number, tile: number): boolean {
    const own = this.state.props[tile];
    if (!this.canManage(pid) || this.state.phase === 'debt') return false;
    return !!own && own.owner === pid && own.mortgaged && this.player(pid).cash >= unmortgageCost(tile);
  }

  unmortgage(pid: number, tile: number): boolean {
    if (!this.canUnmortgage(pid, tile)) return false;
    this.state.props[tile].mortgaged = false;
    this.pay(pid, null, unmortgageCost(tile), `Paid off ${TILES[tile].name}`);
    this.emit({ type: 'mortgage', player: pid, tile, mortgaged: false });
    this.log(`${this.player(pid).name} paid off the mortgage on ${TILES[tile].name}.`);
    return true;
  }

  // ------------------------------------------------------------- debts

  /** Total the debtor still owes. */
  debtTotal(pid: number): number {
    return this.state.debts.filter((d) => d.from === pid).reduce((a, d) => a + d.amount, 0);
  }

  declareBankruptcy(): boolean {
    const s = this.state;
    if (s.phase !== 'debt' || !s.debts.length) return false;
    const p = this.player(s.debts[0].from);
    // A player creditor takes the estate ahead of the bank.
    const creditor = s.debts.find((d) => d.from === p.id && d.to !== null)?.to ?? null;
    // Liquidate buildings for their sale value.
    let sold = 0;
    for (const i of this.ownedBy(p.id)) {
      const o = s.props[i];
      if (o.houses) {
        sold += (o.houses * houseCost(i)) / 2;
        o.houses = 0;
      }
    }
    if (sold) {
      p.cash += sold;
      this.emit({ type: 'money', player: p.id, delta: sold, reason: 'Buildings sold' });
    }
    const cash = Math.max(0, Math.floor(p.cash));
    if (creditor !== null) {
      const c = this.player(creditor);
      c.cash += cash;
      if (cash) this.emit({ type: 'money', player: creditor, delta: cash, reason: `${p.name}'s remaining cash` });
      for (const i of this.ownedBy(p.id)) s.props[i].owner = creditor;
      c.jailCards.push(...p.jailCards);
      for (const g of this.fullSets(creditor)) {
        this.emit({ type: 'fullSet', player: creditor, group: g });
      }
    } else {
      for (const i of this.ownedBy(p.id)) delete s.props[i];
      for (const deck of p.jailCards) {
        const card = CARDS.find((c) => c.deck === deck && c.effect.type === 'jailFree')!;
        s.decks[deck].push(card.id);
      }
    }
    if (cash) this.emit({ type: 'money', player: p.id, delta: -cash, reason: 'Bankruptcy' });
    p.cash = 0;
    p.jailCards = [];
    p.bankrupt = true;
    p.inJail = false;
    // Debts from the bankrupt player are void, and so are debts owed to them.
    s.debts = s.debts.filter((d) => d.from !== p.id && d.to !== p.id);
    this.emit({ type: 'bankrupt', player: p.id, to: creditor });
    this.log(
      `${p.name} is bankrupt! ${creditor !== null ? `${this.player(creditor).name} takes everything.` : 'Their properties return to the bank.'}`,
    );
    if (this.checkGameOver()) return true;
    if (p.id === s.current) {
      s.phase = 'end';
      this.nextTurn();
    } else {
      this.settleDebts();
      if (s.debts.length) s.phase = 'debt';
      else s.phase = s.resume;
    }
    return true;
  }

  private checkGameOver(): boolean {
    const s = this.state;
    if (s.phase === 'gameover') return true;
    const alive = this.activePlayers();
    if (alive.length <= 1) {
      this.recordWorth();
      s.phase = 'gameover';
      s.winner = alive[0]?.id ?? null;
      this.emit({ type: 'gameover', winner: s.winner });
      if (s.winner !== null) this.log(`🏆 ${this.player(s.winner).name} wins the game!`);
      return true;
    }
    return false;
  }

  private finishByWorth(early = false) {
    const s = this.state;
    const ranked = this.activePlayers().sort((a, b) => this.netWorth(b.id) - this.netWorth(a.id));
    // A round-limit finish already recorded this round's values in nextTurn.
    if (early) this.recordWorth();
    s.phase = 'gameover';
    s.winner = ranked[0].id;
    this.emit({ type: 'gameover', winner: s.winner });
    const why = early ? 'Game ended early.' : 'Round limit reached.';
    this.log(`${why} 🏆 ${ranked[0].name} wins with a net worth of $${this.netWorth(ranked[0].id)}!`);
  }

  /** Ends the game now; the richest player wins. */
  forfeitToWorth() {
    if (this.state.phase !== 'gameover') this.finishByWorth(true);
  }

  // ------------------------------------------------------------- house rules: news, missions, cards

  /** Start of a round: old news expires and a new event may shake up rents or cash. */
  private breakingNews() {
    const s = this.state;
    s.news = (s.news ?? []).filter((n) => n.until >= s.round);
    const total = NEWS_EVENTS.reduce((t, e) => t + e.weight, 0);
    let r = this.random() * total;
    const ev = NEWS_EVENTS.find((e) => (r -= e.weight) < 0) ?? NEWS_EVENTS[NEWS_EVENTS.length - 1];
    const until = s.round + ev.rounds - 1;
    const alive = this.activePlayers();
    let text = '';
    switch (ev.kind) {
      case 'boom':
      case 'slump': {
        const groups = Object.keys(GROUPS);
        const g = groups[Math.floor(this.random() * groups.length)];
        const flavour = ev.flavours[Math.floor(this.random() * ev.flavours.length)];
        s.news.push({ target: g, mult: ev.mult, until });
        text = `📰 ${flavour} ${GROUPS[g].name}: rents ${ev.kind === 'boom' ? '×2' : 'halved'} for ${ev.rounds} rounds.`;
        break;
      }
      case 'fuel':
        s.news.push({ target: 'transit', mult: ev.mult, until });
        text = `📰 Fuel prices up: Skyport rents ×2 for ${ev.rounds} rounds.`;
        break;
      case 'strike':
        s.news.push({ target: 'transit', mult: 0, until });
        text = '📰 Strike! No Skyport rent this round.';
        break;
      case 'powercut':
        s.news.push({ target: 'utility', mult: 0, until });
        text = '📰 Power cut! No utility rent this round.';
        break;
      case 'bonus':
        text = `📰 Festival bonus: everyone collects $${NEWS_BONUS}.`;
        for (const p of alive) this.gain(p, NEWS_BONUS, 'Festival bonus');
        break;
      case 'tax':
        text = `📰 Tax season: everyone pays $${NEWS_TAX}.`;
        for (const p of alive) this.pay(p.id, null, Math.min(NEWS_TAX, p.cash), 'Tax season', true);
        break;
      case 'quiet':
        return;
    }
    this.emit({ type: 'news', text });
    this.log(text);
  }

  /** Gives every player a different secret mission. */
  private dealMissions() {
    const groups = this.shuffle(Object.keys(GROUPS));
    const kinds = this.shuffle(MISSION_KINDS);
    this.state.missions = this.state.players.map((_, i) => {
      const kind = kinds[i % kinds.length];
      return kind === 'set' ? { kind, group: groups[i], done: false } : { kind, done: false };
    });
  }

  /** Whether `pid` meets their mission right now. */
  private missionMet(pid: number): boolean {
    const m = this.state.missions?.[pid];
    if (!m) return false;
    const owned = this.ownedBy(pid);
    const count = (kind: string) => owned.filter((t) => TILES[t].kind === kind).length;
    switch (m.kind) {
      case 'set':
        return this.hasFullSet(pid, m.group!);
      case 'stations':
        return count('transit') >= 3;
      case 'utilities':
        return count('utility') >= 2;
      case 'cash':
        return this.player(pid).cash >= MISSION_CASH;
      case 'hotel':
        return owned.some((t) => this.state.props[t].houses === 5);
      case 'props':
        return owned.length >= MISSION_PROPS;
      case 'rent':
        return this.stats.rentGot[pid] >= MISSION_RENT;
    }
  }

  private checkMissions() {
    const s = this.state;
    if (!s.missions || s.phase === 'gameover') return;
    s.missions.forEach((m, pid) => {
      const p = s.players[pid];
      if (m.done || p.bankrupt || !this.missionMet(pid)) return;
      m.done = true;
      this.gain(p, MISSION_REWARD, 'Mission bonus');
      this.emit({ type: 'mission', player: pid });
      this.log(`🎯 ${p.name} completed a secret mission: ${missionText(m)}! +$${MISSION_REWARD}`);
    });
  }

  /** Deals a random action card if the hand has room. */
  private drawActionCard(p: Player, quiet = false) {
    const hand = this.state.hands?.[p.id];
    if (!hand || hand.length >= HAND_LIMIT) return;
    hand.push(ACTION_CARDS[Math.floor(this.random() * ACTION_CARDS.length)]);
    if (!quiet) this.log(`${p.name} got an action card.`);
  }

  /** Why `pid` can't play `card` now, or null if they can. */
  cardBlocker(pid: number, card: ActionCard): string | null {
    const s = this.state;
    if (!s.settings.actionCards || !s.hands?.[pid]?.includes(card)) return 'You don\'t have that card.';
    if (pid !== s.current || this.player(pid).bankrupt) return 'Cards are played on your own turn.';
    if (s.turnFx?.played) return 'One card per turn.';
    switch (card) {
      case 'boost':
      case 'holiday':
        if (s.phase !== 'roll' || this.player(pid).inJail) return 'Play this before you roll.';
        return null;
      case 'half':
        if (s.phase !== 'buy') return 'Play this when a city is for sale.';
        return null;
      case 'free': {
        if (s.phase !== 'roll' && s.phase !== 'end') return 'Play this on your turn, when you can build.';
        const can = BUYABLE.some((t) => {
          const own = s.props[t];
          if (!own || own.owner !== pid || TILES[t].kind !== 'property' || own.houses >= 5 || !this.hasFullSet(pid, TILES[t].group!)) return false;
          const group = this.sameGroupTiles(t).map((i) => s.props[i]);
          return !group.some((o) => o.mortgaged) && own.houses <= Math.min(...group.map((o) => o.houses));
        });
        return can ? null : 'You need a full colour set to build on.';
      }
    }
  }

  playCard(pid: number, card: ActionCard): boolean {
    if (this.cardBlocker(pid, card) !== null) return false;
    const s = this.state;
    const hand = s.hands![pid];
    hand.splice(hand.indexOf(card), 1);
    s.turnFx = { ...(s.turnFx ?? {}), played: true, [card]: true };
    this.emit({ type: 'actionCard', player: pid, card });
    this.log(`${this.player(pid).name} played ${CARD_NAMES[card]}.`);
    return true;
  }

  // ------------------------------------------------------------- trading

  canTradeNow(pid: number): boolean {
    const s = this.state;
    return pid === s.current && (s.phase === 'roll' || s.phase === 'end') && !this.player(pid).bankrupt;
  }

  /** Why the trade is invalid, or null if it can go ahead. */
  validateTrade(o: TradeOffer): string | null {
    const s = this.state;
    if (o.from === o.to) return 'Pick another player to trade with.';
    const a = this.player(o.from);
    const b = this.player(o.to);
    if (!a || !b || a.bankrupt || b.bankrupt) return 'That player is out of the game.';
    const check = (side: TradeSide, p: Player): string | null => {
      if (side.cash < 0 || side.cash > p.cash) return `${p.name} doesn't have that much cash.`;
      if (side.jailCards > p.jailCards.length) return `${p.name} doesn't have that many get-out cards.`;
      for (const t of side.tiles) {
        if (s.props[t]?.owner !== p.id) return `${p.name} doesn't own ${TILES[t].name}.`;
        if (this.sameGroupTiles(t).some((i) => (s.props[i]?.houses ?? 0) > 0))
          return `Sell the buildings in ${TILES[t].name}'s set before trading it.`;
      }
      return null;
    };
    const empty = (x: TradeSide) => x.cash === 0 && x.tiles.length === 0 && x.jailCards === 0;
    if (empty(o.give) && empty(o.get)) return 'The trade is empty.';
    return check(o.give, a) ?? check(o.get, b);
  }

  /** Applies a trade both sides agreed to. */
  executeTrade(o: TradeOffer): boolean {
    if (this.validateTrade(o)) return false;
    const s = this.state;
    const a = this.player(o.from);
    const b = this.player(o.to);
    const move = (side: TradeSide, from: Player, to: Player) => {
      if (side.cash) {
        from.cash -= side.cash;
        to.cash += side.cash;
        this.emit({ type: 'money', player: from.id, delta: -side.cash, reason: 'Trade' });
        this.emit({ type: 'money', player: to.id, delta: side.cash, reason: 'Trade' });
      }
      for (const t of side.tiles) s.props[t].owner = to.id;
      for (let k = 0; k < side.jailCards; k++) to.jailCards.push(from.jailCards.shift()!);
    };
    move(o.give, a, b);
    move(o.get, b, a);
    this.emit({ type: 'trade', offer: o, accepted: true });
    this.log(`${a.name} and ${b.name} made a trade.`);
    for (const t of [...o.give.tiles, ...o.get.tiles]) this.checkFullSet(s.props[t].owner, t);
    return true;
  }

  // ------------------------------------------------------------- persistence

  serialize(): string {
    return JSON.stringify(this.state);
  }

  static load(json: string): Game {
    const state = JSON.parse(json) as GameState;
    if (state.version !== 1) throw new Error('Unsupported save version');
    return new Game(state);
  }
}

interface LandOpts {
  cardBoost?: boolean;
  utilityRoll?: boolean;
}
