import { BUYABLE, GROUPS, JAIL_FINE, TILES, groupTiles, houseCost, mortgageValue, unmortgageCost } from './board';
import type { Game } from './engine';
import type { ActionCard, Difficulty, TradeOffer, TradeSide } from './types';

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
  | { type: 'trade'; offer: TradeOffer }
  | { type: 'playCard'; card: ActionCard };

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
  /** Extra share of a city's price asked for when selling it completes the buyer's set. */
  premium: number;
  /** Extra share of a city's price it will pay when buying it completes its own set. */
  pay: number;
  /** Extra share of a city's price asked for when selling it for cash (a little over market). */
  markup: number;
  /** Share of the trade's value it lets slide when a deal is nearly even. */
  tolerance: number;
  /** Share of the deal it adds (or, when negative, haggles off the other side's slack) when it proposes. */
  generosity: number;
  trades: boolean;
  maxHouses: number;
  mistakes: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: { reserve: 60, threatWeight: 0, setBonus: 1.2, blockBonus: 1, auctionFactor: 0.6, premium: 0.15, pay: 0.75, markup: 0, tolerance: 0.1, generosity: 0.1, trades: true, maxHouses: 2, mistakes: 0.3 },
  normal: { reserve: 90, threatWeight: 0.45, setBonus: 1.8, blockBonus: 1.3, auctionFactor: 1.0, premium: 0.35, pay: 1.0, markup: 0.05, tolerance: 0.02, generosity: 0, trades: true, maxHouses: 5, mistakes: 0.12 },
  hard: { reserve: 25, threatWeight: 0.6, setBonus: 2.0, blockBonus: 1.3, auctionFactor: 1.0, premium: 0.6, pay: 1.2, markup: 0.1, tolerance: 0, generosity: -1, trades: true, maxHouses: 5, mistakes: 0 },
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
    const ours = (i: number) => {
      const o = g.ownerOf(i);
      return o !== null && g.sameTeam(pid, o);
    };
    const mine = others.filter(ours).length;
    if (mine === others.length) v *= prof.setBonus;
    else if (mine > 0) v *= 1.2;
    const owners = new Set(others.map((i) => g.ownerOf(i)));
    if (owners.size === 1) {
      const o = [...owners][0];
      if (o !== null && !g.sameTeam(pid, o)) v *= prof.blockBonus;
    }
  } else if (def.kind === 'transit') {
    const n = BUYABLE.filter((i) => TILES[i].kind === 'transit' && g.ownerOf(i) === pid && i !== tile).length;
    v *= 1 + 0.2 * n;
  } else if (def.kind === 'utility') {
    v *= 0.75;
  }
  // A secret mission makes its targets worth more to the player chasing it.
  const m = g.state.missions?.[pid];
  if (m && !m.done) {
    const hit =
      (m.kind === 'set' && def.group === m.group) ||
      (m.kind === 'stations' && def.kind === 'transit') ||
      (m.kind === 'utilities' && def.kind === 'utility') ||
      m.kind === 'props';
    if (hit) v *= 1.3;
  }
  return v;
}

const hasCard = (g: Game, pid: number, card: ActionCard) => g.cardBlocker(pid, card) === null;

/** Expected rent owed on the next roll from `pid`'s position (2d6 odds), for the Rent holiday card. */
function rentRisk(g: Game, pid: number): number {
  const p = g.player(pid);
  let risk = 0;
  for (let total = 2; total <= 12; total++) {
    const odds = (6 - Math.abs(7 - total)) / 36;
    const tile = (p.pos + total) % 40;
    const owner = g.ownerOf(tile);
    if (owner !== null && owner !== pid) risk += odds * g.rentFor(tile, total);
  }
  return risk;
}

/**
 * What a trade is worth to `pid` (either side of it), in money. Everything counts at market
 * value. A seller asks a little over market for its cities (more on harder levels) and a bit
 * extra for a city that completes the other side's set; a buyer will pay extra for one that
 * completes its own; breaking up your own set costs the whole set's price. When the trade
 * completes a set for both sides, it is a straight swap at market value. Humans are judged
 * like a normal computer player.
 */
export function dealValue(g: Game, offer: TradeOffer, pid: number): { net: number; size: number } {
  const meFrom = offer.from === pid;
  const other = meFrom ? offer.to : offer.from;
  const gets = meFrom ? offer.get : offer.give;
  const gives = meFrom ? offer.give : offer.get;
  const prof = g.player(pid).ai ? profileOf(g, pid) : PROFILES.normal;
  const worth = (t: number) => TILES[t].price! - (g.state.props[t]?.mortgaged ? unmortgageCost(t) : 0);
  const value = (side: TradeSide) => side.cash + 50 * side.jailCards + side.tiles.reduce((a, t) => a + worth(t), 0);
  const after = (i: number) => (offer.give.tiles.includes(i) ? offer.to : offer.get.tiles.includes(i) ? offer.from : g.ownerOf(i));
  const before = (i: number) => g.ownerOf(i);
  const full = (who: number, gid: string, owner: (i: number) => number | null) =>
    groupTiles(gid).every((i) => {
      const o = owner(i);
      return o !== null && g.sameTeam(who, o);
    });
  const price = (ts: number[]) => ts.reduce((a, t) => a + TILES[t].price!, 0);
  const completes = (who: number) => Object.keys(GROUPS).some((gid) => full(who, gid, after) && !full(who, gid, before));
  const mutual = completes(pid) && completes(other);
  let premium = mutual ? 0 : -prof.markup * price(gives.tiles);
  for (const gid of Object.keys(GROUPS)) {
    const tiles = groupTiles(gid);
    const got = gets.tiles.filter((t) => tiles.includes(t));
    const gave = gives.tiles.filter((t) => tiles.includes(t));
    if (!got.length && !gave.length) continue;
    if (gave.length && full(pid, gid, before) && !full(pid, gid, after)) premium -= price(tiles);
    if (mutual) continue;
    if (gave.length && full(other, gid, after) && !full(other, gid, before)) premium -= prof.premium * price(gave);
    if (got.length && full(pid, gid, after) && !full(pid, gid, before)) premium += prof.pay * price(got);
  }
  const vin = value(gets);
  const vout = value(gives);
  return { net: vin - vout + premium, size: Math.max(vin, vout) };
}

/**
 * How much more (in money) AI player `offer.to` wants before it says yes; 0 when the
 * deal is already fair enough for it. A small slack lets nearly even deals through.
 */
export function tradeShortfall(g: Game, offer: TradeOffer): number {
  if (g.sameTeam(offer.from, offer.to)) return 0;
  const { net, size } = dealValue(g, offer, offer.to);
  const slack = slackOf(g, offer.to, size);
  return net + slack >= 0 ? 0 : Math.ceil(-(net + slack) / 10) * 10;
}

/** How far below even a player lets a deal of this size go. */
function slackOf(g: Game, pid: number, size: number): number {
  const prof = g.player(pid).ai ? profileOf(g, pid) : PROFILES.normal;
  return prof.tolerance * size + (prof.tolerance > 0 ? 10 : 0);
}

const cashOk = (g: Game, offer: TradeOffer) => {
  const b = g.player(offer.to);
  return b.cash - offer.get.cash + offer.give.cash >= Math.min(b.cash, profileOf(g, offer.to).reserve);
};

/**
 * How an AI player would answer a trade, for the live hint in the trade window. Mirrors
 * acceptsTrade: 'yes' means it would accept as it stands.
 */
export function tradeOutlook(g: Game, offer: TradeOffer): 'yes' | 'close' | 'no' | 'cash' | 'nothing' {
  if (g.validateTrade(offer)) return 'nothing';
  if (g.sameTeam(offer.from, offer.to)) return 'yes';
  if (!cashOk(g, offer)) return 'cash';
  const short = tradeShortfall(g, offer);
  if (short === 0) return 'yes';
  return short <= Math.max(50, 0.15 * dealValue(g, offer, offer.to).size) ? 'close' : 'no';
}

/** Whether AI player `offer.to` accepts the trade. */
export function acceptsTrade(g: Game, offer: TradeOffer): boolean {
  if (g.validateTrade(offer)) return false;
  // Teammates help each other.
  if (g.sameTeam(offer.from, offer.to)) return true;
  return cashOk(g, offer) && tradeShortfall(g, offer) === 0;
}

const emptySide = (): TradeSide => ({ cash: 0, tiles: [], jailCards: 0 });

/** Looks for a fair trade that would complete one of the AI's sets. */
function findTrade(g: Game, pid: number, mem: AiMemory): TradeOffer | null {
  const me = g.player(pid);
  const reserve = reserveFor(g, pid);
  for (const gid of Object.keys(GROUPS)) {
    const tiles = groupTiles(gid);
    const mine = tiles.filter((i) => g.ownerOf(i) === pid);
    const missing = tiles.filter((i) => g.ownerOf(i) !== pid);
    if (mine.length === 0 || missing.length === 0 || missing.length > 2) continue;
    // Everything we're missing must sit with one other player.
    const target = missing[0];
    const holder = g.ownerOf(target);
    if (holder === null || missing.some((i) => g.ownerOf(i) !== holder)) continue;
    if (tiles.some((i) => (g.state.props[i]?.houses ?? 0) > 0)) continue;
    const key = `${holder}:${target}`;
    if (mem.offers[key] !== undefined && g.state.turnCount - mem.offers[key] < 12) continue;
    mem.offers[key] = g.state.turnCount;

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

    // Offer what's fair to them, and keep it only if it's still good for us. Easy players
    // round up generously; hard players haggle right down to what the other side would accept.
    const prof = profileOf(g, pid);
    let best: { offer: TradeOffer; net: number } | null = null;
    for (const withProp of sweetener !== undefined ? [true, false] : [false]) {
      const offer: TradeOffer = { from: pid, to: holder, give: { ...emptySide(), tiles: withProp ? [sweetener!] : [] }, get: { ...emptySide(), tiles: missing } };
      const { net, size } = dealValue(g, offer, holder);
      const want = -net + (prof.generosity >= 0 ? prof.generosity * size : -slackOf(g, holder, size));
      offer.give.cash = want <= 0 ? 0 : Math.ceil(want / 10) * 10;
      if (offer.give.cash > Math.max(0, me.cash - reserve) || g.validateTrade(offer)) continue;
      const mineNet = dealValue(g, offer, pid).net;
      if (mineNet > 0 && (!best || mineNet > best.net)) best = { offer, net: mineNet };
    }
    if (best) return best.offer;
  }
  return null;
}

function bestBuild(g: Game, pid: number): number | null {
  const prof = profileOf(g, pid);
  const reserve = reserveFor(g, pid);
  let best: number | null = null;
  let bestScore = -1;
  const full = new Set(g.fullSets(pid).flatMap((gid) => groupTiles(gid)));
  // Early building (house rule) also allows single cities; only worth it with cash to spare.
  const candidates = g.state.settings.earlyBuild ? g.ownedBy(pid).filter((t) => TILES[t].kind === 'property') : [...full];
  for (const t of candidates) {
    if (!g.canBuild(pid, t)) continue;
    const o = g.state.props[t];
    if (o.houses >= prof.maxHouses) continue;
    const cost = houseCost(t);
    const spare = full.has(t) ? reserve : reserve * 2 + 200;
    if (g.player(pid).cash - cost < spare) continue;
    const rents = TILES[t].rents!;
    const base = o.houses > 0 ? rents[o.houses] : full.has(t) ? rents[0] * 2 : rents[0];
    const score = (rents[o.houses + 1] - base) / cost + (o.houses < 3 ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = t;
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
    if (t !== null && hasCard(g, pid, 'free')) return { type: 'playCard', card: 'free' };
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
      if (a.bidder !== null && a.bidder !== pid && g.sameTeam(pid, a.bidder)) return { type: 'pass' };
      const value = tileValue(g, pid, a.tile) * prof.auctionFactor;
      const limit = Math.min(value, p.cash - Math.min(reserve, 60));
      const min = g.minBid();
      // Worth stretching for (completes or blocks a set): mortgage a loose property first.
      if (min > limit && min <= value && value >= (TILES[a.tile].price ?? 0) * 1.3) {
        const loose = g
          .ownedBy(pid)
          .filter((t) => g.canMortgage(pid, t) && !(TILES[t].group && g.hasFullSet(pid, TILES[t].group!)) && t !== a.tile)
          .sort((x, y) => tileValue(g, pid, x) - tileValue(g, pid, y));
        if (loose.length) return { type: 'mortgage', tile: loose[0] };
      }
      if (min > limit) return { type: 'pass' };
      const step = 10 * (1 + Math.floor(g.random() * 3));
      const amount = Math.min(Math.floor(limit), Math.max(min, a.bid + step));
      return { type: 'bid', amount };
    }

    case 'buy': {
      const tile = p.pos;
      // A Half price card is worth playing on anything worth owning.
      if (hasCard(g, pid, 'half') && tileValue(g, pid, tile) >= TILES[tile].price! * 0.8 && p.cash >= TILES[tile].price! / 2) return { type: 'playCard', card: 'half' };
      const price = g.buyPrice();
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
      if (!p.inJail && hasCard(g, pid, 'holiday') && rentRisk(g, pid) >= 60) return { type: 'playCard', card: 'holiday' };
      if (!p.inJail && hasCard(g, pid, 'boost') && (g.state.hands?.[pid]?.length ?? 0) >= 3) return { type: 'playCard', card: 'boost' };
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
    case 'playCard':
      return g.playCard(pid, a.card);
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
