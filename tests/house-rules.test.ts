import { describe, expect, it } from 'vitest';
import { acceptsTrade, apply, decide, fallback, newMemory } from '../src/game/ai';
import { TILES, groupTiles } from '../src/game/board';
import { Game } from '../src/game/engine';
import { BOOST_STEPS, MISSION_REWARD } from '../src/game/extras';
import type { GameEvent, PlayerConfig, Settings } from '../src/game/types';

const cfg = (n: number, ai = true): PlayerConfig[] => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, token: 'x', color: '#000', ai }));

/** Plays an all-AI game and returns it with every event seen. */
function playOut(seed: number, settings: Partial<Settings>, n = 3) {
  const g = Game.create(cfg(n), { roundLimit: 30, ...settings }, seed);
  const mem = g.state.players.map(() => newMemory());
  const events: GameEvent[] = [...g.drain()];
  for (let i = 0; i < 40000 && g.state.phase !== 'gameover'; i++) {
    const pid = g.actor();
    const a = decide(g, pid, mem[pid]);
    if (a.type === 'trade') {
      if (acceptsTrade(g, a.offer)) g.executeTrade(a.offer);
      continue;
    }
    if (!apply(g, pid, a)) apply(g, pid, fallback(g, pid));
    events.push(...g.drain());
    for (const p of g.state.players) expect(p.cash, `cash of ${p.name}`).toBeGreaterThanOrEqual(0);
  }
  return { g, events };
}

describe('dice', () => {
  it('give the same rolls for the same seed, whatever the players decide', () => {
    const rolls = (buy: boolean) => {
      const g = Game.create(cfg(2, false), { auctions: false }, 99);
      const out: string[] = [];
      for (let i = 0; i < 400 && out.length < 40 && g.state.phase !== 'gameover'; i++) {
        const s = g.state;
        if (s.phase === 'roll') g.roll();
        else if (s.phase === 'buy') (buy ? g.buy() : false) || g.decline();
        else if (s.phase === 'end') g.endTurn();
        else if (s.phase === 'debt') g.declareBankruptcy();
        for (const e of g.drain()) if (e.type === 'roll') out.push(e.dice.join('+'));
      }
      return out;
    };
    expect(rolls(true)).toEqual(rolls(false));
  });
});

describe('breaking news', () => {
  it('changes rent while it lasts', () => {
    const g = Game.create(cfg(2), { news: true }, 1);
    g.state.props[39] = { owner: 1, houses: 0, mortgaged: false };
    const base = g.rentFor(39, 7);
    g.state.news = [{ target: TILES[39].group!, mult: 2, until: 5 }];
    expect(g.rentFor(39, 7)).toBe(base * 2);
    g.state.news = [{ target: TILES[39].group!, mult: 0.5, until: 5 }];
    expect(g.rentFor(39, 7)).toBe(Math.round(base / 2));
    g.state.news = [{ target: 'transit', mult: 0, until: 5 }];
    g.state.props[5] = { owner: 1, houses: 0, mortgaged: false };
    expect(g.rentFor(5, 7)).toBe(0);
  });

  it('happens in games with the rule on, and never with it off', () => {
    const on = playOut(4, { news: true }).events.filter((e) => e.type === 'news');
    const off = playOut(4, {}).events.filter((e) => e.type === 'news');
    expect(on.length).toBeGreaterThan(5);
    expect(off).toHaveLength(0);
  });
});

describe('secret missions', () => {
  it('deals each player a mission and pays the bonus once when it is met', () => {
    const g = Game.create(cfg(3), { missions: true }, 7);
    const ms = g.state.missions!;
    expect(ms).toHaveLength(3);
    const sets = ms.filter((m) => m.kind === 'set').map((m) => m.group);
    expect(new Set(sets).size).toBe(sets.length);
    // Hand player 0 whatever their mission needs.
    const m = ms[0];
    m.kind = 'set';
    m.group = 'skyline';
    for (const t of groupTiles('skyline')) g.state.props[t] = { owner: 0, houses: 0, mortgaged: false };
    const cash = g.player(0).cash;
    const events = g.drain();
    expect(m.done).toBe(true);
    expect(g.player(0).cash).toBe(cash + MISSION_REWARD);
    expect(events.some((e) => e.type === 'mission' && e.player === 0)).toBe(true);
    g.drain();
    expect(g.player(0).cash).toBe(cash + MISSION_REWARD);
  });
});

describe('action cards', () => {
  const human = () => {
    const g = Game.create(cfg(2, false), { actionCards: true }, 3);
    g.drain();
    return g;
  };

  it('deals two cards each and allows one per turn', () => {
    const g = human();
    expect(g.state.hands!.every((h) => h.length === 2)).toBe(true);
    g.state.hands![0] = ['boost', 'holiday'];
    expect(g.playCard(0, 'boost')).toBe(true);
    expect(g.cardBlocker(0, 'holiday')).toBe('One card per turn.');
    expect(g.playCard(1, 'holiday')).toBe(false);
  });

  it('Boost adds steps to the roll', () => {
    const g = human();
    g.state.hands![0] = ['boost'];
    g.playCard(0, 'boost');
    g.forcedDice.push([1, 2]);
    g.roll();
    expect(g.player(0).pos).toBe(3 + BOOST_STEPS);
  });

  it('Rent holiday skips rent this turn', () => {
    const g = human();
    g.state.props[3] = { owner: 1, houses: 0, mortgaged: false };
    g.state.hands![0] = ['holiday'];
    g.playCard(0, 'holiday');
    const cash = g.player(0).cash;
    g.forcedDice.push([1, 2]);
    g.roll();
    expect(g.player(0).cash).toBe(cash);
  });

  it('Half price halves the purchase', () => {
    const g = human();
    g.state.hands![0] = ['half'];
    g.forcedDice.push([2, 4]);
    g.roll();
    expect(g.state.phase).toBe('buy');
    expect(g.playCard(0, 'half')).toBe(true);
    const cash = g.player(0).cash;
    expect(g.buy()).toBe(true);
    expect(g.player(0).cash).toBe(cash - Math.floor(TILES[6].price! / 2));
  });

  it('Free house builds one house at no cost', () => {
    const g = human();
    for (const t of groupTiles('harbor')) g.state.props[t] = { owner: 0, houses: 0, mortgaged: false };
    g.state.hands![0] = ['free'];
    expect(g.playCard(0, 'free')).toBe(true);
    const cash = g.player(0).cash;
    expect(g.build(0, 1)).toBe(true);
    expect(g.player(0).cash).toBe(cash);
    expect(g.build(0, 3)).toBe(true);
    expect(g.player(0).cash).toBeLessThan(cash);
  });
});

describe('all three house rules together', () => {
  it('play to the end with computer players using cards and chasing missions', () => {
    let cards = 0;
    let missions = 0;
    for (const seed of [11, 12, 13, 14]) {
      const { g, events } = playOut(seed, { news: true, missions: true, actionCards: true }, 3 + (seed % 2));
      expect(g.state.phase).toBe('gameover');
      cards += events.filter((e) => e.type === 'actionCard').length;
      missions += events.filter((e) => e.type === 'mission').length;
    }
    expect(cards).toBeGreaterThan(5);
    expect(missions).toBeGreaterThan(0);
  });
});
