import { describe, expect, it } from 'vitest';
import { TILES } from '../src/game/board';
import { Game } from '../src/game/engine';
import type { PlayerConfig } from '../src/game/types';

const cfg = (n: number): PlayerConfig[] => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, token: 'x', color: '#000', ai: true }));

describe('quick game', () => {
  it('deals two cities from different sets to every player', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const n = 2 + (seed % 3);
      const g = Game.create(cfg(n), { quickStart: true, roundLimit: 15 }, seed);
      const owned = Object.entries(g.state.props);
      expect(owned).toHaveLength(n * 2);
      for (let pid = 0; pid < n; pid++) {
        const mine = owned.filter(([, o]) => o.owner === pid).map(([i]) => TILES[+i]);
        expect(mine).toHaveLength(2);
        expect(mine.every((t) => t.kind === 'property')).toBe(true);
        expect(mine[0].group).not.toBe(mine[1].group);
      }
      // Net worth at the start already includes the dealt cities.
      expect(g.stats.worth[0].every((w) => w > 1500)).toBe(true);
    }
  });

  it('is off by default', () => {
    expect(Object.keys(Game.create(cfg(2), {}, 1).state.props)).toHaveLength(0);
  });
});
