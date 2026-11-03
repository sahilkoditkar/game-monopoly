import { HI, HI_CARDS, HI_LOG, HI_NAMES, HI_RULES, HI_WORDS } from './hi';
import { MR, MR_CARDS, MR_LOG, MR_NAMES, MR_RULES, MR_WORDS, type Names } from './mr';

/** Interface language. English strings double as the keys of the other tables. */
export type Lang = 'en' | 'mr' | 'hi';

export const LANGS: [Lang, string][] = [
  ['en', 'English'],
  ['hi', 'हिन्दी'],
  ['mr', 'मराठी'],
];

/** Everything one language needs besides English. */
export interface Pack {
  ui: Record<string, string>;
  log: [RegExp, string][];
  words: [RegExp, string][];
  cards: Record<string, [string, string]>;
  rules: string;
  names: Record<string, Names>;
  /** Default names for computer players and the "Player n" pattern. */
  ai: string[];
  player: string;
}

const PACKS: Record<Exclude<Lang, 'en'>, Pack> = {
  mr: { ui: MR, log: MR_LOG, words: MR_WORDS, cards: MR_CARDS, rules: MR_RULES, names: MR_NAMES, ai: ['आबा', 'बाळू', 'चिनू', 'दादू', 'मनू', 'पिंटू'], player: 'खेळाडू' },
  hi: { ui: HI, log: HI_LOG, words: HI_WORDS, cards: HI_CARDS, rules: HI_RULES, names: HI_NAMES, ai: ['गुड्डू', 'पप्पू', 'चिंटू', 'बबलू', 'मोनू', 'सोनू'], player: 'खिलाड़ी' },
};

export const allPacks = () => Object.values(PACKS);

const KEY = 'st-lang';
let lang: Lang = (() => {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'mr' || saved === 'hi' ? saved : 'en';
  } catch {
    return 'en';
  }
})();

export const getLang = () => lang;

/** The current language's tables, or null for English. */
export const pack = (): Pack | null => (lang === 'en' ? null : PACKS[lang]);

export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

if (typeof document !== 'undefined') document.documentElement.lang = lang;

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

/** Translates an interface string; `{name}`-style placeholders are filled from `vars`. */
export function tr(en: string, vars?: Record<string, string | number>): string {
  return fill(pack()?.ui[en] ?? en, vars);
}

/**
 * Translates a sentence the rules engine wrote in English (a log line, a debt reason, a
 * build or trade error). Board names are already swapped in by the time this runs.
 */
export function trText(text: string): string {
  const p = pack();
  if (!p || !text) return text;
  if (p.ui[text]) return p.ui[text];
  for (const [re, out] of p.log) {
    const m = re.exec(text);
    if (m) return p.words.reduce((s, [w, r]) => s.replace(w, r), out.replace(/\$(\d)/g, (_, i: string) => trText(m[+i] ?? '')));
  }
  return text;
}
