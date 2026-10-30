import type { GroupDef, TileDef } from './types';

export const GROUPS: Record<string, GroupDef> = {
  harbor: { id: 'harbor', name: 'Harbor Cities', color: '#a0613b', houseCost: 50 },
  andes: { id: 'andes', name: 'Andes Peaks', color: '#5ec8f0', houseCost: 50 },
  bazaar: { id: 'bazaar', name: 'Spice Route', color: '#e0559b', houseCost: 100 },
  tango: { id: 'tango', name: 'Tango Coast', color: '#f7931e', houseCost: 100 },
  riviera: { id: 'riviera', name: 'Riviera', color: '#e8423f', houseCost: 150 },
  pacific: { id: 'pacific', name: 'Pacific Rim', color: '#f5c518', houseCost: 150 },
  alpine: { id: 'alpine', name: 'Alpine League', color: '#21a65a', houseCost: 200 },
  skyline: { id: 'skyline', name: 'Skyline Elite', color: '#4b4fd6', houseCost: 200 },
};

const round5 = (n: number) => Math.max(2, Math.round(n / 5) * 5);

/** Rent table derived from the price: base, 1-4 houses, hotel. */
export function rentTable(price: number): number[] {
  return [
    Math.max(2, Math.round(price * 0.08)),
    round5(price * 0.35),
    round5(price * 1.0),
    round5(price * 2.6),
    round5(price * 3.4),
    round5(price * 4.2),
  ];
}

const prop = (index: number, name: string, short: string, icon: string, group: string, price: number): TileDef => ({
  index,
  kind: 'property',
  name,
  short,
  icon,
  group,
  price,
  rents: rentTable(price),
});

export const TRANSIT_RENTS = [25, 50, 100, 200];
export const UTILITY_MULTIPLIERS = [4, 10];
export const JAIL_INDEX = 10;
export const GO_TO_JAIL_INDEX = 30;
export const JAIL_FINE = 50;
export const MAX_HOUSES = 32;
export const MAX_HOTELS = 12;

export const TILES: TileDef[] = [
  { index: 0, kind: 'start', name: 'Launch Pad', short: 'START', icon: '🚀' },
  prop(1, 'Lagos', 'Lagos', '🛶', 'harbor', 60),
  { index: 2, kind: 'treasury', name: 'Treasury', short: 'Treasury', icon: '💼' },
  prop(3, 'Nairobi', 'Nairobi', '🦒', 'harbor', 70),
  { index: 4, kind: 'tax', name: 'City Tax', short: 'City Tax', icon: '🏛️', tax: 200 },
  { index: 5, kind: 'transit', name: 'South Skyport', short: 'S. Skyport', icon: '✈️', price: 200 },
  prop(6, 'Lima', 'Lima', '🦙', 'andes', 100),
  { index: 7, kind: 'fortune', name: 'Fortune', short: 'Fortune', icon: '🔮' },
  prop(8, 'Quito', 'Quito', '🌋', 'andes', 100),
  prop(9, 'Bogotá', 'Bogotá', '☕', 'andes', 120),
  { index: 10, kind: 'jail', name: 'Lockup', short: 'Lockup', icon: '🔒' },
  prop(11, 'Cairo', 'Cairo', '🐪', 'bazaar', 140),
  { index: 12, kind: 'utility', name: 'Solar Grid', short: 'Solar Grid', icon: '☀️', price: 150 },
  prop(13, 'Istanbul', 'Istanbul', '🕌', 'bazaar', 150),
  prop(14, 'Mumbai', 'Mumbai', '🎬', 'bazaar', 160),
  { index: 15, kind: 'transit', name: 'West Skyport', short: 'W. Skyport', icon: '✈️', price: 200 },
  prop(16, 'Buenos Aires', 'B. Aires', '💃', 'tango', 180),
  { index: 17, kind: 'treasury', name: 'Treasury', short: 'Treasury', icon: '💼' },
  prop(18, 'Rio de Janeiro', 'Rio', '🏖️', 'tango', 190),
  prop(19, 'Mexico City', 'Mexico City', '🌮', 'tango', 200),
  { index: 20, kind: 'lounge', name: 'Sky Lounge', short: 'Sky Lounge', icon: '🍸' },
  prop(21, 'Barcelona', 'Barcelona', '⛪', 'riviera', 220),
  { index: 22, kind: 'fortune', name: 'Fortune', short: 'Fortune', icon: '🔮' },
  prop(23, 'Rome', 'Rome', '🏛️', 'riviera', 230),
  prop(24, 'Paris', 'Paris', '🗼', 'riviera', 240),
  { index: 25, kind: 'transit', name: 'North Skyport', short: 'N. Skyport', icon: '✈️', price: 200 },
  prop(26, 'Sydney', 'Sydney', '🦘', 'pacific', 260),
  prop(27, 'Seoul', 'Seoul', '🎤', 'pacific', 270),
  { index: 28, kind: 'utility', name: 'Fiber Net', short: 'Fiber Net', icon: '📡', price: 150 },
  prop(29, 'Singapore', 'Singapore', '🦁', 'pacific', 280),
  { index: 30, kind: 'gotojail', name: 'Busted!', short: 'Busted!', icon: '🚨' },
  prop(31, 'Zurich', 'Zurich', '🏔️', 'alpine', 300),
  prop(32, 'Vienna', 'Vienna', '🎻', 'alpine', 310),
  { index: 33, kind: 'treasury', name: 'Treasury', short: 'Treasury', icon: '💼' },
  prop(34, 'Stockholm', 'Stockholm', '🛳️', 'alpine', 320),
  { index: 35, kind: 'transit', name: 'East Skyport', short: 'E. Skyport', icon: '✈️', price: 200 },
  { index: 36, kind: 'fortune', name: 'Fortune', short: 'Fortune', icon: '🔮' },
  prop(37, 'Dubai', 'Dubai', '🏙️', 'skyline', 360),
  { index: 38, kind: 'tax', name: 'Yacht Tax', short: 'Yacht Tax', icon: '🛥️', tax: 120 },
  prop(39, 'Tokyo', 'Tokyo', '🗾', 'skyline', 400),
];

export const BUYABLE = TILES.filter((t) => t.price !== undefined).map((t) => t.index);

export function groupTiles(group: string): number[] {
  return TILES.filter((t) => t.group === group).map((t) => t.index);
}

export function isBuyable(index: number): boolean {
  return TILES[index].price !== undefined;
}

export function mortgageValue(index: number): number {
  return Math.floor((TILES[index].price ?? 0) / 2);
}

export function unmortgageCost(index: number): number {
  return Math.ceil(mortgageValue(index) * 1.1);
}

export function houseCost(index: number): number {
  const g = TILES[index].group;
  return g ? GROUPS[g].houseCost : 0;
}
