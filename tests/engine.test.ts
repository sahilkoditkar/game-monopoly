import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/engine';
import { JAIL_INDEX, TILES, rentTable } from '../src/game/board';
import type { PlayerConfig } from '../src/game/types';

const players = (n: number): PlayerConfig[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, token: '🚀', color: '#fff', ai: false }));

function setup(n = 2, settings = {}) {
  const g = Game.create(players(n), { jackpot: false, ...settings }, 42);
  g.drain();
  return g;
}

function own(g: Game, pid: number, ...tiles: number[]) {
  for (const t of tiles) g.state.props[t] = { owner: pid, houses: 0, mortgaged: false };
}

describe('board', () => {
  it('has 40 tiles in order with 28 buyable', () => {
    expect(TILES).toHaveLength(40);
    TILES.forEach((t, i) => expect(t.index).toBe(i));
    expect(TILES.filter((t) => t.price).length).toBe(28);
  });

  it('rent tables grow with buildings', () => {
    for (const t of TILES.filter((x) => x.rents)) {
      const r = t.rents!;
      for (let k = 1; k < r.length; k++) expect(r[k]).toBeGreaterThan(r[k - 1]);
    }
    expect(rentTable(60)[0]).toBe(5);
  });
});

describe('movement and buying', () => {
  it('moves by the dice and offers to buy', () => {
    const g = setup();
    g.forcedDice.push([1, 2]);
    g.roll();
    expect(g.cur.pos).toBe(3);
    expect(g.state.phase).toBe('buy');
    expect(g.buy()).toBe(true);
    expect(g.ownerOf(3)).toBe(0);
    expect(g.cur.cash).toBe(1500 - 70);
    expect(g.state.phase).toBe('end');
    expect(g.endTurn()).toBe(true);
    expect(g.state.current).toBe(1);
  });

  it('pays salary when passing the Launch Pad', () => {
    const g = setup();
    g.cur.pos = 38;
    g.forcedDice.push([2, 3]);
    g.roll();
    expect(g.cur.pos).toBe(3);
    expect(g.cur.cash).toBe(1700);
    const moves = g.drain().filter((e) => e.type === 'move');
    expect(moves.length).toBe(2);
  });

  it('charges rent, doubled for a full set without houses', () => {
    const g = setup();
    own(g, 1, 1);
    g.forcedDice.push([0, 1] as [number, number]);
    g.roll();
    expect(g.player(1).cash).toBe(1505);
    const g2 = setup();
    own(g2, 1, 1, 3);
    g2.forcedDice.push([0, 1] as [number, number]);
    g2.roll();
    expect(g2.player(1).cash).toBe(1510);
  });

  it('gives another roll on doubles and jails on the third', () => {
    const g = setup();
    g.forcedDice.push([3, 3], [2, 2], [1, 1]);
    g.roll();
    if (g.state.phase === 'buy') g.decline();
    while (g.state.phase === 'auction') g.passBid(g.actor());
    expect(g.state.phase).toBe('roll');
    g.roll();
    if (g.state.phase === 'buy') g.decline();
    while (g.state.phase === 'auction') g.passBid(g.actor());
    expect(g.state.phase).toBe('roll');
    g.roll();
    expect(g.cur.inJail).toBe(true);
    expect(g.cur.pos).toBe(JAIL_INDEX);
    expect(g.state.phase).toBe('end');
  });
});

describe('jail', () => {
  it('can pay the fine to leave', () => {
    const g = setup(2, { jackpot: true });
    g.cur.inJail = true;
    g.cur.pos = JAIL_INDEX;
    expect(g.payJailFine()).toBe(true);
    expect(g.cur.inJail).toBe(false);
    expect(g.cur.cash).toBe(1450);
    expect(g.state.jackpot).toBe(50);
  });

  it('forces the fine after three failed rolls', () => {
    const g = setup();
    const p = g.cur;
    p.inJail = true;
    p.pos = JAIL_INDEX;
    for (let k = 0; k < 2; k++) {
      g.forcedDice.push([1, 2]);
      g.roll();
      expect(p.inJail).toBe(true);
      g.endTurn();
      g.forcedDice.push([1, 2]);
      g.roll();
      if (g.state.phase === 'buy') g.decline();
      while (g.state.phase === 'auction') g.passBid(g.actor());
      g.endTurn();
    }
    g.forcedDice.push([1, 2]);
    g.roll();
    expect(p.inJail).toBe(false);
    expect(p.pos).toBe(13);
  });

  it('leaves on doubles without another roll', () => {
    const g = setup();
    g.cur.inJail = true;
    g.cur.pos = JAIL_INDEX;
    g.forcedDice.push([2, 2]);
    g.roll();
    expect(g.cur.inJail).toBe(false);
    expect(g.cur.pos).toBe(14);
    g.decline();
    while (g.state.phase === 'auction') g.passBid(g.actor());
    expect(g.state.phase).toBe('end');
  });
});

describe('auctions', () => {
  it('sells to the highest bidder', () => {
    const g = setup(3);
    g.forcedDice.push([1, 2]);
    g.roll();
    g.decline();
    expect(g.state.phase).toBe('auction');
    expect(g.actor()).toBe(1);
    expect(g.bid(1, 20)).toBe(true);
    expect(g.actor()).toBe(2);
    expect(g.bid(2, 30)).toBe(true);
    expect(g.actor()).toBe(0);
    expect(g.passBid(0)).toBe(true);
    expect(g.actor()).toBe(1);
    expect(g.passBid(1)).toBe(true);
    expect(g.ownerOf(3)).toBe(2);
    expect(g.player(2).cash).toBe(1470);
    expect(g.state.phase).toBe('end');
  });

  it('stays unowned when nobody bids', () => {
    const g = setup(2);
    g.forcedDice.push([1, 2]);
    g.roll();
    g.decline();
    g.passBid(g.actor());
    g.passBid(g.actor());
    expect(g.ownerOf(3)).toBe(null);
    expect(g.state.phase).toBe('end');
  });
});

describe('building and mortgages', () => {
  it('requires a full set and even building', () => {
    const g = setup();
    own(g, 0, 1);
    expect(g.canBuild(0, 1)).toBe(false);
    own(g, 0, 3);
    expect(g.build(0, 1)).toBe(true);
    expect(g.canBuild(0, 1)).toBe(false);
    expect(g.build(0, 3)).toBe(true);
    expect(g.canBuild(0, 1)).toBe(true);
    expect(g.cur.cash).toBe(1400);
    expect(g.rentFor(1, 7)).toBe(TILES[1].rents![1]);
  });

  it('blocks mortgaging while the set has buildings', () => {
    const g = setup();
    own(g, 0, 1, 3);
    g.build(0, 1);
    expect(g.canMortgage(0, 3)).toBe(false);
    expect(g.canSell(0, 1)).toBe(true);
    g.sell(0, 1);
    expect(g.mortgage(0, 3)).toBe(true);
    expect(g.cur.cash).toBe(1500 - 50 + 25 + 35);
    expect(g.rentFor(3, 7)).toBe(0);
    expect(g.unmortgage(0, 3)).toBe(true);
    expect(g.cur.cash).toBe(1510 - 39);
  });
});

describe('cards', () => {
  it('applies money and movement cards', () => {
    const g = setup();
    g.state.decks.treasury = ['t2', ...g.state.decks.treasury.filter((c) => c !== 't2')];
    g.forcedDice.push([1, 1]);
    g.roll();
    expect(g.cur.cash).toBe(1700);
    expect(g.state.decks.treasury.at(-1)).toBe('t2');
  });

  it('sends the player back three spaces', () => {
    const g = setup();
    g.state.decks.fortune = ['f10', ...g.state.decks.fortune.filter((c) => c !== 'f10')];
    g.forcedDice.push([3, 4]);
    g.roll();
    expect(g.cur.pos).toBe(4);
    expect(g.cur.cash).toBe(1300);
  });

  it('keeps get-out cards and returns them when used', () => {
    const g = setup();
    g.state.decks.fortune = ['f12', ...g.state.decks.fortune.filter((c) => c !== 'f12')];
    g.forcedDice.push([3, 4]);
    g.roll();
    expect(g.cur.jailCards).toEqual(['fortune']);
    expect(g.state.decks.fortune).not.toContain('f12');
    g.cur.inJail = true;
    g.state.phase = 'roll';
    expect(g.useJailCard()).toBe(true);
    expect(g.state.decks.fortune.at(-1)).toBe('f12');
  });

  it('collects from every player on a birthday', () => {
    const g = setup(3);
    g.state.decks.treasury = ['t7', ...g.state.decks.treasury.filter((c) => c !== 't7')];
    g.forcedDice.push([1, 1]);
    g.roll();
    expect(g.cur.cash).toBe(1520);
    expect(g.player(1).cash).toBe(1490);
  });
});

describe('debt and bankruptcy', () => {
  it('requires raising funds and allows bankruptcy to the creditor', () => {
    const g = setup();
    own(g, 1, 37, 39);
    g.state.props[39].houses = 5;
    g.state.props[37].houses = 4;
    g.cur.cash = 100;
    own(g, 0, 1);
    g.cur.pos = 34;
    g.forcedDice.push([2, 3]);
    g.roll();
    expect(g.state.phase).toBe('debt');
    expect(g.actor()).toBe(0);
    expect(g.mortgage(0, 1)).toBe(true);
    expect(g.state.phase).toBe('debt');
    expect(g.declareBankruptcy()).toBe(true);
    expect(g.player(0).bankrupt).toBe(true);
    expect(g.ownerOf(1)).toBe(1);
    expect(g.state.phase).toBe('gameover');
    expect(g.state.winner).toBe(1);
  });

  it('pays the debt automatically once enough cash is raised', () => {
    const g = setup();
    own(g, 1, 3);
    own(g, 0, 37, 39);
    g.cur.cash = 0;
    g.forcedDice.push([1, 2]);
    g.roll();
    expect(g.state.phase).toBe('debt');
    g.mortgage(0, 37);
    expect(g.state.phase).toBe('end');
    expect(g.player(1).cash).toBe(1500 + TILES[3].rents![0]);
  });
});

describe('trading', () => {
  it('swaps properties and cash', () => {
    const g = setup();
    own(g, 0, 1);
    own(g, 1, 3);
    const offer = { from: 0, to: 1, give: { cash: 100, tiles: [1], jailCards: 0 }, get: { cash: 0, tiles: [3], jailCards: 0 } };
    expect(g.validateTrade(offer)).toBe(null);
    expect(g.executeTrade(offer)).toBe(true);
    expect(g.ownerOf(1)).toBe(1);
    expect(g.ownerOf(3)).toBe(0);
    expect(g.player(1).cash).toBe(1600);
  });

  it('rejects trades of built sets', () => {
    const g = setup();
    own(g, 0, 1, 3);
    g.state.props[1].houses = 1;
    const offer = { from: 0, to: 1, give: { cash: 0, tiles: [3], jailCards: 0 }, get: { cash: 10, tiles: [], jailCards: 0 } };
    expect(g.validateTrade(offer)).toMatch(/buildings/);
  });
});

describe('persistence', () => {
  it('round-trips through JSON', () => {
    const g = setup();
    g.forcedDice.push([1, 2]);
    g.roll();
    const copy = Game.load(g.serialize());
    expect(copy.state).toEqual(g.state);
  });

  it('ends at the round limit with the richest player winning', () => {
    const g = setup(2, { roundLimit: 1 });
    g.forcedDice.push([1, 2]);
    g.roll();
    g.buy();
    g.endTurn();
    g.forcedDice.push([2, 4]);
    g.roll();
    g.decline();
    while (g.state.phase === 'auction') g.passBid(g.actor());
    g.player(1).cash += 10;
    g.endTurn();
    expect(g.state.phase).toBe('gameover');
    expect(g.state.winner).toBe(1);
  });
});
