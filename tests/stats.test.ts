// Win-rate report for tuning the AI. Run with: STATS=1 npx vitest run tests/stats.test.ts
import { it } from 'vitest';
import { Game } from '../src/game/engine';
import { apply, decide, fallback, newMemory } from '../src/game/ai';
import type { Difficulty } from '../src/game/types';

it.skipIf(!import.meta.env.STATS)('stats', () => {
  for (const pair of [['hard', 'easy'], ['normal', 'easy'], ['hard', 'normal']] as Difficulty[][]) {
    const wins: Record<string, number> = {};
    let rounds = 0, trades = 0, bk = 0;
    for (let seed = 0; seed < 200; seed++) {
      const lv = seed % 2 ? pair : [pair[1], pair[0]];
      const g = Game.create(lv.map((d, i) => ({ name: d + i, token: 'x', color: '', ai: true, difficulty: d })), { roundLimit: 200 }, seed + 999);
      const mem = lv.map(() => newMemory());
      for (let k = 0; k < 50000 && g.state.phase !== 'gameover'; k++) {
        const pid = g.actor();
        if (!apply(g, pid, decide(g, pid, mem[pid]))) apply(g, pid, fallback(g, pid));
        for (const e of g.drain()) if (e.type === 'trade') trades++;
      }
      rounds += g.state.round;
      if (g.state.players.some((p) => p.bankrupt)) bk++;
      const w = g.player(g.state.winner!).difficulty;
      wins[w] = (wins[w] ?? 0) + 1;
    }
    console.log(pair.join(' vs '), wins, 'avg rounds', rounds / 200, 'trades', trades, 'bankrupt-ended', bk);
  }
});
