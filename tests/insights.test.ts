import { describe, expect, it } from 'vitest';
import { acceptsTrade, apply, decide, fallback, newMemory, tradeOutlook } from '../src/game/ai';
import { BUYABLE } from '../src/game/board';
import { Game } from '../src/game/engine';
import type { PlayerConfig, TradeOffer } from '../src/game/types';

const cfg = (n: number): PlayerConfig[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, token: 'x', color: '#000', ai: true, difficulty: (['easy', 'normal', 'hard'] as const)[i % 3] }));

/** Plays an all-AI game to the end (or a step cap). */
function playOut(seed: number, n = 3, roundLimit = 30) {
  const g = Game.create(cfg(n), { roundLimit }, seed);
  const mem = g.state.players.map(() => newMemory());
  for (let i = 0; i < 20000 && g.state.phase !== 'gameover'; i++) {
    const pid = g.actor();
    const a = decide(g, pid, mem[pid]);
    if (a.type === 'trade') {
      if (acceptsTrade(g, a.offer)) g.executeTrade(a.offer);
      continue;
    }
    if (!apply(g, pid, a)) apply(g, pid, fallback(g, pid));
    g.drain();
  }
  return g;
}

describe('end-of-game stats', () => {
  it('track net worth every round and add up rent on both sides', () => {
    for (const seed of [3, 11, 42]) {
      const g = playOut(seed);
      const st = g.stats;
      expect(g.state.phase).toBe('gameover');
      // One snapshot at the start, one per new round, and a final one.
      expect(st.worth.length).toBeGreaterThanOrEqual(g.state.round);
      expect(st.worth.every((row) => row.length === g.state.players.length)).toBe(true);
      const paid = st.rentPaid.reduce((a, b) => a + b, 0);
      const got = st.rentGot.reduce((a, b) => a + b, 0);
      const perTile = Object.values(st.tileRent).reduce((a, b) => a + b, 0);
      expect(paid).toBe(got);
      expect(perTile).toBe(got);
      if (st.biggest) expect(st.biggest.amount).toBeLessThanOrEqual(st.tileRent[st.biggest.tile]);
    }
  });

  it('survive a save/load round trip and appear for old saves', () => {
    const g = playOut(7, 2, 10);
    const copy = new Game(JSON.parse(JSON.stringify(g.state)));
    expect(copy.stats).toEqual(g.stats);
    const old = JSON.parse(JSON.stringify(g.state));
    delete old.stats;
    expect(new Game(old).stats.worth).toEqual([]);
  });
});

describe('trade outlook', () => {
  it('says "yes" exactly when the AI would accept', () => {
    let checked = 0;
    for (const seed of [5, 9, 21]) {
      const g = playOut(seed, 3, 8);
      // Try many random offers between every pair of players on the final board.
      const ps = g.state.players.filter((p) => !p.bankrupt);
      for (const a of ps)
        for (const b of ps) {
          if (a.id === b.id) continue;
          for (let k = 0; k < 30; k++) {
            const mine = g.ownedBy(a.id).filter((_, i) => (i + k) % 3 === 0);
            const theirs = g.ownedBy(b.id).filter((_, i) => (i + k) % 4 === 0);
            const offer: TradeOffer = { from: a.id, to: b.id, give: { cash: (k * 37) % 200, tiles: mine, jailCards: 0 }, get: { cash: (k * 53) % 150, tiles: theirs, jailCards: 0 } };
            if (g.validateTrade(offer)) continue;
            expect(tradeOutlook(g, offer) === 'yes').toBe(acceptsTrade(g, offer));
            checked++;
          }
        }
    }
    expect(checked).toBeGreaterThan(20);
    expect(BUYABLE.length).toBe(28);
  });
});
