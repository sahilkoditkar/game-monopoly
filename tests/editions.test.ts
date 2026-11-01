import { afterEach, describe, expect, it } from 'vitest';
import { GROUPS, TILES } from '../src/game/board';
import { CARDS } from '../src/game/cards';
import { EDITIONS, applyEdition, formatMoney, localize } from '../src/game/editions';

const snapshot = () => TILES.map((t) => ({ price: t.price, rents: t.rents, tax: t.tax, group: t.group, kind: t.kind }));

describe('board editions', () => {
  afterEach(() => applyEdition('world'));

  it('every edition renames all 40 tiles and all 8 groups', () => {
    for (const e of Object.values(EDITIONS)) {
      if (e.id === 'world') continue;
      expect(Object.keys(e.tiles)).toHaveLength(40);
      expect(Object.keys(e.groups).sort()).toEqual(Object.keys(GROUPS).sort());
      const cities = TILES.filter((t) => t.kind === 'property').map((t) => e.tiles[t.index][0]);
      expect(new Set(cities).size).toBe(cities.length);
    }
  });

  it('changes names only, never prices or rules', () => {
    const before = snapshot();
    applyEdition('maharashtra');
    expect(snapshot()).toEqual(before);
    expect(TILES[39].name).toBe('Mumbai');
    expect(TILES[10].name).toBe('Turung');
    expect(GROUPS.skyline.name).toBe('Metro');
  });

  it('localizes log text and card texts, and switches back cleanly', () => {
    applyEdition('india');
    expect(localize('Ana passed the Launch Pad and collected $200.')).toBe('Ana passed the Shubh Aarambh and collected ₹200.');
    expect(localize('Go to the nearest Skyport.')).toBe('Go to the nearest railway station.');
    // World "Mumbai" (tile 14) becomes "Jaipur"; the one-pass swap never re-swaps the new name.
    expect(localize('Go to Mumbai.')).toBe('Go to Jaipur.');
    expect(CARDS.some((c) => c.text.includes('$'))).toBe(false);
    expect(formatMoney(150000)).toBe('₹1,50,000');
    applyEdition('world');
    expect(TILES[39].name).not.toBe('Delhi');
    expect(localize('Pay $50')).toBe('Pay $50');
    expect(CARDS.some((c) => c.text.includes('Launch Pad'))).toBe(true);
  });
});
