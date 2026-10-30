export type TileKind =
  | 'start'
  | 'property'
  | 'transit'
  | 'utility'
  | 'tax'
  | 'fortune'
  | 'treasury'
  | 'jail'
  | 'lounge'
  | 'gotojail';

export interface GroupDef {
  id: string;
  name: string;
  color: string;
  houseCost: number;
}

export interface TileDef {
  index: number;
  kind: TileKind;
  name: string;
  short: string;
  icon: string;
  price?: number;
  group?: string;
  /** Rent with 0..4 houses, then hotel (index 5). */
  rents?: number[];
  tax?: number;
}

export type Deck = 'fortune' | 'treasury';

export type CardEffect =
  | { type: 'advance'; to: number; collectStart: boolean }
  | { type: 'nearest'; kind: 'transit' | 'utility' }
  | { type: 'back'; steps: number }
  | { type: 'money'; amount: number }
  | { type: 'each'; amount: number }
  | { type: 'repairs'; house: number; hotel: number }
  | { type: 'jail' }
  | { type: 'jailFree' };

export interface CardDef {
  id: string;
  deck: Deck;
  title: string;
  text: string;
  effect: CardEffect;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface PlayerConfig {
  name: string;
  token: string;
  color: string;
  ai: boolean;
  difficulty?: Difficulty;
}

export interface Settings {
  startingCash: number;
  salary: number;
  auctions: boolean;
  jackpot: boolean;
  /** 0 = play until one player remains; otherwise the game ends after this many rounds. */
  roundLimit: number;
}

export interface Player {
  id: number;
  name: string;
  token: string;
  color: string;
  ai: boolean;
  difficulty: Difficulty;
  cash: number;
  pos: number;
  inJail: boolean;
  jailTurns: number;
  jailCards: Deck[];
  bankrupt: boolean;
}

export interface Ownership {
  owner: number;
  houses: number; // 0..4 houses, 5 = hotel
  mortgaged: boolean;
}

export interface Debt {
  from: number;
  to: number | null; // null = bank
  amount: number;
  reason: string;
  /** Bank payments that feed the Sky Lounge jackpot. */
  toPot?: boolean;
}

export interface Auction {
  tile: number;
  bid: number;
  bidder: number | null;
  /** Players still in the auction, in bidding order. */
  active: number[];
  /** Index into `active` of who acts next. */
  turn: number;
}

export interface TradeSide {
  cash: number;
  tiles: number[];
  jailCards: number;
}

export interface TradeOffer {
  from: number;
  to: number;
  give: TradeSide;
  get: TradeSide;
}

export type Phase = 'roll' | 'buy' | 'auction' | 'debt' | 'end' | 'gameover';

export interface GameState {
  version: 1;
  seed: number;
  players: Player[];
  props: Record<number, Ownership>;
  current: number;
  phase: Phase;
  dice: [number, number];
  doublesCount: number;
  /** Set when the current turn earned another roll from doubles. */
  rollAgain: boolean;
  auction: Auction | null;
  debts: Debt[];
  /** Phase to return to once all debts are settled. */
  resume: 'buy' | 'roll' | 'end';
  decks: Record<Deck, string[]>;
  jackpot: number;
  round: number;
  turnCount: number;
  winner: number | null;
  settings: Settings;
  log: string[];
  /** Last card drawn, for UI display. */
  lastCard: string | null;
}

export type GameEvent =
  | { type: 'turn'; player: number }
  | { type: 'roll'; player: number; dice: [number, number]; doubles: boolean }
  | { type: 'move'; player: number; path: number[]; jump?: boolean }
  | { type: 'money'; player: number; delta: number; reason: string }
  | { type: 'pay'; from: number; to: number | null; amount: number; reason: string }
  | { type: 'buy'; player: number; tile: number; price: number }
  | { type: 'card'; player: number; card: string }
  | { type: 'jail'; player: number }
  | { type: 'leaveJail'; player: number }
  | { type: 'build'; player: number; tile: number; houses: number }
  | { type: 'mortgage'; player: number; tile: number; mortgaged: boolean }
  | { type: 'auctionStart'; tile: number }
  | { type: 'bid'; player: number; amount: number }
  | { type: 'auctionPass'; player: number }
  | { type: 'auctionEnd'; tile: number; winner: number | null; amount: number }
  | { type: 'trade'; offer: TradeOffer; accepted: boolean }
  | { type: 'fullSet'; player: number; group: string }
  | { type: 'jackpot'; player: number; amount: number }
  | { type: 'bankrupt'; player: number; to: number | null }
  | { type: 'gameover'; winner: number | null }
  | { type: 'log'; text: string };
