import { BUYABLE, GROUPS, JAIL_FINE, TILES, groupTiles, houseCost, mortgageValue, unmortgageCost } from './board';
import type { Game } from './engine';
import type { Difficulty, TradeOffer, TradeSide } from './types';

export type AiAction =
  | { type: 'roll' }
  | { type: 'payJail' }
  | { type: 'useCard' }
  | { type: 'buy' }
  | { type: 'decline' }
  | { type: 'bid'; amount: number }
  | { type: 'pass' }
  | { type: 'build'; tile: number }
  | { type: 'sell'; tile: number }
  | { type: 'mortgage'; tile: number }
  | { type: 'unmortgage'; tile: number }
  | { type: 'bankrupt' }
  | { type: 'endTurn' }
  | { type: 'trade'; offer: TradeOffer };

/** Per-player memory so the AI doesn't spam the same trade every turn. */
export interface AiMemory {
  tradeTurn: number;
  offers: Record<string, number>;
  builds: number;
}

export const newMemory = (): AiMemory => ({ tradeTurn: -1, offers: {}, builds: 0 });

interface Profile {
  reserve: number;
  threatWeight: number;
  setBonus: number;
  blockBonus: number;
  auctionFactor: number;
  fairness: number;
  trades: boolean;
  maxHouses: number;
  mistakes: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: { reserve: 60, threatWeight: 0, setBonus: 1.2, blockBonus: 1, auctionFactor: 0.6, fairness: 0.3, trades: false, maxHouses: 2, mistakes: 0.3 },
  normal: { reserve: 90, threatWeight: 0.45, setBonus: 1.8, blockBonus: 1.3, auctionFactor: 1.0, fairness: 0.75, trades: true, maxHouses: 4, mistakes: 0.12 },
  hard: { reserve: 25, threatWeight: 0.6, setBonus: 2.0, blockBonus: 1.3, auctionFactor: 1.0, fairness: 1.0, trades: true, maxHouses: 5, mistakes: 0 },
};

const profileOf = (g: Game, pid: number) => PROFILES[g.player(pid).difficulty] ?? PROFILES.normal;

/** The highest rent an opponent's developed property could charge, as a measure of danger. */
function threat(g: Game, pid: number): number {
  let worst = 0;
  for (const i of BUYABLE) {
    const o = g.state.props[i];
    if (!o || o.owner === pid || o.mortgaged) continue;
    worst = Math.max(worst, g.rentFor(i, 7));
  }
  return worst;
}

export function reserveFor(g: Game, pid: number): number {
  const prof = profileOf(g, pid);
  return Math.round(prof.reserve + Math.min(800, threat(g, pid)) * prof.threatWeight);
}

/** How much a single tile is worth to `pid`, considering sets it completes or blocks. */
export function tileValue(g: Game, pid: number, tile: number): number {
  const def = TILES[tile];
  const prof = profileOf(g, pid);
  let v = def.price ?? 0;
  if (def.kind === 'property') {
    const others = groupTiles(def.group!).filter((i) => i !== tile);
    const mine = others.filter((i) => g.ownerOf(i) === pid).length;
    if (mine === others.length) v *= prof.setBonus;
    else if (mine > 0) v *= 1.2;
    const owners = new Set(others.map((i) => g.ownerOf(i)));
    if (owners.size === 1) {
      const o = [...owners][0];
      if (o !== null && o !== pid) v *= prof.blockBonus;
    }
  } else if (def.kind === 'transit') {
    const n = BUYABLE.filter((i) => TILES[i].kind === 'transit' && g.ownerOf(i) === pid && i !== tile).length;
    v *= 1 + 0.2 * n;
  } else if (def.kind === 'utility') {
    v *= 0.75;
  }
  return v;
}

/** Strategic worth of a player's portfolio, used to compare trades. */
function portfolio(g: Game, pid: number, owner: (tile: number) => number | null, cash: number): number {
  let total = cash;
  for (const gid of Object.keys(GROUPS)) {
    const tiles = groupTiles(gid);
    const mine = tiles.filter((i) => owner(i) === pid);
    if (!mine.length) continue;
    const sum = mine.reduce((a, i) => a + TILES[i].price! * (g.state.props[i]?.mortgaged ? 0.6 : 1), 0);
    const mult = mine.length === tiles.length ? 2.6 : 1 + 0.15 * (mine.length - 1);
    total += sum * mult;
  }
  const transit = BUYABLE.filter((i) => TILES[i].kind === 'transit' && owner(i) === pid).length;
  total += transit * 200 * (1 + 0.25 * Math.max(0, transit - 1));
  const util = BUYABLE.filter((i) => TILES[i].kind === 'utility' && owner(i) === pid).length;
  total += util * 150 * (util === 2 ? 1.3 : 1) * 0.8;
  return total;
}

/** Change in strategic worth for both sides if the trade went through. */
export function tradeGains(g: Game, offer: TradeOffer): { from: number; to: number } {
  const before = (i: number) => g.ownerOf(i);
  const after = (i: number) => {
    if (offer.give.tiles.includes(i)) return offer.to;
    if (offer.get.tiles.includes(i)) return offer.from;
    return g.ownerOf(i);
  };
  const a = g.player(offer.from);
  const b = g.player(offer.to);
  const jail = 50;
  const aCashAfter = a.cash - offer.give.cash + offer.get.cash + jail * (offer.get.jailCards - offer.give.jailCards);
  const bCashAfter = b.cash - offer.get.cash + offer.give.cash + jail * (offer.give.jailCards - offer.get.jailCards);
  return {
    from: portfolio(g, a.id, after, aCashAfter) - portfolio(g, a.id, before, a.cash),
    to: portfolio(g, b.id, after, bCashAfter) - portfolio(g, b.id, before, b.cash),
  };
}

/** Whether AI player `offer.to` accepts the trade. */
export function acceptsTrade(g: Game, offer: TradeOffer): boolean {
  if (g.validateTrade(offer)) return false;
  const prof = profileOf(g, offer.to);
  const gains = tradeGains(g, offer);
  if (gains.to <= 0) return false;
  const b = g.player(offer.to);
  const cashAfter = b.cash - offer.get.cash + offer.give.cash;
  if (cashAfter < Math.min(b.cash, prof.reserve)) return false;
  return gains.to >= gains.from * prof.fairness;
}

const emptySide = (): TradeSide => ({ cash: 0, tiles: [], jailCards: 0 });

/** Looks for a trade that would complete one of the AI's sets. */
function findTrade(g: Game, pid: number, mem: AiMemory): TradeOffer | null {
  const me = g.player(pid);
  const reserve = reserveFor(g, pid);
  for (const gid of Object.keys(GROUPS)) {
    const tiles = groupTiles(gid);
    const mine = tiles.filter((i) => g.ownerOf(i) === pid);
    const missing = tiles.filter((i) => g.ownerOf(i) !== pid);
    if (mine.length === 0 || missing.length === 0 || missing.length > 1) continue;
    const target = missing[0];
    const holder = g.ownerOf(target);
    if (holder === null) continue;
    if (tiles.some((i) => (g.state.props[i]?.houses ?? 0) > 0)) continue;
    const key = `${holder}:${target}`;
    if (mem.offers[key] !== undefined && g.state.turnCount - mem.offers[key] < 12) continue;

    // Sweeten with a property that doesn't hand them a full set, if we have one.
    const sweetener = g
      .ownedBy(pid)
      .filter((t) => TILES[t].group !== gid && !g.state.props[t].mortgaged)
      .filter((t) => {
        const tg = TILES[t].group;
        if (!tg) return TILES[t].kind !== 'transit';
        if (groupTiles(tg).some((i) => (g.state.props[i]?.houses ?? 0) > 0)) return false;
        return !groupTiles(tg).every((i) => i === t || g.ownerOf(i) === holder) && !g.hasFullSet(pid, tg);
      })
      .sort((x, y) => TILES[x].price! - TILES[y].price!)[0];

    for (const withProp of sweetener !== undefined ? [true, false] : [false]) {
      const give: TradeSide = { ...emptySide(), tiles: withProp ? [sweetener!] : [] };
      const get: TradeSide = { ...emptySide(), tiles: [target] };
      const maxCash = Math.max(0, me.cash - reserve);
      for (let cash = 0; cash <= maxCash; cash += 25) {
        give.cash = cash;
        const offer: TradeOffer = { from: pid, to: holder, give: { ...give }, get: { ...get } };
        if (g.validateTrade(offer)) break;
        const gains = tradeGains(g, offer);
        if (gains.from <= 0) break;
        // Pretend the receiver is a normal-strength player to price the offer.
        const fair = gains.to > 0 && gains.to >= gains.from * PROFILES.normal.fairness;
        if (fair) {
          mem.offers[key] = g.state.turnCount;
          return offer;
        }
      }
    }
    mem.offers[key] = g.state.turnCount;
  }
  return null;
}

function bestBuild(g: Game, pid: number): number | null {
  const prof = profileOf(g, pid);
  const reserve = reserveFor(g, pid);
  let best: number | null = null;
  let bestScore = -1;
  for (const gid of g.fullSets(pid)) {
    for (const t of groupTiles(gid)) {
      if (!g.canBuild(pid, t)) continue;
      const o = g.state.props[t];
      if (o.houses >= prof.maxHouses) continue;
      const cost = houseCost(t);
      if (g.player(pid).cash - cost < reserve) continue;
      const rents = TILES[t].rents!;
      const gain = rents[o.houses + 1] - (o.houses === 0 ? rents[0] * 2 : rents[o.houses]);
      const score = gain / cost + (o.houses < 3 ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
  }
  return best;
}

/** Optional housekeeping on the AI's own turn: build, pay off mortgages, trade. */
function manage(g: Game, pid: number, mem: AiMemory): AiAction | null {
  const p = g.player(pid);
  const prof = profileOf(g, pid);
  const reserve = reserveFor(g, pid);

  // Pay off mortgages inside full sets first so they can be built on.
  const mortgaged = g.ownedBy(pid).filter((t) => g.state.props[t].mortgaged);
  const inSets = mortgaged.filter((t) => TILES[t].group && g.hasFullSet(pid, TILES[t].group!));
  for (const t of inSets) {
    if (p.cash - unmortgageCost(t) >= reserve) return { type: 'unmortgage', tile: t };
  }

  if (mem.builds < 12) {
    const t = bestBuild(g, pid);
    if (t !== null) {
      mem.builds++;
      return { type: 'build', tile: t };
    }
  }

  for (const t of mortgaged) {
    if (p.cash - unmortgageCost(t) >= reserve * 2 + 100) return { type: 'unmortgage', tile: t };
  }

  if (prof.trades && mem.tradeTurn !== g.state.turnCount && g.canTradeNow(pid)) {
    mem.tradeTurn = g.state.turnCount;
    const offer = findTrade(g, pid, mem);
    if (offer) return { type: 'trade', offer };
  }
  return null;
}

/** Picks the next step to get out of debt: mortgage loose properties, sell houses, then the rest. */
function raiseFunds(g: Game, pid: number): AiAction {
  const owned = g.ownedBy(pid);
  const value = (t: number) => tileValue(g, pid, t);
  const loose = owned
    .filter((t) => g.canMortgage(pid, t) && !(TILES[t].group && g.hasFullSet(pid, TILES[t].group!)))
    .sort((a, b) => value(a) - value(b));
  if (loose.length) return { type: 'mortgage', tile: loose[0] };
  const sellable = owned.filter((t) => g.canSell(pid, t)).sort((a, b) => houseCost(a) - houseCost(b));
  if (sellable.length) return { type: 'sell', tile: sellable[0] };
  const rest = owned.filter((t) => g.canMortgage(pid, t)).sort((a, b) => mortgageValue(a) - mortgageValue(b));
  if (rest.length) return { type: 'mortgage', tile: rest[0] };
  return { type: 'bankrupt' };
}

function unownedLeft(g: Game): number {
  return BUYABLE.filter((i) => g.ownerOf(i) === null).length;
}

/** Decides the next action for AI player `pid`, who must be the game's current actor. */
export function decide(g: Game, pid: number, mem: AiMemory): AiAction {
  const s = g.state;
  const p = g.player(pid);
  const prof = profileOf(g, pid);
  const reserve = reserveFor(g, pid);

  switch (s.phase) {
    case 'debt':
      return raiseFunds(g, pid);

    case 'auction': {
      const a = s.auction!;
      const value = tileValue(g, pid, a.tile) * prof.auctionFactor;
      const limit = Math.min(value, p.cash - Math.min(reserve, 60));
      const min = g.minBid();
      if (min > limit) return { type: 'pass' };
      const step = 10 * (1 + Math.floor(g.random() * 3));
      const amount = Math.min(Math.floor(limit), Math.max(min, a.bid + step));
      return { type: 'bid', amount };
    }

    case 'buy': {
      const tile = p.pos;
      const price = TILES[tile].price!;
      if (p.cash < price) return { type: 'decline' };
      if (g.random() < prof.mistakes) return { type: 'decline' };
      const v = tileValue(g, pid, tile);
      const keen = v > price * 1.25;
      const need = keen ? Math.min(reserve, 40) : reserve;
      return p.cash - price >= need ? { type: 'buy' } : { type: 'decline' };
    }

    case 'roll': {
      const m = manage(g, pid, mem);
      if (m) return m;
      if (p.inJail) {
        const lateGame = unownedLeft(g) < 6 && threat(g, pid) > 300;
        if (!lateGame) {
          if (p.jailCards.length) return { type: 'useCard' };
          if (p.cash >= JAIL_FINE + reserve) return { type: 'payJail' };
        }
      }
      return { type: 'roll' };
    }

    case 'end': {
      const m = manage(g, pid, mem);
      if (m) return m;
      mem.builds = 0;
      return { type: 'endTurn' };
    }

    default:
      return { type: 'endTurn' };
  }
}

/** Applies an action to the game. Trades are executed only if the receiver is an AI that accepts. */
export function apply(g: Game, pid: number, a: AiAction): boolean {
  switch (a.type) {
    case 'roll':
      return g.roll() !== null;
    case 'payJail':
      return g.payJailFine();
    case 'useCard':
      return g.useJailCard();
    case 'buy':
      return g.buy();
    case 'decline':
      return g.decline();
    case 'bid':
      return g.bid(pid, a.amount);
    case 'pass':
      return g.passBid(pid);
    case 'build':
      return g.build(pid, a.tile);
    case 'sell':
      return g.sell(pid, a.tile);
    case 'mortgage':
      return g.mortgage(pid, a.tile);
    case 'unmortgage':
      return g.unmortgage(pid, a.tile);
    case 'bankrupt':
      return g.declareBankruptcy();
    case 'endTurn':
      return g.endTurn();
    case 'trade':
      return acceptsTrade(g, a.offer) && g.executeTrade(a.offer);
  }
}

/** Something guaranteed to move the game forward if the chosen action was rejected. */
export function fallback(g: Game, pid: number): AiAction {
  switch (g.state.phase) {
    case 'roll':
      return { type: 'roll' };
    case 'buy':
      return { type: 'decline' };
    case 'auction':
      return { type: 'pass' };
    case 'debt':
      return raiseFunds(g, pid);
    default:
      return { type: 'endTurn' };
  }
}
