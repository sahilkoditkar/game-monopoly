import { describe, expect, it } from 'vitest';
import { acceptsTrade, apply, decide, fallback, newMemory } from '../src/game/ai';
import { TILES, groupTiles, mortgageValue } from '../src/game/board';
import { Game } from '../src/game/engine';
import type { PlayerConfig, Settings } from '../src/game/types';

const cfg = (n: number, ai = false, teams = false): PlayerConfig[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, token: 'x', color: '#000', ai, ...(teams ? { team: i % 2 } : {}) }));

const own = (g: Game, pid: number, tiles: number[], houses = 0) => {
  for (const t of tiles) g.state.props[t] = { owner: pid, houses, mortgaged: false };
};

/** Puts the game into an auction for `tile` with player `turn` to bid. */
function auction(g: Game, tile: number, turn = 0) {
  g.state.phase = 'auction';
  g.state.auction = { tile, bid: 0, bidder: null, active: g.state.players.map((p) => p.id), turn };
}

function playOut(seed: number, settings: Partial<Settings>, players: PlayerConfig[]) {
  const g = Game.create(players, { roundLimit: 60, ...settings }, seed);
  const mem = g.state.players.map(() => newMemory());
  for (let i = 0; i < 40000 && g.state.phase !== 'gameover'; i++) {
    const pid = g.actor();
    const a = decide(g, pid, mem[pid]);
    if (a.type === 'trade') {
      if (acceptsTrade(g, a.offer)) g.executeTrade(a.offer);
      continue;
    }
    if (!apply(g, pid, a)) apply(g, pid, fallback(g, pid));
    g.drain();
    for (const p of g.state.players) expect(p.cash).toBeGreaterThanOrEqual(0);
  }
  return g;
}

describe('raising cash during an auction', () => {
  it('lets the bidder mortgage or sell, but not build, and nobody else', () => {
    const g = Game.create(cfg(2), {}, 1);
    own(g, 0, [1]);
    own(g, 1, [3]);
    auction(g, 39, 0);
    const cash = g.player(0).cash;
    expect(g.canMortgage(0, 1)).toBe(true);
    expect(g.canMortgage(1, 3)).toBe(false);
    expect(g.mortgage(0, 1)).toBe(true);
    expect(g.player(0).cash).toBe(cash + mortgageValue(1));
    expect(g.canUnmortgage(0, 1)).toBe(false);
    // Bids still can't exceed the cash in hand.
    expect(g.bid(0, g.player(0).cash + 1)).toBe(false);
    expect(g.bid(0, g.player(0).cash)).toBe(true);
  });

  it('computer players mortgage a loose property to win a city that completes their set', () => {
    const g = Game.create(cfg(2, true), {}, 2);
    own(g, 0, [21, 23]);
    own(g, 0, [1]);
    g.player(0).cash = 20;
    auction(g, 24, 0);
    g.state.auction!.bid = 40;
    g.state.auction!.bidder = 1;
    const a = decide(g, 0, newMemory());
    expect(a).toEqual({ type: 'mortgage', tile: 1 });
  });
});

describe('team mode', () => {
  it('teammates pay no rent to each other and share colour sets', () => {
    const g = Game.create(cfg(4, false, true), { teams: true }, 3);
    expect(g.state.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
    const [a, b] = groupTiles('riviera');
    own(g, 0, [a]);
    own(g, 2, groupTiles('riviera').filter((t) => t !== a));
    expect(g.hasFullSet(0, 'riviera')).toBe(true);
    expect(g.hasFullSet(1, 'riviera')).toBe(false);
    g.state.phase = 'roll';
    expect(g.canBuild(0, a)).toBe(true);
    expect(g.canBuild(0, b)).toBe(false);
    // Player 2 (teammate of 0) lands on 0's city: no rent.
    g.state.current = 2;
    g.player(2).pos = a - 2;
    const cash = g.player(2).cash;
    g.forcedDice.push([1, 1]);
    g.roll();
    expect(g.player(2).cash).toBe(cash);
    expect(g.state.log.some((l) => l.includes("teammate's"))).toBe(true);
  });

  it('computer teammates accept any valid trade and never bid against each other', () => {
    const g = Game.create(cfg(4, true, true), { teams: true }, 4);
    own(g, 2, [6]);
    expect(acceptsTrade(g, { from: 0, to: 2, give: { cash: 0, tiles: [], jailCards: 0 }, get: { cash: 0, tiles: [6], jailCards: 0 } })).toBe(true);
    auction(g, 39, 2);
    g.state.auction!.bid = 50;
    g.state.auction!.bidder = 0;
    expect(decide(g, 2, newMemory())).toEqual({ type: 'pass' });
  });

  it('ends when one team is left, and team net worth decides a timed game', () => {
    for (const seed of [5, 6, 7]) {
      const g = playOut(seed, { teams: true, roundLimit: 25 }, cfg(4, true, true));
      expect(g.state.phase).toBe('gameover');
      expect([0, 1]).toContain(g.state.winnerTeam);
      expect(g.player(g.state.winner!).team).toBe(g.state.winnerTeam);
    }
  });
});

describe('race mode', () => {
  it('has a "double your money" race that follows the starting cash', () => {
    const g = Game.create(cfg(2), { goal: 'double' }, 8);
    expect(g.raceProgress(0)).toEqual({ value: 1500, target: 3000 });
    expect(Game.create(cfg(2), { goal: 'double', startingCash: 2000 }, 8).raceProgress(0)!.target).toBe(4000);
    // In teams it is the team's combined starting money, doubled.
    expect(Game.create(cfg(4, false, true), { goal: 'double', teams: true }, 8).raceProgress(0)).toEqual({ value: 3000, target: 6000 });
    g.player(0).cash = 2999;
    g.drain();
    expect(g.state.phase).not.toBe('gameover');
    g.player(0).cash = 3000;
    g.drain();
    expect(g.state.winner).toBe(0);
  });

  it('ends the moment someone reaches the net worth goal', () => {
    const g = Game.create(cfg(2), { goal: 'worth5000' }, 8);
    g.player(1).cash = 5200;
    g.drain();
    expect(g.state.phase).toBe('gameover');
    expect(g.state.winner).toBe(1);
  });

  it('counts full colour sets for the sets goal (team sets in team mode)', () => {
    const g = Game.create(cfg(4, false, true), { goal: 'sets3', teams: true }, 9);
    own(g, 0, groupTiles('harbor'));
    own(g, 2, groupTiles('andes'));
    g.drain();
    expect(g.state.phase).not.toBe('gameover');
    expect(g.raceProgress(0)).toEqual({ value: 2, target: 3 });
    own(g, 2, groupTiles('skyline'));
    g.drain();
    expect(g.state.phase).toBe('gameover');
    expect(g.state.winnerTeam).toBe(0);
  });

  it('plays to a finish with computer players', () => {
    for (const goal of ['double', 'worth5000', 'sets3'] as const) {
      const g = playOut(10, { goal, roundLimit: 0 }, cfg(3, true));
      expect(g.state.phase).toBe('gameover');
    }
  });
});

describe('early building', () => {
  it('allows up to 2 houses before owning the set, then the normal rules', () => {
    const g = Game.create(cfg(2), { earlyBuild: true }, 11);
    const set = groupTiles('riviera');
    own(g, 0, [set[0]]);
    g.state.phase = 'roll';
    expect(g.build(0, set[0])).toBe(true);
    expect(g.build(0, set[0])).toBe(true);
    expect(g.canBuild(0, set[0])).toBe(false);
    expect(g.buildBlocker(0, set[0])).toContain('at most 2 houses');
    // Rent uses the houses even without the set.
    g.state.current = 1;
    expect(g.rentFor(set[0], 7)).toBe(TILES[set[0]].rents![2]);
    // Completing the set lifts the cap (even building applies again).
    g.state.current = 0;
    own(g, 0, set.slice(1));
    expect(g.canBuild(0, set[0])).toBe(false);
    expect(g.canBuild(0, set[1])).toBe(true);
  });

  it('is off by default', () => {
    const g = Game.create(cfg(2), {}, 12);
    own(g, 0, [1]);
    g.state.phase = 'roll';
    expect(g.canBuild(0, 1)).toBe(false);
  });

  it('computer players use it and games still finish', () => {
    const g = playOut(13, { earlyBuild: true, roundLimit: 40 }, cfg(3, true));
    expect(g.state.phase).toBe('gameover');
  });
});
