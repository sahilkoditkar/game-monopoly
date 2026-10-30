import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/engine';
import { acceptsTrade, apply, decide, fallback, newMemory, type AiMemory } from '../src/game/ai';
import type { Difficulty, PlayerConfig } from '../src/game/types';

function simulate(seed: number, levels: Difficulty[], roundLimit = 0) {
  const cfg: PlayerConfig[] = levels.map((d, i) => ({ name: `${d}${i}`, token: 'x', color: '#000', ai: true, difficulty: d }));
  const g = Game.create(cfg, { roundLimit }, seed);
  const mem: AiMemory[] = levels.map(() => newMemory());
  let steps = 0;
  let trades = 0;
  while (g.state.phase !== 'gameover' && steps < 40000) {
    const pid = g.actor();
    const action = decide(g, pid, mem[pid]);
    if (!apply(g, pid, action)) apply(g, pid, fallback(g, pid));
    for (const e of g.drain()) if (e.type === 'trade') trades++;
    steps++;
  }
  return { g, steps, trades };
}

describe('AI players', () => {
  it('finish 4-player games on their own', () => {
    let finished = 0;
    let trades = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { g, trades: t } = simulate(seed, ['normal', 'hard', 'easy', 'normal'], 150);
      trades += t;
      if (g.state.phase === 'gameover') finished++;
      for (const p of g.state.players) expect(p.cash).toBeGreaterThanOrEqual(0);
    }
    expect(finished).toBe(20);
    expect(trades).toBeGreaterThan(0);
  });

  it('usually bankrupts opponents before a long round limit', () => {
    let byBankruptcy = 0;
    for (let seed = 100; seed < 120; seed++) {
      const { g } = simulate(seed, ['normal', 'normal'], 300);
      if (g.state.players.some((p) => p.bankrupt)) byBankruptcy++;
    }
    expect(byBankruptcy).toBeGreaterThan(10);
  });

  it('hard beats easy more often than not', () => {
    let hardWins = 0;
    for (let seed = 200; seed < 240; seed++) {
      const order: Difficulty[] = seed % 2 ? ['hard', 'easy'] : ['easy', 'hard'];
      const { g } = simulate(seed, order, 200);
      if (g.state.winner !== null && g.player(g.state.winner).difficulty === 'hard') hardWins++;
    }
    expect(hardWins).toBeGreaterThan(20);
  });

  it('rejects lopsided trades', () => {
    const g = Game.create(
      [
        { name: 'A', token: 'x', color: '#000', ai: false },
        { name: 'B', token: 'x', color: '#000', ai: true },
      ],
      {},
      7,
    );
    g.state.props[37] = { owner: 1, houses: 0, mortgaged: false };
    g.state.props[39] = { owner: 0, houses: 0, mortgaged: false };
    const cheap = { from: 0, to: 1, give: { cash: 10, tiles: [], jailCards: 0 }, get: { cash: 0, tiles: [37], jailCards: 0 } };
    expect(acceptsTrade(g, cheap)).toBe(false);
    const generous = { from: 0, to: 1, give: { cash: 900, tiles: [], jailCards: 0 }, get: { cash: 0, tiles: [37], jailCards: 0 } };
    expect(acceptsTrade(g, generous)).toBe(true);
  });
});
