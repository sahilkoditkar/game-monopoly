import { afterAll, describe, expect, it } from 'vitest';
import { acceptsTrade, apply, decide, fallback, newMemory } from '../src/game/ai';
import { BUYABLE, TILES } from '../src/game/board';
import { CARDS } from '../src/game/cards';
import { applyEdition, localize } from '../src/game/editions';
import { Game } from '../src/game/engine';
import { ACTION_CARDS, missionText } from '../src/game/extras';
import { pack, setLang, tr, trText, type Lang } from '../src/i18n';
import type { PlayerConfig } from '../src/game/types';

/** Keys built at runtime rather than written as tr('...') literals. */
const DYNAMIC = ['easy', 'normal', 'hard', 'Easy', 'Normal', 'Hard', 'Fast', 'Turbo', 'Burgundy', 'Deep teal', 'Olive', 'Charcoal', 'Forest green', '🌍 World', '🇮🇳 India', '🚩 Maharashtra',
  'Boost +3', 'Rent holiday', 'Half price', 'Free house',
  'Move 3 extra spaces on your next roll. Play before rolling.', 'Pay no rent for the rest of this turn. Play before rolling.',
  'Buy the city you are on for half price.', 'Your next house this turn is free.'];

function sourceKeys(): string[] {
  const keys = new Set<string>(DYNAMIC);
  const files = import.meta.glob('../src/ui/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  for (const src of Object.values(files)) {
    for (const m of src.matchAll(/\btr\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) keys.add(m[2].replace(/\\'/g, "'"));
  }
  return [...keys];
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterAll(() => {
  setLang('en');
  applyEdition('world');
});

const LANGS: { lang: Lang; mumbai: string; turn: string; player: string }[] = [
  { lang: 'mr', mumbai: 'मुंबई', turn: 'अ, तुमची पाळी', player: 'खेळाडू' },
  { lang: 'hi', mumbai: 'मुंबई', turn: 'अ, आपकी बारी', player: 'खिलाड़ी' },
];

for (const L of LANGS) {
  describe(`${L.lang} translation`, () => {
    it('covers every interface string', () => {
      setLang(L.lang);
      const missing = sourceKeys().filter((k) => !(k in pack()!.ui));
      expect(missing).toEqual([]);
    });

    it('keeps the same placeholders as the English text', () => {
      setLang(L.lang);
      for (const [en, out] of Object.entries(pack()!.ui)) expect(placeholders(out), en).toEqual(placeholders(en));
    });

    it('has every card and every board name', () => {
      setLang(L.lang);
      for (const c of CARDS) expect(pack()!.cards[c.id], c.id).toBeDefined();
      for (const ed of Object.values(pack()!.names)) expect(Object.keys(ed.tiles)).toHaveLength(40);
    });

    it('switches names, cards and text, and back to English', () => {
      setLang(L.lang);
      applyEdition('maharashtra');
      expect(TILES[39].name).toBe(L.mumbai);
      expect(CARDS.find((c) => c.id === 'f2')!.text).toContain(L.mumbai);
      expect(tr('{name}, your turn', { name: 'अ' })).toBe(L.turn);
      expect(tr('Player {n}', { n: 1 })).toBe(`${L.player} 1`);
      setLang('en');
      applyEdition('maharashtra');
      expect(TILES[39].name).toBe('Mumbai');
      expect(tr('{name}, your turn', { name: 'Ana' })).toBe('Ana, your turn');
    });

    // Plays whole games and checks every log line, reason and error comes out with no
    // English left (player names here are Devanagari, so any Latin word is a miss).
    for (const edition of ['world', 'india', 'maharashtra']) {
      it(`leaves no English in the game log (${edition})`, () => {
        setLang(L.lang);
        applyEdition(edition);
        const names = ['अनु', 'बाळू', 'चिनू'];
        const cfg: PlayerConfig[] = names.map((name) => ({ name, token: 'x', color: '#000', ai: true, difficulty: 'normal' }));
        const leftovers = new Set<string>();
        const check = (en: string) => {
          const out = trText(localize(en));
          if (/[A-Za-z]{2,}/.test(out.replace(/GPS/g, ''))) leftovers.add(`${en}  →  ${out}`);
        };
        for (const seed of [1, 2, 3, 4, 5, 6]) {
          const teams = seed % 3 === 0;
          const players = teams ? [...cfg, { ...cfg[0], name: 'दीपू' }].map((p, i) => ({ ...p, team: i % 2 })) : cfg;
          const g = Game.create(
            players,
            { roundLimit: 40, quickStart: seed % 2 === 0, edition, news: true, missions: true, actionCards: seed % 3 !== 0, teams, earlyBuild: seed % 2 === 1, goal: seed === 5 ? 'sets3' : seed === 4 ? 'worth5000' : undefined },
            seed,
          );
          for (const m of g.state.missions ?? []) check(missionText(m));
          const mem = g.state.players.map(() => newMemory());
          for (let i = 0; i < 30000 && g.state.phase !== 'gameover'; i++) {
            const pid = g.actor();
            for (const t of BUYABLE) {
              const why = g.buildBlocker(pid, t);
              if (why) check(why);
            }
            for (const d of g.state.debts) check(d.reason);
            for (const c of ACTION_CARDS) {
              const why = g.cardBlocker(pid, c);
              if (why) check(why);
            }
            const a = decide(g, pid, mem[pid]);
            if (a.type === 'trade') {
              if (acceptsTrade(g, a.offer)) g.executeTrade(a.offer);
              else g.log(`${g.player(a.offer.to).name} turned down ${g.player(a.offer.from).name}'s trade offer.`);
              continue;
            }
            if (!apply(g, pid, a)) apply(g, pid, fallback(g, pid));
            g.drain();
          }
          g.forfeitToWorth();
          for (const line of g.state.log) check(line);
        }
        expect([...leftovers]).toEqual([]);
      });
    }
  });
}
