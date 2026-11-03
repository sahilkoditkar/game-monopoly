import { GROUPS, TILES } from './board';
import { CARDS } from './cards';
import { getLang } from '../i18n';
import { MR_CARDS, MR_NAMES } from '../i18n/mr';

/**
 * Board editions change only names, icons and the currency symbol. Prices, rents, rules and
 * the board layout stay identical, so any edition plays exactly like the world edition.
 */
export type EditionId = 'world' | 'india' | 'maharashtra';

interface Edition {
  id: EditionId;
  label: string;
  currency: string;
  /** Setup screen tagline. */
  blurb: string;
  /** Display names for the two card decks. */
  decks: { fortune: string; treasury: string };
  /** Word swaps for generic terms used in card texts and the game log. */
  words: [string, string][];
  groups: Record<string, string>;
  /** Index -> [name, short name, icon] for every tile that changes. */
  tiles: Record<number, [string, string, string]>;
}

export const EDITIONS: Record<EditionId, Edition> = {
  world: { id: 'world', label: '🌍 World', currency: '$', blurb: 'Buy world cities, build skyscrapers, and bankrupt your rivals.', decks: { fortune: 'Fortune', treasury: 'Treasury' }, words: [], groups: {}, tiles: {} },
  india: {
    id: 'india',
    label: '🇮🇳 India',
    currency: '₹',
    blurb: 'Buy Indian cities from Ranchi to Delhi, build towers, and bankrupt your rivals.',
    decks: { fortune: 'Bhagya', treasury: 'Tijori' },
    words: [
      ['Skyports', 'railway stations'],
      ['Skyport', 'railway station'],
    ],
    groups: {
      harbor: 'East',
      andes: 'Northeast',
      bazaar: 'Rajasthan',
      tango: 'Heartland',
      riviera: 'Big Metros',
      pacific: 'Coast & Coffee',
      alpine: 'Tech Cities',
      skyline: 'Mega Cities',
    },
    tiles: {
      0: ['Shubh Aarambh', 'START', '🚩'],
      1: ['Ranchi', 'Ranchi', '🌳'],
      2: ['Tijori', 'Tijori', '💰'],
      3: ['Bhubaneswar', 'Bhubaneswar', '🛕'],
      4: ['Income Tax', 'Income Tax', '🧾'],
      5: ['Howrah Junction', 'Howrah Jn', '🚂'],
      6: ['Gangtok', 'Gangtok', '🏔️'],
      7: ['Bhagya', 'Bhagya', '🔮'],
      8: ['Shillong', 'Shillong', '☁️'],
      9: ['Guwahati', 'Guwahati', '🦏'],
      10: ['Jail', 'Jail', '🔒'],
      11: ['Jodhpur', 'Jodhpur', '🏰'],
      12: ['Power Grid', 'Power Grid', '⚡'],
      13: ['Udaipur', 'Udaipur', '🛶'],
      14: ['Jaipur', 'Jaipur', '🐪'],
      15: ['Chennai Central', 'Chennai Ctrl', '🚂'],
      16: ['Varanasi', 'Varanasi', '🪔'],
      17: ['Tijori', 'Tijori', '💰'],
      18: ['Agra', 'Agra', '🕌'],
      19: ['Lucknow', 'Lucknow', '🍢'],
      20: ['Chai Break', 'Chai Break', '☕'],
      21: ['Kolkata', 'Kolkata', '🚋'],
      22: ['Bhagya', 'Bhagya', '🔮'],
      23: ['Chennai', 'Chennai', '🏖️'],
      24: ['Hyderabad', 'Hyderabad', '💎'],
      25: ['New Delhi Station', 'N. Delhi Stn', '🚂'],
      26: ['Mysuru', 'Mysuru', '🐘'],
      27: ['Kochi', 'Kochi', '⛵'],
      28: ['Water Board', 'Water Board', '💧'],
      29: ['Goa', 'Goa', '🌴'],
      30: ['Go to Jail', 'Go to Jail', '🚓'],
      31: ['Ahmedabad', 'Ahmedabad', '🪁'],
      32: ['Pune', 'Pune', '🏯'],
      33: ['Tijori', 'Tijori', '💰'],
      34: ['Bengaluru', 'Bengaluru', '💻'],
      35: ['Mumbai CSMT', 'Mumbai CSMT', '🚂'],
      36: ['Bhagya', 'Bhagya', '🔮'],
      37: ['Mumbai', 'Mumbai', '🌆'],
      38: ['GST', 'GST', '🧾'],
      39: ['Delhi', 'Delhi', '🏛️'],
    },
  },
  maharashtra: {
    id: 'maharashtra',
    label: '🚩 Maharashtra',
    currency: '₹',
    blurb: 'Buy Maharashtra from Latur to Mumbai, build towers, and bankrupt your rivals.',
    decks: { fortune: 'Nashib', treasury: 'Tijori' },
    words: [
      ['Skyports', 'stations'],
      ['Skyport', 'station'],
    ],
    groups: {
      harbor: 'Marathwada',
      andes: 'Southern Maharashtra',
      bazaar: 'Khandesh',
      tango: 'Vidarbha',
      riviera: 'Sahyadri Hills',
      pacific: 'Konkan Coast',
      alpine: 'Big Cities',
      skyline: 'Metro',
    },
    tiles: {
      0: ['Suruvat', 'START', '🚩'],
      1: ['Latur', 'Latur', '🌾'],
      2: ['Tijori', 'Tijori', '💰'],
      3: ['Nanded', 'Nanded', '🛕'],
      4: ['Income Tax', 'Income Tax', '🧾'],
      5: ['Mumbai CSMT', 'Mumbai CSMT', '🚂'],
      6: ['Satara', 'Satara', '🌸'],
      7: ['Nashib', 'Nashib', '🔮'],
      8: ['Sangli', 'Sangli', '🍇'],
      9: ['Kolhapur', 'Kolhapur', '🌶️'],
      10: ['Turung', 'Turung', '🔒'],
      11: ['Nandurbar', 'Nandurbar', '🌄'],
      12: ['Vij Board', 'Vij Board', '⚡'],
      13: ['Dhule', 'Dhule', '🐂'],
      14: ['Jalgaon', 'Jalgaon', '🍌'],
      15: ['Swargate ST Stand', 'Swargate ST', '🚌'],
      16: ['Akola', 'Akola', '🧶'],
      17: ['Tijori', 'Tijori', '💰'],
      18: ['Amravati', 'Amravati', '🏞️'],
      19: ['Chandrapur', 'Chandrapur', '🐅'],
      20: ['Chaha Tapri', 'Chaha Tapri', '☕'],
      21: ['Matheran', 'Matheran', '🚞'],
      22: ['Nashib', 'Nashib', '🔮'],
      23: ['Lonavala', 'Lonavala', '🍬'],
      24: ['Mahabaleshwar', 'Mahabaleshwar', '🍓'],
      25: ['Pune Junction', 'Pune Jn', '🚂'],
      26: ['Malvan', 'Malvan', '🐟'],
      27: ['Alibag', 'Alibag', '🏖️'],
      28: ['Pani Board', 'Pani Board', '💧'],
      29: ['Ratnagiri', 'Ratnagiri', '🥭'],
      30: ['Police Chowki', 'Police Chowki', '🚓'],
      31: ['Nashik', 'Nashik', '🍷'],
      32: ['Thane', 'Thane', '🌉'],
      33: ['Tijori', 'Tijori', '💰'],
      34: ['Nagpur', 'Nagpur', '🍊'],
      35: ['Nagpur Junction', 'Nagpur Jn', '🚂'],
      36: ['Nashib', 'Nashib', '🔮'],
      37: ['Pune', 'Pune', '🏯'],
      38: ['GST', 'GST', '🧾'],
      39: ['Mumbai', 'Mumbai', '🌆'],
    },
  },
};

// The world names, captured before any edition is applied.
const BASE = {
  tiles: TILES.map((t) => [t.name, t.short, t.icon] as [string, string, string]),
  groups: Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, g.name])),
  cards: CARDS.map((c) => [c.title, c.text] as [string, string]),
};

let current: Edition = EDITIONS.world;
let swapper: ((s: string) => string) | null = null;

export function currentEdition() {
  return current;
}

export function currency() {
  return current.currency;
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Formats an amount in the edition's currency (Indian digit grouping for rupees). */
export function formatMoney(n: number) {
  return `${current.currency}${Math.round(n).toLocaleString(current.currency === '₹' ? 'en-IN' : 'en-US')}`;
}

/** Turns world-edition text (names, "Skyport", "$") into the current edition's wording. */
export function localize(text: string): string {
  if (!swapper && current.currency === '$') return text;
  return (swapper ? swapper(text) : text).replace(/\$(?=\d)/g, current.currency);
}

/** Switches every displayed name to an edition. Engine numbers are untouched. */
export function applyEdition(id: string | undefined) {
  const base = EDITIONS[(id as EditionId) ?? 'world'] ?? EDITIONS.world;
  // In Marathi every board uses Devanagari names; icons and everything else stay the same.
  const mr = getLang() === 'mr' ? MR_NAMES[base.id] : undefined;
  current = mr
    ? {
        ...base,
        decks: mr.decks,
        words: mr.words,
        groups: mr.groups,
        tiles: Object.fromEntries(TILES.map((_, i) => [i, [mr.tiles[i][0], mr.tiles[i][1], (base.tiles[i] ?? BASE.tiles[i])[2]]])),
      }
    : base;
  TILES.forEach((t, i) => {
    const [name, short, icon] = current.tiles[i] ?? BASE.tiles[i];
    t.name = name;
    t.short = short;
    t.icon = icon;
  });
  for (const [k, g] of Object.entries(GROUPS)) g.name = current.groups[k] ?? BASE.groups[k];
  // One-pass replacement of every world name, so a new name is never replaced again.
  const pairs = new Map<string, string>();
  BASE.tiles.forEach(([name], i) => {
    // "Busted!" also appears as an exclamation in the log, so it keeps its wording there.
    if (current.tiles[i] && current.tiles[i][0] !== name && name !== 'Busted!') pairs.set(name, current.tiles[i][0]);
  });
  for (const [from, to] of current.words) pairs.set(from, to);
  pairs.set('Fortune', current.decks.fortune);
  pairs.set('Treasury', current.decks.treasury);
  const keys = [...pairs.keys()].filter((k) => pairs.get(k) !== k).sort((a, b) => b.length - a.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = keys.length ? new RegExp(keys.map(esc).join('|'), 'g') : null;
  swapper = re ? (s) => s.replace(re, (m) => pairs.get(m) ?? m) : null;
  CARDS.forEach((c, i) => {
    const mrCard = mr && MR_CARDS[c.id];
    if (mrCard) {
      c.title = mrCard[0];
      c.text = mrCard[1].replace(/\{(t|m)(\d+)\}|\{transit\}/g, (m, kind?: string, n?: string) =>
        kind === 't' ? TILES[+n!].name : kind === 'm' ? formatMoney(+n!) : current.words[1]?.[1] ?? m,
      );
    } else {
      c.title = BASE.cards[i][0];
      c.text = localize(BASE.cards[i][1]);
    }
  });
}
