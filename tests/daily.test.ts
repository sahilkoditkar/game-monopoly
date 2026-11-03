import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/engine';
import { dailyEdition, dailyNumber, dailyPlayers, dailySeed, dailySettings, todayKey } from '../src/ui/daily';

describe('daily challenge', () => {
  it('derives the same game from the same date, and a different one the next day', () => {
    expect(todayKey(new Date(2026, 10, 3))).toBe('2026-11-03');
    expect(dailyNumber('2026-11-01')).toBe(1);
    expect(dailyNumber('2026-12-01')).toBe(31);
    expect(dailySeed('2026-11-03')).toBe(dailySeed('2026-11-03'));
    expect(dailySeed('2026-11-03')).not.toBe(dailySeed('2026-11-04'));
    const boards = ['2026-11-03', '2026-11-04', '2026-11-05'].map(dailyEdition);
    expect(new Set(boards).size).toBe(3);
  });

  it('uses fixed rules and the same three opponents, never your colour or token', () => {
    const s = dailySettings('2026-11-03');
    expect(s).toMatchObject({ roundLimit: 20, news: true, missions: false, actionCards: false, daily: '2026-11-03' });
    const ps = dailyPlayers({ name: 'Me', token: '🐯', color: '#2a6f6b' });
    expect(ps).toHaveLength(4);
    expect(ps.filter((p) => p.ai)).toHaveLength(3);
    expect(new Set(ps.map((p) => p.color)).size).toBe(4);
    expect(new Set(ps.map((p) => p.token)).size).toBe(4);
  });

  it('rolls the same dice for everyone on the same day', () => {
    const key = '2026-11-03';
    const rolls = () => {
      const g = Game.create(dailyPlayers({ name: 'Me', token: '🚀', color: '#8d354b' }), dailySettings(key), dailySeed(key));
      const out: string[] = [];
      for (let i = 0; i < 30; i++) {
        g.forcedDice.length = 0;
        out.push((g as unknown as { rollDice(): [number, number] }).rollDice().join('+'));
      }
      return out;
    };
    expect(rolls()).toEqual(rolls());
  });
});
