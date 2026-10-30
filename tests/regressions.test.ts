import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/engine';
import { JAIL_INDEX, houseCost } from '../src/game/board';
import type { PlayerConfig } from '../src/game/types';

const players = (n: number): PlayerConfig[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, token: 'x', color: '#fff', ai: false }));

function setup(n = 3) {
  const g = Game.create(players(n), { jackpot: false }, 1);
  g.drain();
  return g;
}

describe('review regressions', () => {
  it('lets others pay a debtor, and clears debts owed to a bankrupt player', () => {
    const g = setup(3);
    const p = g.cur;
    p.inJail = true;
    p.pos = JAIL_INDEX;
    p.jailTurns = 2;
    p.cash = 30;
    g.state.decks.treasury = ['t7', ...g.state.decks.treasury.filter((c) => c !== 't7')];
    g.forcedDice.push([3, 4]); // third failed try, lands on Treasury (17): birthday bash
    g.roll();
    // The other players paid immediately even though P0 owes the fine.
    expect(g.player(1).cash).toBe(1490);
    expect(g.player(2).cash).toBe(1490);
    expect(g.state.debts).toHaveLength(0);
    expect(p.cash).toBe(0);

    const g2 = setup(3);
    g2.state.debts = [
      { from: 0, to: null, amount: 500, reason: 'x' },
      { from: 1, to: 0, amount: 10, reason: 'y' },
    ];
    g2.state.phase = 'debt';
    g2.cur.cash = 0;
    g2.player(1).cash = 0;
    g2.declareBankruptcy();
    expect(g2.state.debts).toHaveLength(0);
    expect(g2.state.current).toBe(1);
    expect(g2.state.phase).toBe('roll');
  });

  it('gives the estate to a player creditor ahead of the bank', () => {
    const g = setup(2);
    g.state.props[1] = { owner: 0, houses: 0, mortgaged: true };
    g.state.debts = [
      { from: 0, to: null, amount: 50, reason: 'fine' },
      { from: 0, to: 1, amount: 400, reason: 'rent' },
    ];
    g.state.phase = 'debt';
    g.cur.cash = 10;
    g.declareBankruptcy();
    expect(g.ownerOf(1)).toBe(1);
    expect(g.player(1).cash).toBe(1510);
  });

  it('allows selling a hotel when the bank is out of houses', () => {
    const g = setup(2);
    for (const t of [1, 3]) g.state.props[t] = { owner: 0, houses: 5, mortgaged: false };
    // Use up all 32 houses elsewhere.
    for (const t of [6, 8, 9, 11, 13, 14, 16, 18]) g.state.props[t] = { owner: 1, houses: 4, mortgaged: false };
    expect(g.canSell(0, 1)).toBe(true);
    const before = g.cur.cash;
    g.sell(0, 1);
    expect(g.state.props[1].houses).toBe(0);
    expect(g.cur.cash).toBe(before + (5 * houseCost(1)) / 2);
  });

  it('does not let a debtor build', () => {
    const g = setup(2);
    g.state.props[1] = { owner: 0, houses: 0, mortgaged: false };
    g.state.props[3] = { owner: 0, houses: 0, mortgaged: false };
    g.state.debts = [{ from: 0, to: 1, amount: 2000, reason: 'rent' }];
    g.state.phase = 'debt';
    expect(g.canBuild(0, 1)).toBe(false);
  });
});
