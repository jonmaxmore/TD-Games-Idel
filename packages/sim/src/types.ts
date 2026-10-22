import type { Element, TargetMode } from './data';
import type { Pt } from './layouts';

export type Command =
  | { t: 'place'; sect: Element; tx: number; ty: number }
  | { t: 'upgrade'; id: number }
  | { t: 'sell'; id: number }
  | { t: 'merge'; a: number; b: number }
  | { t: 'nextWave' }
  | { t: 'route'; choice: 'left' | 'right' }
  | { t: 'skill'; member: number }
  | { t: 'cast'; art: string }
  | { t: 'pick'; card: string }
  | { t: 'target'; id: number; mode: TargetMode };

export type SimEvent =
  | { e: 'hit'; from: number; to: number; dmg: number; pct: number; crit: boolean; el: Element }
  | { e: 'kill'; id: number; x: number; y: number; bounty: number }
  | { e: 'leak'; id: number }
  | { e: 'spawn'; id: number }
  | { e: 'placed'; id: number }
  | { e: 'combo'; id: number; combo: string; nameTh: string }
  | { e: 'wave'; wave: number }
  | { e: 'interest'; amount: number }
  | { e: 'stun'; id: number; by: number }
  | { e: 'error'; msg: string }
  | { e: 'outpostHit'; member: number; outpost: number; dmg: number; skill: boolean }
  | { e: 'memberHit'; outpost: number; member: number; dmg: number }
  | { e: 'outpostDown'; outpost: number }
  | { e: 'memberDown'; member: number }
  | { e: 'pill'; at: Pt }
  | { e: 'art'; art: string; x: number; y: number }
  | { e: 'offer'; cards: string[] }
  | { e: 'picked'; card: string }
  | { e: 'newEnemy'; type: string }
  | { e: 'disable'; id: number; by: number }
  | { e: 'seal'; el: Element; by: number }
  | { e: 'end'; won: boolean; stars: boolean[] };

export interface Disciple {
  id: number;
  els: Element[];
  combo: string | null;
  level: number;
  tx: number;
  ty: number;
  x: number;
  y: number;
  cd: number;
  hits: number;
  spent: number;
  rootT: number;
  pushT: number;
  bellT: number;
  target: TargetMode;
  offT: number; // ticks disabled by a boss
}

export interface Enemy {
  id: number;
  type: string;
  el: Element;
  air: boolean;
  hp: number;
  maxHp: number;
  d: number;
  speed: number;
  bounty: number;
  x: number;
  y: number;
  slowT: number;
  slowPct: number;
  burnT: number;
  burnDps: number;
  poison: number;
  poisonT: number;
  poisonDps: number;
  stunT: number;
  revealed: boolean;
  lastEl: Element | null;
  lastElT: number;
  small: boolean;
  age: number;
  elite: string | null;
  regenPct: number;
  phase: number; // boss phases already triggered
}

// One enemy waiting to spawn; waves can overlap when the next one is called early.
export interface QueuedEnemy {
  type: string;
  wave: number;
  hpPct: number;
}

export interface DefendState {
  kind: 'defend';
  stageId: string;
  tick: number;
  rng: number;
  silver: number;
  lives: number;
  wave: number;
  totalWaves: number;
  phase: 'build' | 'spawning' | 'clearing' | 'break' | 'picking' | 'won' | 'lost';
  spawnQueue: QueuedEnemy[];
  recipe: string; // shape of the current wave (enemies.json waveRecipes)
  nextRecipe: string; // already rolled, so the HUD can preview it
  cardsOffered: number;
  sealEl: Element | null;
  sealT: number;
  artCharges: number[];
  spawnT: number;
  breakT: number;
  disciples: Disciple[];
  enemies: Enemy[];
  nextId: number;
  unlocked: Element[];
  path: Pt[];
  pathLen: number;
  pathTiles: string[];
  blockedTiles: string[];
  livesLost: number;
  combosMade: number;
  peakDisciples: number;
  artCd: number[];
  bountyMultT: number;
  revealAllT: number;
  cards: string[];
  offer: string[] | null;
  offerT: number;
  seenTypes: string[];
  stars: boolean[] | null;
}

export interface Member {
  id: number;
  el: Element;
  hp: number;
  maxHp: number;
  dmg: number;
  cooldown: number;
  cd: number;
  skillCd: number;
  x: number;
  y: number;
}

export interface OutpostState {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dmg: number;
  cd: number;
  route: 'any' | 'left' | 'right';
  down: boolean;
}

export interface AssaultState {
  kind: 'assault';
  stageId: string;
  tick: number;
  rng: number;
  route: 'left' | 'right' | null;
  d: number;
  path: Pt[];
  pathLen: number;
  forkAt: number;
  members: Member[];
  outposts: OutpostState[];
  pills: Pt[];
  phase: 'moving' | 'fighting' | 'choosing' | 'won' | 'lost';
  membersLost: number;
  stars: boolean[] | null;
}

export type GameState = DefendState | AssaultState;
