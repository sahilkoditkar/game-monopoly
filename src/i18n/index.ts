import { MR, MR_LOG, MR_WORDS } from './mr';

/** Interface language. English strings double as the keys of the Marathi table. */
export type Lang = 'en' | 'mr';

const KEY = 'st-lang';
let lang: Lang = (() => {
  try {
    return localStorage.getItem(KEY) === 'mr' ? 'mr' : 'en';
  } catch {
    return 'en';
  }
})();

export const getLang = () => lang;

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
  return fill(lang === 'mr' ? (MR[en] ?? en) : en, vars);
}

/**
 * Translates a sentence the rules engine wrote in English (a log line, a debt reason, a
 * build or trade error). Board names are already swapped in by the time this runs.
 */
export function trText(text: string): string {
  if (lang === 'en' || !text) return text;
  if (MR[text]) return MR[text];
  for (const [re, out] of MR_LOG) {
    const m = re.exec(text);
    if (m) return MR_WORDS.reduce((s, [w, r]) => s.replace(w, r), out.replace(/\$(\d)/g, (_, i: string) => trText(m[+i] ?? '')));
  }
  return text;
}
