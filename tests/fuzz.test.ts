import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/engine';
import { BUYABLE } from '../src/game/board';
import type { PlayerConfig } from '../src/game/types';

const cfg = (n: number): PlayerConfig[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, token: 'x', color: '#000', ai: true }));

/** Drives a game with random legal actions and checks invariants after each one. */
function randomPlay(seed: number, n: number) {
  const g = Game.create(cfg(n), { roundLimit: 60, jackpot: seed % 2 === 0, auctions: seed % 3 !== 0 }, seed);
  let rnd = seed;
  const r = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let step = 0; step < 5000 && g.state.phase !== 'gameover'; step++) {
    const s = g.state;
    const actor = g.actor();
    if (r() < 0.2 && g.canManage(actor)) {
      const tile = BUYABLE[Math.floor(r() * BUYABLE.length)];
      const k = Math.floor(r() * 4);
      if (k === 0) g.build(actor, tile);
      else if (k === 1) g.sell(actor, tile);
      else if (k === 2) g.mortgage(actor, tile);
      else g.unmortgage(actor, tile);
    }
    switch (s.phase) {
      case 'roll':
        if (g.cur.inJail && r() < 0.3) g.payJailFine();
        g.roll();
        break;
      case 'buy':
        if (r() < 0.7 && g.buy()) break;
        g.decline();
        break;
      case 'auction':
        if (r() < 0.4) g.bid(actor, g.minBid() + Math.floor(r() * 40));
        else g.passBid(actor);
        break;
      case 'debt': {
        const owned = g.ownedBy(actor);
        const sold = owned.some((t) => g.sell(actor, t)) || owned.some((t) => g.mortgage(actor, t));
        if (!sold) g.declareBankruptcy();
        break;
      }
      case 'end':
        g.endTurn();
        break;
    }
    g.drain();
    for (const p of s.players) {
      if (s.phase !== 'debt') expect(p.cash).toBeGreaterThanOrEqual(0);
      if (p.bankrupt) expect(g.ownedBy(p.id)).toEqual([]);
    }
    expect(s.players[s.current].bankrupt).toBe(false);
  }
  return g;
}

describe('random play', () => {
  it('always reaches game over without breaking invariants', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const g = randomPlay(seed, 2 + (seed % 3));
      expect(g.state.phase).toBe('gameover');
      expect(g.state.winner).not.toBeNull();
    }
  });
});
