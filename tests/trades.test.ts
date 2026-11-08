import { describe, expect, it } from 'vitest';
import { acceptsTrade, decide, newMemory, tradeOutlook, tradeShortfall } from '../src/game/ai';
import { Game } from '../src/game/engine';
import type { Difficulty, TradeOffer } from '../src/game/types';

// Riviera: Barcelona 21 ($220), Rome 23 ($230), Paris 24 ($240). Harbor: Lagos 1 ($60), Nairobi 3 ($70).
// Andes: Lima 6 ($100), Quito 8 ($100), Bogotá 9 ($120).

/** Player 0 is a human, player 1 a computer player of the given level, player 2 a bystander. */
function table(difficulty: Difficulty = 'normal') {
  const g = Game.create(
    [
      { name: 'You', token: 'x', color: '#000', ai: false },
      { name: 'Bot', token: 'x', color: '#000', ai: true, difficulty },
      { name: 'Other', token: 'x', color: '#000', ai: true },
    ],
    {},
    1,
  );
  g.state.phase = 'roll';
  return g;
}

const own = (g: Game, pid: number, tiles: number[]) => {
  for (const t of tiles) g.state.props[t] = { owner: pid, houses: 0, mortgaged: false };
};

const offer = (give: { cash?: number; tiles?: number[] }, get: { cash?: number; tiles?: number[] }, from = 0, to = 1): TradeOffer => ({
  from,
  to,
  give: { cash: give.cash ?? 0, tiles: give.tiles ?? [], jailCards: 0 },
  get: { cash: get.cash ?? 0, tiles: get.tiles ?? [], jailCards: 0 },
});

/** The least cash (in steps of 10) the computer player takes for `tiles`. */
function cheapest(g: Game, tiles: number[]): number {
  for (let cash = 0; cash <= 1500; cash += 10) if (acceptsTrade(g, offer({ cash }, { tiles }))) return cash;
  return Infinity;
}

describe('fair trades with computer players', () => {
  it('sells a city that completes your set for its price plus a fair premium', () => {
    const prices: Record<string, number> = {};
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const g = table(d);
      own(g, 0, [21, 23]);
      own(g, 1, [24]);
      prices[d] = cheapest(g, [24]);
    }
    // Paris costs $240: easy about market, normal ~1.3x, hard ~1.7x (normal used to want ~2.9x).
    expect(prices.easy).toBeGreaterThanOrEqual(240);
    expect(prices.easy).toBeLessThan(280);
    expect(prices.normal).toBeGreaterThan(prices.easy);
    expect(prices.normal).toBeLessThanOrEqual(340);
    expect(prices.hard).toBeGreaterThan(prices.normal);
    expect(prices.hard).toBeLessThanOrEqual(420);
  });

  it('sells a city that completes nothing at about its price, a little more on harder levels', () => {
    const price = (d: Difficulty) => {
      const g = table(d);
      own(g, 1, [1]);
      return cheapest(g, [1]);
    };
    // Lagos costs $60.
    expect(price('easy')).toBeLessThanOrEqual(60);
    expect(price('normal')).toBe(60);
    expect(price('hard')).toBeGreaterThan(60);
    expect(price('hard')).toBeLessThanOrEqual(70);
  });

  it('takes an even swap', () => {
    const g = table();
    own(g, 0, [6]);
    own(g, 1, [8]);
    own(g, 2, [9]);
    expect(acceptsTrade(g, offer({ tiles: [6] }, { tiles: [8] }))).toBe(true);
  });

  it('takes a swap that completes a set for both sides, with the price difference', () => {
    const g = table();
    own(g, 0, [6, 8, 3]);
    own(g, 1, [9, 1]);
    // Bogotá ($120) for Nairobi ($70): each side completes a set, so it's a straight swap at
    // market value and only the $50 price difference is asked for.
    const swap = offer({ tiles: [3] }, { tiles: [9] });
    expect(acceptsTrade(g, swap)).toBe(false);
    const short = tradeShortfall(g, swap);
    expect(short).toBeGreaterThan(0);
    expect(short).toBeLessThanOrEqual(50);
    for (const d of ['easy', 'hard'] as const) {
      const h = table(d);
      own(h, 0, [6, 8, 3]);
      own(h, 1, [9, 1]);
      expect(tradeShortfall(h, swap)).toBeLessThanOrEqual(50);
    }
    // An even mutual swap needs nothing extra.
    const even = table('hard');
    own(even, 0, [21, 23, 1]);
    own(even, 1, [24, 3]);
    expect(acceptsTrade(even, offer({ tiles: [1], cash: 180 }, { tiles: [24] }))).toBe(true);
    expect(tradeOutlook(g, swap)).toBe('close');
    expect(acceptsTrade(g, offer({ tiles: [3], cash: short }, { tiles: [9] }))).toBe(true);
  });

  it('wants a lot more to break up its own set', () => {
    const g = table();
    own(g, 1, [1, 3]);
    expect(acceptsTrade(g, offer({ cash: 120 }, { tiles: [1] }))).toBe(false);
    expect(cheapest(g, [1])).toBeGreaterThan(150);
  });

  it('tells you how far off an offer is, and the hint matches the answer', () => {
    const g = table();
    own(g, 0, [21, 23]);
    own(g, 1, [24]);
    const low = offer({ cash: 300 }, { tiles: [24] });
    expect(tradeOutlook(g, low)).toBe('close');
    expect(tradeShortfall(g, low)).toBeGreaterThan(0);
    const bumped = offer({ cash: 300 + tradeShortfall(g, low) }, { tiles: [24] });
    expect(tradeOutlook(g, bumped)).toBe('yes');
    expect(acceptsTrade(g, bumped)).toBe(true);
    expect(tradeOutlook(g, offer({ cash: 50 }, { tiles: [24] }))).toBe('no');
  });

  it('offers you a fair price when it wants your city: easy rounds up, hard haggles', () => {
    const bid = (d: Difficulty) => {
      const g = table(d);
      own(g, 1, [21, 23]);
      own(g, 0, [24]);
      g.state.current = 1;
      const a = decide(g, 1, newMemory());
      expect(a.type).toBe('trade');
      if (a.type !== 'trade') return 0;
      expect(a.offer).toMatchObject({ from: 1, to: 0, get: { tiles: [24] } });
      // Whatever it offers is a deal you'd be told is fair.
      expect(tradeShortfall(g, a.offer)).toBe(0);
      return a.offer.give.cash;
    };
    const [easy, normal, hard] = [bid('easy'), bid('normal'), bid('hard')];
    expect(normal).toBeGreaterThanOrEqual(300);
    expect(normal).toBeLessThanOrEqual(360);
    expect(easy).toBeGreaterThan(normal);
    expect(hard).toBeLessThan(normal);
  });
});
