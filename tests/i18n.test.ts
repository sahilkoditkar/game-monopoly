import { afterAll, describe, expect, it } from 'vitest';
import { acceptsTrade, apply, decide, fallback, newMemory } from '../src/game/ai';
import { BUYABLE, TILES } from '../src/game/board';
import { CARDS } from '../src/game/cards';
import { applyEdition, localize } from '../src/game/editions';
import { Game } from '../src/game/engine';
import { setLang, tr, trText } from '../src/i18n';
import { MR, MR_CARDS, MR_NAMES } from '../src/i18n/mr';
import type { PlayerConfig } from '../src/game/types';

/** Keys built at runtime rather than written as tr('...') literals. */
const DYNAMIC = ['easy', 'normal', 'hard', 'Easy', 'Normal', 'Hard', 'Fast', 'Turbo', 'Burgundy', 'Deep teal', 'Olive', 'Charcoal', 'Forest green', '🌍 World', '🇮🇳 India', '🚩 Maharashtra'];

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

describe('Marathi translation', () => {
  it('covers every interface string', () => {
    const missing = sourceKeys().filter((k) => !(k in MR));
    expect(missing).toEqual([]);
  });

  it('keeps the same placeholders as the English text', () => {
    for (const [en, mr] of Object.entries(MR)) expect(placeholders(mr), en).toEqual(placeholders(en));
  });

  it('has every card and every board name', () => {
    for (const c of CARDS) expect(MR_CARDS[c.id], c.id).toBeDefined();
    for (const ed of Object.values(MR_NAMES)) expect(Object.keys(ed.tiles)).toHaveLength(40);
  });

  it('switches names, cards and money on every board', () => {
    setLang('mr');
    applyEdition('maharashtra');
    expect(TILES[39].name).toBe('मुंबई');
    expect(CARDS.find((c) => c.id === 'f2')!.text).toBe('थेट मुंबई ला जा.');
    expect(tr('{name}, your turn', { name: 'अ' })).toBe('अ, तुमची पाळी');
    setLang('en');
    applyEdition('maharashtra');
    expect(TILES[39].name).toBe('Mumbai');
    expect(tr('{name}, your turn', { name: 'Ana' })).toBe('Ana, your turn');
  });

  // Plays whole games in Marathi and checks every log line, reason and error comes out
  // with no English left (player names here are Devanagari, so any Latin word is a miss).
  for (const edition of ['world', 'india', 'maharashtra']) {
    it(`leaves no English in the game log (${edition})`, () => {
      setLang('mr');
      applyEdition(edition);
      const names = ['अनु', 'बाळू', 'चिनू'];
      const cfg: PlayerConfig[] = names.map((name) => ({ name, token: 'x', color: '#000', ai: true, difficulty: 'normal' }));
      const leftovers = new Set<string>();
      const check = (en: string) => {
        const out = trText(localize(en));
        if (/[A-Za-z]{2,}/.test(out.replace(/GPS/g, ''))) leftovers.add(`${en}  →  ${out}`);
      };
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const g = Game.create(cfg, { roundLimit: 40, quickStart: seed % 2 === 0, edition }, seed);
        const mem = g.state.players.map(() => newMemory());
        for (let i = 0; i < 30000 && g.state.phase !== 'gameover'; i++) {
          const pid = g.actor();
          for (const t of BUYABLE) {
            const why = g.buildBlocker(pid, t);
            if (why) check(why);
          }
          for (const d of g.state.debts) check(d.reason);
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
