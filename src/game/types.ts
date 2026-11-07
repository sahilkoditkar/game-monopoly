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
  /** Team number (0 or 1) when playing in teams. */
  team?: number;
}

/** Race goals: the first player (or team) to reach one wins. */
export type RaceGoal = 'worth5000' | 'worth7500' | 'sets3';

export interface Settings {
  startingCash: number;
  salary: number;
  auctions: boolean;
  jackpot: boolean;
  /** 0 = play until one player remains; otherwise the game ends after this many rounds. */
  roundLimit: number;
  /** Board edition: only names and the currency symbol change (see editions.ts). */
  edition?: string;
  /** Quick game: every player starts with two random cities. */
  quickStart?: boolean;
  /** House rule: a news event shakes up rents (or cash) at the start of each round. */
  news?: boolean;
  /** House rule: each player gets a secret mission worth a bonus. */
  missions?: boolean;
  /** House rule: players hold up to 3 action cards and may play one per turn. */
  actionCards?: boolean;
  /** Daily challenge date (YYYY-MM-DD) when this is the daily game. */
  daily?: string;
  /** Race mode: the first to reach this goal wins (otherwise: last one standing). */
  goal?: RaceGoal;
  /** Team mode: players have a `team`; teammates pay no rent to each other and share sets. */
  teams?: boolean;
  /** House rule: up to 2 houses on a city before owning its whole colour set. */
  earlyBuild?: boolean;
}

export type ActionCard = 'boost' | 'holiday' | 'half' | 'free';

export type MissionKind = 'set' | 'stations' | 'utilities' | 'cash' | 'hotel' | 'props' | 'rent';

export interface Mission {
  kind: MissionKind;
  /** Colour set for 'set' missions. */
  group?: string;
  done: boolean;
}

/** A running news effect: rents on `target` (a colour set, 'transit' or 'utility') × `mult` until the end of round `until`. */
export interface NewsEffect {
  target: string;
  mult: number;
  until: number;
}

/** Action-card effects for the current turn. */
export interface TurnEffects {
  played?: boolean;
  boost?: boolean;
  holiday?: boolean;
  half?: boolean;
  free?: boolean;
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
  team?: number;
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

/** Running statistics for the end-of-game summary. */
export interface GameStats {
  /** Net worth of every player at the start of each round, plus the final values. */
  worth: number[][];
  rentPaid: number[];
  rentGot: number[];
  jail: number[];
  /** Rent earned per tile index. */
  tileRent: Record<number, number>;
  biggest: { amount: number; from: number; to: number; tile: number } | null;
}

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
  /** Optional so saves from before stats existed still load. */
  stats?: GameStats;
  /** Separate random stream for dice, so the same seed always gives the same rolls. */
  diceSeed?: number;
  /** The winning team in team mode. */
  winnerTeam?: number | null;
  news?: NewsEffect[];
  missions?: Mission[];
  hands?: ActionCard[][];
  turnFx?: TurnEffects;
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
  | { type: 'log'; text: string }
  | { type: 'news'; text: string }
  | { type: 'mission'; player: number }
  | { type: 'actionCard'; player: number; card: ActionCard };
