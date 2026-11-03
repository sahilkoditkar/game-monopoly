import { GROUPS } from './board';
import type { ActionCard, Mission, MissionKind } from './types';

/**
 * Definitions for the optional house rules: news events, secret missions and action cards.
 * Texts are English; the UI translates them like every other engine sentence.
 */

/** Rent effects a news event can apply. `flavours` are the headline openers. */
export const NEWS_EVENTS = [
  { kind: 'boom', weight: 3, mult: 2, rounds: 2, flavours: ['Big match in', 'Festival rush in', 'New metro line in'] },
  { kind: 'slump', weight: 3, mult: 0.5, rounds: 2, flavours: ['Monsoon floods', 'Traffic jams in', 'Water shortage in'] },
  { kind: 'fuel', weight: 1, mult: 2, rounds: 2, flavours: [] },
  { kind: 'strike', weight: 1, mult: 0, rounds: 1, flavours: [] },
  { kind: 'powercut', weight: 1, mult: 0, rounds: 1, flavours: [] },
  { kind: 'bonus', weight: 1, mult: 1, rounds: 0, flavours: [] },
  { kind: 'tax', weight: 1, mult: 1, rounds: 0, flavours: [] },
  { kind: 'quiet', weight: 2, mult: 1, rounds: 0, flavours: [] },
] as const;

export const NEWS_BONUS = 100;
export const NEWS_TAX = 50;

export const MISSION_KINDS: MissionKind[] = ['set', 'set', 'stations', 'utilities', 'cash', 'hotel', 'props', 'rent'];
export const MISSION_REWARD = 500;
export const MISSION_CASH = 2500;
export const MISSION_PROPS = 8;
export const MISSION_RENT = 800;

export const ACTION_CARDS: ActionCard[] = ['boost', 'holiday', 'half', 'free'];
export const HAND_LIMIT = 3;
export const BOOST_STEPS = 3;

/** English names used in log lines. */
export const CARD_NAMES: Record<ActionCard, string> = {
  boost: 'Boost +3',
  holiday: 'Rent holiday',
  half: 'Half price',
  free: 'Free house',
};

/** A mission in English, e.g. "Own all of Riviera" (translated for display like engine text). */
export function missionText(m: Mission): string {
  switch (m.kind) {
    case 'set':
      return `Own all of ${GROUPS[m.group!].name}`;
    case 'stations':
      return 'Own 3 Skyports';
    case 'utilities':
      return 'Own both utilities';
    case 'cash':
      return `Have $${MISSION_CASH} in cash`;
    case 'hotel':
      return 'Build a hotel';
    case 'props':
      return `Own ${MISSION_PROPS} properties`;
    case 'rent':
      return `Collect $${MISSION_RENT} in rent`;
  }
}
