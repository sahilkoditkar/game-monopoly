import type { EditionId } from '../game/editions';
import type { PlayerConfig, Settings } from '../game/types';
import { pack } from '../i18n';

/**
 * Daily challenge: one game a day that is the same for everyone. The date picks the seed
 * (so the dice), the board and the opponents; the house rules are fixed. Your score is
 * your net worth after 20 rounds. Results are kept on this device only.
 */

export const DAILY_ROUNDS = 20;
const STORE = 'st-daily';
const EDITION_CYCLE: EditionId[] = ['maharashtra', 'india', 'world'];

/** Today's date as YYYY-MM-DD in the player's own time zone. */
export function todayKey(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayIndex = (key: string) => Math.round(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86_400_000);

/** Challenge number, counting from 1 November 2026. */
export const dailyNumber = (key: string) => dayIndex(key) - dayIndex('2026-11-01') + 1;

/** FNV-1a hash of the date: the game's seed. */
export function dailySeed(key: string): number {
  let h = 0x811c9dc5;
  for (const ch of `skyline-daily-${key}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

export const dailyEdition = (key: string): EditionId => EDITION_CYCLE[((dayIndex(key) % 3) + 3) % 3];

export function dailySettings(key: string): Partial<Settings> {
  return {
    daily: key,
    edition: dailyEdition(key),
    startingCash: 1500,
    salary: 200,
    auctions: true,
    jackpot: true,
    roundLimit: DAILY_ROUNDS,
    news: true,
    missions: false,
    actionCards: false,
    quickStart: false,
  };
}

const OPPONENT_TOKENS = ['🐯', '🦚', '🐘'];
const OPPONENT_COLORS = ['#2a6f6b', '#8d8435', '#212529', '#256105', '#8d354b'];

/** You plus the same three Normal computer players for everyone. */
export function dailyPlayers(you: { name: string; token: string; color: string }): PlayerConfig[] {
  const names = (pack()?.ai ?? ['Ava', 'Bolt', 'Cleo']).slice(0, 3);
  const colors = OPPONENT_COLORS.filter((c) => c !== you.color);
  const tokens = OPPONENT_TOKENS.map((t) => (t === you.token ? '🦁' : t));
  return [
    { name: you.name, token: you.token, color: you.color, ai: false, difficulty: 'normal' },
    ...names.map((name, i) => ({ name, token: tokens[i], color: colors[i], ai: true, difficulty: 'normal' as const })),
  ];
}

export interface DailyResult {
  best: number;
  first: number;
  plays: number;
}

function load(): Record<string, DailyResult> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export const dailyResult = (key: string): DailyResult | null => load()[key] ?? null;

/** Saves a finished daily game. The first finished game of the day is your official score. */
export function recordDaily(key: string, score: number): DailyResult & { isBest: boolean; isFirst: boolean } {
  const all = load();
  const prev = all[key];
  const next: DailyResult = prev
    ? { best: Math.max(prev.best, score), first: prev.first, plays: prev.plays + 1 }
    : { best: score, first: score, plays: 1 };
  all[key] = next;
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* private mode: the result shows now but isn't kept */
  }
  return { ...next, isBest: !prev || score > prev.best, isFirst: !prev };
}

/** Consecutive days, ending today or yesterday, with a finished daily game. */
export function dailyStreak(today = todayKey()): number {
  const all = load();
  let day = dayIndex(today);
  if (!all[today]) day -= 1;
  let n = 0;
  for (;;) {
    const d = new Date(day * 86_400_000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    if (!all[key]) return n;
    n++;
    day--;
  }
}
