// The castle-battle field in 2.5D pixel art with plain Canvas 2D: a 3/4 top-down board (tiles squashed vertically), the
// one path between the two castles, the forts on it, and upright pixel figures drawn back to front. The canvas buffer is
// full resolution; the procedural drawing works in board units of 2 stage pixels scaled up K = 3 times (setTransform).
// It only reads the sim state; it never changes it.
import {
  battle, BATTLE_LEN, BATTLE_PATH, battleUnits, palette, pointAt, sects, TILE, tilesOnPath,
  type BattleEvent, type BattleState, type BattleUnitDef, type Side,
} from '@five-sects/sim';

const PAD = 6;
const GRID = battle.grid;
const PATH_TILES = tilesOnPath(battle.path);

// Side colours: the player's rim and banners are gold, the enemy's red (each figure's robe stays its sect colour).
export const SIDE = ['#E3B04B', '#D2412F'] as const;
const NEUTRAL = '#C8C4CC';
const HP_BAR = ['#4FB3FF', '#E23B2E'] as const;
const FX = { gold: '#E3B04B', star: '#FFE08A', glint: '#FFFFFF', fire: '#FF5A1F', poison: '#5BC46A', heal: '#9FDCA7', ice: '#C9E6F7' };
const KIT_LOOK: Record<string, [string, string]> = { // projectile [body, highlight] per kit
  metal: ['#9FB3CA', '#FFFFFF'], fire: ['#FF5A1F', '#FFE08A'], water: ['#4FB3FF', '#ABDBFF'], earth: ['#836127', '#DEC191'],
  wood: ['#3DA94C', '#9FDCA7'], yinyang: ['#1A1423', '#F2F2F2'],
};
const TRAIL: Record<string, string[]> = { // trail colours per kit, newest first
  metal: ['#FFFFFF', '#D9E1EA', '#9FB3CA'], fire: ['#FFE08A', '#FF5A1F', '#B12F00'], water: ['#ABDBFF', '#4FB3FF', '#0076CF'],
  earth: ['#DEC191', '#A97D33', '#5F471C'], wood: ['#9FDCA7', '#3DA94C', '#225F2B'], yinyang: ['#F2F2F2', '#1A1423', '#F2F2F2'],
};
// 3x5 digits, row by row.
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001010010010', '111101111101111', '111101111001111'];

// Scenery props as pixel rects [dx, dy, w, h, colour] from the tile's ground point.
type Rect = [number, number, number, number, string];
const PROP_ART: Record<string, Rect[]> = {
  house: [[-8, -10, 16, 10, '#6E4A30'], [3, -10, 5, 10, '#553722'], [-2, -6, 4, 6, '#1A1210'], [-6, -8, 3, 2, '#F2A23A'],
    [-10, -16, 20, 6, '#3A3442'], [-11, -17, 22, 2, '#5A5266'], [-11, -11, 2, 1, '#5A5266'], [9, -11, 2, 1, '#5A5266']],
  tree: [[-1, -5, 3, 5, '#4A3020'], [-7, -9, 14, 4, '#225F2B'], [2, -9, 5, 4, '#173F1D'], [-5, -13, 10, 4, '#2F833B'],
    [1, -13, 4, 4, '#225F2B'], [-3, -17, 6, 4, '#3DA94C'], [-1, -19, 2, 2, '#3DA94C']],
  rock: [[-8, -8, 16, 8, '#3A3540'], [-8, -10, 16, 3, '#4E4858'], [3, -7, 5, 7, '#2A2630']],
  bamboo: [[-6, -18, 2, 18, '#3DA94C'], [-1, -22, 2, 22, '#5BC46A'], [4, -16, 2, 16, '#2F833B'], [-6, -12, 2, 1, '#225F2B'],
    [-1, -15, 2, 1, '#225F2B'], [-1, -8, 2, 1, '#225F2B'], [4, -9, 2, 1, '#225F2B'], [-9, -17, 3, 1, '#5BC46A'], [1, -21, 4, 1, '#9FDCA7']],
  lantern: [[-1, -16, 2, 16, '#3A2A24'], [-1, -16, 6, 1, '#3A2A24'], [2, -15, 5, 1, '#E3B04B'], [2, -14, 5, 6, '#D2412F'], [3, -13, 3, 4, '#F2A23A'],
    [4, -12, 1, 2, '#FFE08A'], [2, -8, 5, 1, '#E3B04B']],
};
const PROP_KINDS = ['tree', 'tree', 'bamboo', 'rock', 'tree', 'house', 'bamboo', 'lantern'];

interface Live { t0: number; t1: number } // visible from t0 until t1 (ms, performance.now)
// A drawn unit: position eased toward the sim's (milli-tiles), when a hit lands (then two white frames), knockback, walking.
interface Seen { x: number; y: number; card: string; side: Side; flash: number; white: number; kickT: number; kx: number; ky: number; walk: number }

// Combat feel (client only, from sim events). Times in ms, distances in board units.
const LUNGE_MS = 170, LUNGE = 4;
const KICK_MS = 130, KICK = 2;
const STOP_FRAMES = 3, STOP_GAP = 400; // hit-stop on big hits: frames held, and the least time between two
const GLOW_CAP = 24; // additive glows per frame; past it the rest are skipped
const NUM_CAP = 24; // live plain damage numbers; past it plain hits show none

class Pool<T extends Live> {
  readonly items: T[];
  private i = 0;
  constructor(n: number, make: () => T) { this.items = Array.from({ length: n }, make); }
  take(t0: number, t1: number): T {
    const p = this.items[this.i]!;
    this.i = (this.i + 1) % this.items.length;
    p.t0 = t0; p.t1 = t1;
    return p;
  }
}

const defOf = (card: string): BattleUnitDef => battleUnits.get(card)!;
const ranged = (d: BattleUnitDef) => d.range > battle.meleeRange;
const at = (d: number) => pointAt(BATTLE_PATH, d);
const hash = (a: number, b: number) => (((a * 73856093) ^ (b * 19349663)) >>> 0) % 997;

// Where the player aims a card: a path distance (from side 0's castle) and whether a summon there would be accepted.
export interface Aim { d: number; ok: boolean; card: string }

export class Board {
  private g: CanvasRenderingContext2D;
  private readonly K = 3;
  private W = 0; private H = 0; // board units across and down
  private ox = 0; private oy = 0;
  private T = 26; private TH = 16; // tile size in board units: T across, TH deep
  private shx = 0; private shy = 0;
  private bg = document.createElement('canvas');
  private seen = new Map<number, Seen>();
  private lunges = new Map<number, { t0: number; ux: number; uy: number }>();
  private hitAt = new Map<string, number>(); // 'c0', 'f2': when a castle or fort was last struck (white flash, shiver)
  private props: { type: string; tx: number; ty: number }[] = [];
  private shots = new Pool(128, () => ({ t0: 0, t1: 0, x0: 0, y0: 0, x1: 0, y1: 0, kit: '', big: false, crit: false }));
  private nums = new Pool(64, () => ({ t0: 0, t1: 0, x: 0, y: 0, v: 0, crit: false, heal: false, to: 0 }));
  private rings = new Pool(48, () => ({ t0: 0, t1: 0, x: 0, y: 0, rx: 0, ry: 0, c: '', slash: false }));
  private shards = new Pool(256, () => ({ t0: 0, t1: 0, x: 0, y: 0, vx: 0, vy: 0, c: '' }));
  private ghosts = new Pool(32, () => ({ t0: 0, t1: 0, x: 0, y: 0, card: '', side: 0 as Side }));
  private stop = 0; private stopAt = -Infinity;
  private glows = 0;
  private shakeT = 0; private shakeA = 0;
  private flashT = 0; // the bell's gold wash over the board
  private font = digitSheet([FX.star, FX.glint, FX.heal]); // normal, crit, heal
  shake = true;
  aim: Aim | null = null;
  armed = false; // a card is picked: the summon zone shows bright

  constructor(private canvas: HTMLCanvasElement, private s: BattleState, private inset: { top: number; bottom: number }) {
    this.g = canvas.getContext('2d')!;
    for (let ty = 0; ty < GRID.h; ty++)
      for (let tx = 0; tx < GRID.w; tx++) {
        const near = [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => PATH_TILES.has(`${tx + dx},${ty + dy}`)));
        const castle = (tx <= 4 || tx >= GRID.w - 5) && ty >= 3 && ty <= 8;
        const h = hash(tx, ty);
        if (!near && !castle && h % 5 === 0) this.props.push({ type: PROP_KINDS[h % PROP_KINDS.length]!, tx, ty });
      }
    this.resize();
  }

  // The board unit is 2 stage pixels whatever the window (CSS scales the stage), so the buffer is a fixed size.
  resize(): void {
    this.W = Math.floor(this.canvas.clientWidth / 2); this.H = Math.floor(this.canvas.clientHeight / 2);
    this.canvas.width = this.W * this.K; this.canvas.height = this.H * this.K;
    const top = Math.round(this.inset.top / 2) + 28, bottom = Math.round(this.inset.bottom / 2) + 10;
    this.T = Math.floor((this.W - 2 * PAD) / GRID.w);
    this.TH = Math.max(Math.round(this.T * 0.55), Math.min(this.T, Math.floor((this.H - top - bottom) / GRID.h)));
    this.ox = Math.floor((this.W - GRID.w * this.T) / 2);
    this.oy = top + Math.max(0, Math.floor((this.H - top - bottom - GRID.h * this.TH) / 2));
    this.paintGround();
  }

  private sx = (x: number) => Math.round(this.ox + (x / TILE) * this.T);
  private sy = (y: number) => Math.round(this.oy + (y / TILE) * this.TH);

  // The path distance nearest a client point, and how far off the path it is in tiles; null off the board.
  pathAt(clientX: number, clientY: number): { d: number; off: number } | null {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return null;
    const bx = ((clientX - r.left) / r.width) * this.W, by = ((clientY - r.top) / r.height) * this.H;
    const x = ((bx - this.ox) / this.T) * TILE, y = ((by - this.oy) / this.TH) * TILE;
    if (x < 0 || y < -TILE || x > GRID.w * TILE || y > GRID.h * TILE) return null;
    let best = { d: 0, off: Infinity }, run = 0;
    for (let i = 1; i < BATTLE_PATH.length; i++) {
      const a = BATTLE_PATH[i - 1]!, b = BATTLE_PATH[i]!, len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const t = len ? Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (len * len))) : 0;
      const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t, off = Math.hypot(x - px, y - py) / TILE;
      if (off < best.off) best = { d: Math.round(run + len * t), off };
      run += len;
    }
    return best;
  }

  // A path distance to CSS pixels inside the canvas (for a test driving the mouse).
  toClient(d: number): { x: number; y: number } {
    const p = at(d), k = this.canvas.clientWidth / this.W;
    return { x: this.sx(p.x) * k, y: this.sy(p.y) * k };
  }

  sync(s: BattleState, now: number): void {
    this.s = s;
    for (const u of s.units) {
      const p = at(u.d), q = this.seen.get(u.id);
      if (!q) { this.seen.set(u.id, { x: p.x, y: p.y, card: u.card, side: u.side, flash: 0, white: 0, kickT: 0, kx: 0, ky: 0, walk: 0 }); continue; }
      const dx = p.x - q.x, dy = p.y - q.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) q.walk = now;
      q.x += dx * 0.35; q.y += dy * 0.35;
    }
    for (const id of this.seen.keys()) if (!s.units.some((u) => u.id === id)) this.seen.delete(id);
  }

  // A unit's drawn ground point in board units: its eased path point, each side a little up or down the road, spread by id.
  private spot(id: number, q: { x: number; y: number; side: Side }): [number, number] {
    return [this.sx(q.x) + (((id * 13) % 7) - 3) * 2, this.sy(q.y) + (q.side === 0 ? -4 : 4) + (((id * 7) % 5) - 2) * 2];
  }
  private castleAt(side: Side): [number, number] {
    const p = BATTLE_PATH[side === 0 ? 0 : BATTLE_PATH.length - 1]!;
    return [this.sx(p.x) + (side === 0 ? -1 : 1) * Math.round(this.T * 0.9), this.sy(p.y) + Math.round(this.TH * 0.45)];
  }
  private fortAt(i: number): [number, number] {
    const p = at(this.s.forts[i]!.d);
    return [this.sx(p.x), this.sy(p.y) - Math.round(this.TH * 0.62)];
  }
  // Where an attacker fires from and a target is struck, in board units; null when it is gone.
  private source(from: number): [number, number] | null {
    if (from >= 1) { const q = this.seen.get(from); return q ? ((([x, y]) => [x, y - 12])(this.spot(from, q)) as [number, number]) : null; }
    if (from >= -2) { const [x, y] = this.castleAt((-1 - from) as Side); return [x, y - 50]; }
    const [x, y] = this.fortAt(-10 - from); return [x, y - 26];
  }

  // Short-lived visuals for sim events: projectiles or slashes, numbers, flashes, puffs, rings and shakes.
  events(ev: readonly BattleEvent[], now: number, speed = 1): void {
    for (const e of ev) {
      if (e.e === 'spawn') {
        const p = at(this.s.units.find((u) => u.id === e.id)?.d ?? 0);
        const x = this.sx(p.x), y = this.sy(p.y), c = SIDE[e.side as Side];
        this.ring(now, 320, x, y, 10, 5, c);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          Object.assign(this.shards.take(now, now + 380), { x, y: y - 4, vx: Math.cos(a) * 30, vy: Math.sin(a) * 14 - 50, c: i % 2 ? c : FX.glint });
        }
      } else if (e.e === 'hit') this.hit(e, now, speed);
      else if (e.e === 'heal') {
        const q = this.seen.get(e.to!);
        if (q) { const [x, y] = this.spot(e.to!, q); this.number(now, x, y - 28, e.amount!, false, true, e.to!); }
      } else if (e.e === 'kill') {
        const q = this.seen.get(e.id!);
        if (!q) continue;
        const [x, y] = this.spot(e.id!, q);
        Object.assign(this.ghosts.take(now, now + 260), { x, y, card: q.card, side: q.side });
        const c = sects.get(defOf(q.card).sect)?.color ?? NEUTRAL;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4, v = 30 + Math.random() * 40;
          Object.assign(this.shards.take(now, now + 450 + Math.random() * 200), { x, y: y - 6, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 50, c: i % 3 ? c : '#D8C0A8' });
        }
      } else if (e.e === 'capture' || e.e === 'neutral') {
        const [x, y] = this.fortAt(e.id!);
        const c = e.e === 'capture' ? SIDE[e.side as Side] : NEUTRAL;
        this.ring(now, 500, x, y, 22, 11, c); this.ring(now + 120, 500, x, y, 14, 7, c);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2, v = 30 + (i % 3) * 15;
          Object.assign(this.shards.take(now, now + 600), { x, y: y - 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, c: i % 2 ? c : e.e === 'capture' ? FX.star : '#7A4A2A' });
        }
        this.shakeFor(now, 2, 220);
      } else if (e.e === 'art') {
        this.flashT = now;
        const [x, y] = this.castleAt(e.side as Side), r = (BATTLE_LEN / 2 / TILE) * this.T;
        this.ring(now, 700, x, y - 10, r, r * 0.45, FX.gold); this.ring(now + 150, 700, x, y - 10, r * 0.7, r * 0.3, FX.star);
        this.shakeFor(now, 3, 450);
      } else if (e.e === 'stun') {
        const q = this.seen.get(e.id!);
        if (q) { const [x, y] = this.spot(e.id!, q); this.ring(now, 300, x, y - 24, 6, 2, FX.star); }
      } else if (e.e === 'end' && (this.s.castles[0].hp <= 0 || this.s.castles[1].hp <= 0)) this.shakeFor(now, 4, 700);
    }
  }

  private hit(e: BattleEvent, now: number, speed: number) {
    const tgtUnit = e.to != null && e.to >= 1;
    const q = tgtUnit ? this.seen.get(e.to!) : undefined;
    let tx: number, ty: number;
    if (q) { [tx, ty] = this.spot(e.to!, q); ty -= 8; }
    else if (e.type === 'fort') { [tx, ty] = this.fortAt(e.id!); ty -= 14; }
    else if (e.type === 'castle') { [tx, ty] = this.castleAt(e.id as Side); ty -= 24; }
    else return;
    if (e.from == null) { this.number(now, tx, ty - 10, e.dmg!, false, false, e.to ?? -1); return; } // burn or poison tick
    const src = this.source(e.from);
    if (!src) return;
    const [x0, y0] = src, len = Math.hypot(tx - x0, ty - y0) || 1, ux = (tx - x0) / len, uy = (ty - y0) / len;
    const unitDef = e.from >= 1 ? defOf(this.seen.get(e.from)!.card) : null;
    const far = !unitDef || ranged(unitDef);
    const fly = far ? Math.min(240, Math.max(90, len * 5)) : 60;
    if (far) Object.assign(this.shots.take(now, now + fly), { x0, y0, x1: tx, y1: ty, kit: unitDef?.kit ?? 'metal', big: !unitDef, crit: !!e.crit });
    else Object.assign(this.rings.take(now + fly, now + fly + 200), { x: tx, y: ty, rx: 0, ry: 0, c: FX.glint, slash: true });
    if (e.from >= 1) {
      const l = this.lunges.get(e.from);
      if (!l || now - l.t0 >= LUNGE_MS) this.lunges.set(e.from, { t0: now, ux, uy });
    }
    if (q) Object.assign(q, { flash: now + fly, kickT: now + fly, kx: ux, ky: uy });
    else this.hitAt.set(e.type === 'fort' ? `f${e.id}` : `c${e.id}`, now + fly);
    this.number(now + fly, tx, ty - 6, e.dmg!, !!e.crit, false, e.to ?? -1, speed);
    if (e.crit || (e.type === 'castle' && e.dmg! >= 30)) this.impact(now + fly, e.crit ? 2 : 1, speed);
  }

  // Hits on one target within 150 ms times the game speed add up into one number; a crit or a heal is big.
  private number(t0: number, x: number, y: number, v: number, crit: boolean, heal: boolean, to: number, speed = 1) {
    const n = this.nums.items.find((p) => t0 < p.t1 && p.heal === heal && p.to === to && Math.abs(p.t0 - t0) < 150 * speed);
    if (n) { n.v += v; n.crit = false; n.t1 = Math.max(n.t1, t0 + 550); return; }
    if (!crit && !heal && this.nums.items.filter((p) => t0 < p.t1).length >= NUM_CAP) return;
    Object.assign(this.nums.take(t0, t0 + (crit ? 800 : 550)), { x: x + ((to * 7) % 7) - 3, y, v, crit, heal, to });
  }

  private ring(t0: number, ms: number, x: number, y: number, rx: number, ry: number, c: string) {
    Object.assign(this.rings.take(t0, t0 + ms), { x, y, rx, ry, c, slash: false });
  }

  private impact(t: number, amp: number, speed: number) {
    if (t - this.stopAt < STOP_GAP * speed) return;
    this.stopAt = t;
    this.shakeFor(t, amp, 160);
    if (this.shake) this.stop = STOP_FRAMES;
  }

  private shakeFor(now: number, amp: number, ms: number) {
    if (now + ms > this.shakeT) this.shakeT = now + ms;
    this.shakeA = Math.max(now < this.shakeT - ms ? this.shakeA : 0, amp);
  }

  // The static layer: a ridge behind the board, the cliff under it, grass, the path and its edging.
  private paintGround(): void {
    const w = this.W, h = this.H, bw = GRID.w * this.T, bh = GRID.h * this.TH;
    this.bg.width = w; this.bg.height = h;
    const g = this.bg.getContext('2d')!, pal = palette.get('env')!;
    g.fillStyle = '#0B0910'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++) {
      const far = Math.round(16 + 8 * Math.sin(x / 37) + 4 * Math.sin(x / 13 + 2));
      const near = Math.round(7 + 5 * Math.sin(x / 23 + 1) + 3 * Math.sin(x / 7));
      g.fillStyle = pal[3]!; g.fillRect(x, this.oy - 12 - far, 1, far + 12);
      g.fillStyle = pal[1]!; g.fillRect(x, this.oy - near, 1, near);
    }
    const cy = this.oy + bh;
    g.fillStyle = '#1A120C'; g.fillRect(this.ox, cy, bw, h - cy);
    g.fillStyle = '#0F0A08';
    for (let y = cy + 8; y < h; y += 6) g.fillRect(this.ox, y, bw, 1);
    for (let x = this.ox + 7; x < this.ox + bw; x += 23) g.fillRect(x, cy + 2 + (x % 5), 1, 9 + (x % 7));
    for (let tx = 0; tx < GRID.w; tx++)
      for (let ty = 0; ty < GRID.h; ty++) {
        const onPath = PATH_TILES.has(`${tx},${ty}`);
        const px = this.ox + tx * this.T, py = this.oy + ty * this.TH;
        g.fillStyle = onPath ? ((tx + ty) % 2 ? '#7E5E40' : '#86664A') : (tx + ty) % 2 ? '#2E4430' : '#355036';
        g.fillRect(px, py, this.T, this.TH);
        g.fillStyle = onPath ? '#6A4C32' : '#26382A';
        g.fillRect(px + ((tx * 7 + ty * 3) % (this.T - 4)) + 2, py + ((tx * 5 + ty) % Math.max(1, this.TH - 4)) + 2, 2, 1);
        if (onPath) { // a darker lip where the road meets the grass, top and bottom
          g.fillStyle = '#553722';
          if (!PATH_TILES.has(`${tx},${ty - 1}`)) g.fillRect(px, py, this.T, 1);
          if (!PATH_TILES.has(`${tx},${ty + 1}`)) g.fillRect(px, py + this.TH - 1, this.T, 2);
        }
      }
  }

  // The road tiles whose centre lies between path distances d0 and d1 (from side 0), tinted.
  private strip(d0: number, d1: number, color: string, alpha: number) {
    const g = this.g;
    g.globalAlpha = alpha; g.fillStyle = color;
    for (let d = 0; d <= BATTLE_LEN; d += TILE) {
      if (d < d0 - TILE / 2 || d > d1 + TILE / 2) continue;
      const p = at(d);
      g.fillRect(this.ox + Math.floor(p.x / TILE) * this.T, this.oy + Math.floor(p.y / TILE) * this.TH, this.T, this.TH);
    }
    g.globalAlpha = 1;
  }

  render(zones: [number, number]): void {
    const g = this.g, s = this.s, now = performance.now();
    if (this.stop > 0 && now >= this.stopAt) { this.stop--; return; } // hit-stop: the last picture stays up
    this.glows = 0;
    g.imageSmoothingEnabled = false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0B0910'; g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const a = this.shake && now < this.shakeT ? this.shakeA : 0;
    this.shx = a ? Math.round((Math.random() * 2 - 1) * a) : 0; this.shy = a ? Math.round((Math.random() * 2 - 1) * a) : 0;
    g.setTransform(this.K, 0, 0, this.K, this.shx * this.K, this.shy * this.K);
    g.drawImage(this.bg, 0, 0);

    // Summon zones: ours from the castle to its edge (bright while a card is picked), the enemy's faint red.
    const pulse = this.armed ? 0.34 + 0.1 * Math.sin(now / 160) : 0.22;
    this.strip(0, zones[0], '#FFE9A8', pulse);
    this.strip(BATTLE_LEN - zones[1], BATTLE_LEN, '#D2412F', 0.2);
    const edge = at(Math.max(0, zones[0]));
    g.fillStyle = FX.gold; g.fillRect(this.sx(edge.x) - 1, this.sy(edge.y) - (this.TH >> 1) - 2, 2, this.TH + 4);

    const things: { depth: number; draw: () => void }[] = [];
    for (const p of this.props) {
      const art = PROP_ART[p.type]!;
      things.push({ depth: p.ty + 0.5, draw: () => this.prop(art, this.ox + p.tx * this.T + (this.T >> 1), this.oy + Math.round((p.ty + 0.7) * this.TH)) });
    }
    s.forts.forEach((f, i) => things.push({ depth: at(f.d).y / TILE - 0.62, draw: () => this.fort(i, now) }));
    ([0, 1] as Side[]).forEach((side) => things.push({ depth: at(side === 0 ? 0 : BATTLE_LEN).y / TILE - 0.6, draw: () => this.castle(side, now) }));
    for (const u of s.units) {
      const q = this.seen.get(u.id);
      if (!q) continue;
      things.push({ depth: q.y / TILE + (u.side === 0 ? -0.1 : 0.1), draw: () => this.unit(u.id, q, u.hp / u.maxHp, u.stunT > 0, u.burnT > 0 ? FX.fire : u.poison > 0 ? FX.poison : null, now) });
    }
    things.sort((x, y) => x.depth - y.depth);
    for (const t of things) t.draw();
    this.drawAim(now);
    if (now - this.flashT < 400) { g.globalAlpha = 0.25 * (1 - (now - this.flashT) / 400); g.fillStyle = '#FFE9A8'; g.fillRect(0, 0, this.W, this.H); g.globalAlpha = 1; }
    this.particles(now);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawAim(now: number) {
    const m = this.aim;
    if (!m) return;
    const p = at(m.d), x = this.sx(p.x), y = this.sy(p.y), g = this.g;
    if (m.ok) {
      g.globalAlpha = 0.55;
      g.drawImage(figure(m.card, 0, false, 0, null), x - FIG_X, y - 3 - FIG_Y);
      g.globalAlpha = 1;
      ring(g, x, y - 3, 8, 4, FX.gold);
      const b = Math.round(Math.sin(now / 120) * 2);
      g.fillStyle = FX.gold; g.fillRect(x - 2, y - 36 + b, 5, 2); g.fillRect(x - 1, y - 34 + b, 3, 2); g.fillRect(x, y - 32 + b, 1, 1);
    } else {
      ring(g, x, y - 3, 10, 5, '#FF3B2E'); ring(g, x, y - 3, 9, 4, '#FF3B2E');
      for (let i = -5; i <= 5; i++) {
        g.fillStyle = '#120A0C'; g.fillRect(x + i - 1, y - 9 + i, 4, 2); g.fillRect(x - i - 1, y - 9 + i, 4, 2);
      }
      g.fillStyle = '#FF3B2E';
      for (let i = -5; i <= 5; i++) { g.fillRect(x + i, y - 9 + i, 2, 1); g.fillRect(x - i, y - 9 + i, 2, 1); }
    }
  }

  private particles(now: number) {
    const g = this.g;
    for (const p of this.ghosts.items) {
      if (now < p.t0 || now >= p.t1) continue;
      const k = (now - p.t0) / (p.t1 - p.t0);
      g.globalAlpha = 1 - k;
      g.drawImage(figure(p.card, p.side, p.side === 1, 0, k < 0.15 ? 'white' : null), p.x - FIG_X, p.y - FIG_Y);
      for (let i = 0; i < 5; i++) {
        const a = i * 1.2566 + p.t0, r = 2 + Math.round(3 * k);
        g.drawImage(disc(PUFF[i % 3]!, r), Math.round(p.x + Math.cos(a) * (2 + 6 * k)) - r, Math.round(p.y - 6 + Math.sin(a) * (1 + 3 * k) - 4 * k) - r);
      }
    }
    g.globalAlpha = 1;
    for (const u of this.s.units) {
      const q = u.burnT > 0 ? this.seen.get(u.id) : undefined;
      if (q) { const [x, y] = this.spot(u.id, q); this.glow(x, y - 8, 6, FX.fire, 0.4 + 0.15 * Math.sin(now / 60 + u.id)); }
    }
    for (const p of this.shots.items) {
      if (now < p.t0 || now >= p.t1) continue;
      const k = (now - p.t0) / (p.t1 - p.t0);
      const len = Math.hypot(p.x1 - p.x0, p.y1 - p.y0) || 1, ux = (p.x1 - p.x0) / len, uy = (p.y1 - p.y0) / len;
      const arc = p.big ? Math.sin(k * Math.PI) * Math.min(18, len * 0.2) : 0; // structures lob their bolts
      const trail = TRAIL[p.kit] ?? TRAIL.metal!, step = 4 / len;
      for (let i = 3; i >= 1; i--) {
        const kt = k - i * step;
        if (kt <= 0) continue;
        g.globalAlpha = 1 - i * 0.25; g.fillStyle = trail[i - 1]!;
        g.fillRect(Math.round(p.x0 + (p.x1 - p.x0) * kt), Math.round(p.y0 + (p.y1 - p.y0) * kt - Math.sin(kt * Math.PI) * (arc ? Math.min(18, len * 0.2) : 0)), i === 1 ? 2 : 1, i === 1 ? 2 : 1);
      }
      g.globalAlpha = 1;
      const x = Math.round(p.x0 + (p.x1 - p.x0) * k), y = Math.round(p.y0 + (p.y1 - p.y0) * k - arc);
      if (p.kit === 'fire' || p.crit) this.glow(x, y, 4, p.crit ? FX.star : FX.fire, 0.7);
      this.projectile(x, y, ux, uy, p.kit, p.big, p.crit);
    }
    for (const p of this.shards.items) {
      if (now < p.t0 || now >= p.t1) continue;
      const t = (now - p.t0) / 1000;
      g.fillStyle = p.c;
      g.fillRect(Math.round(p.x + p.vx * t), Math.round(p.y + p.vy * t + 160 * t * t), 2, 2);
    }
    for (const m of this.rings.items) {
      if (now < m.t0 || now >= m.t1) continue;
      const k = (now - m.t0) / (m.t1 - m.t0);
      g.globalAlpha = 1 - k * k;
      if (m.slash) { // a white cut down across the target
        const n = Math.min(10, Math.round(k * 30));
        for (let i = 0; i < n; i++) { g.fillStyle = i >= n - 2 ? FX.glint : '#D9E1EA'; g.fillRect(m.x - 5 + i, m.y - 6 + i, 1, 1); }
      } else {
        ring(g, m.x, m.y, m.rx * (0.3 + 0.7 * k), m.ry * (0.3 + 0.7 * k), m.c);
        if (m.rx > 20) this.glow(m.x, m.y, 12, m.c, 1 - k);
      }
    }
    for (const p of this.nums.items) {
      if (now < p.t0 || now >= p.t1) continue;
      const k = (now - p.t0) / (p.t1 - p.t0);
      g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      this.digits(p.v, p.x, Math.round(p.y - k * (p.crit ? 14 : 10)), p.heal ? 2 : p.crit ? 1 : 0, p.crit);
    }
    g.globalAlpha = 1;
  }

  // Additive light in a palette colour: three stepped discs. Capped per frame.
  private glow(x: number, y: number, r: number, color: string, a: number) {
    if (this.glows++ >= GLOW_CAP || a <= 0) return;
    const g = this.g, prev = g.globalAlpha;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = prev * Math.min(1, a);
    g.drawImage(halo(color, r), Math.round(x) - r, Math.round(y) - r);
    g.globalAlpha = prev;
    g.globalCompositeOperation = 'source-over';
  }

  private projectile(x: number, y: number, ux: number, uy: number, kit: string, big: boolean, crit: boolean) {
    const g = this.g, [body, hi] = KIT_LOOK[kit] ?? KIT_LOOK.metal!;
    const px = (dx: number, dy: number, c: string, n = 1) => { g.fillStyle = c; g.fillRect(x + dx, y + dy, n, n); };
    if (big) { // a structure's bolt: a dark shaft, iron head
      for (let i = 1; i < 7; i++) px(Math.round(-ux * i), Math.round(-uy * i), '#6E4A30');
      px(-1, -1, '#9FB3CA', 2); px(0, 0, '#FFFFFF');
    } else if (kit === 'metal') {
      for (let i = 1; i < 6; i++) px(Math.round(-ux * i), Math.round(-uy * i), body);
      px(0, 0, hi);
    } else {
      px(Math.round(-ux * 3) - 1, Math.round(-uy * 3), body, 1); px(Math.round(-ux * 2) - 1, Math.round(-uy * 2) - 1, body, 2);
      px(-1, -1, body, 3); px(-1, -1, hi, 1);
    }
    if (crit) px(0, -1, '#FFFFFF', 2);
  }

  // A number in the 3x5 pixel font, centred on x; style 0 normal, 1 crit (white), 2 heal (green); big is twice the size.
  private digits(v: number, x: number, y: number, style: number, big: boolean) {
    const str = String(v), k = big ? 2 : 1, sheet = this.font[style]!;
    let cx = x - ((str.length * 4 + 1) * k >> 1);
    for (const ch of str) { this.g.drawImage(sheet, (ch.charCodeAt(0) - 48) * 5, 0, 5, 7, cx, y, 5 * k, 7 * k); cx += 4 * k; }
  }

  private prop(art: Rect[], x: number, y: number) {
    const g = this.g;
    shadow(g, x, y, 8);
    for (const [dx, dy, w, h, c] of art) { g.fillStyle = c; g.fillRect(x + dx, y + dy, w, h); }
  }

  private bar(x: number, y: number, w: number, frac: number, color: string) {
    const g = this.g;
    g.fillStyle = '#120A0C'; g.fillRect(x - (w >> 1) - 1, y - 1, w + 2, 4);
    g.fillStyle = '#200808'; g.fillRect(x - (w >> 1), y, w, 2);
    g.fillStyle = color; g.fillRect(x - (w >> 1), y, Math.max(frac > 0 ? 1 : 0, Math.round(w * Math.max(0, Math.min(1, frac)))), 2);
  }

  private struck(key: string, now: number): { white: boolean; dx: number } {
    const t = this.hitAt.get(key) ?? -Infinity, k = now - t;
    return { white: k >= 0 && k < 50, dx: k >= 0 && k < KICK_MS ? ((Math.floor(now / 16) & 1) * 2 - 1) : 0 };
  }

  // A fort: a wooden watchtower beside the road, its flag in the owner's colour, HP and the capture in progress above.
  private fort(i: number, now: number) {
    const f = this.s.forts[i]!, g = this.g, [x0, y] = this.fortAt(i), hit = this.struck(`f${i}`, now), x = x0 + hit.dx;
    const c = f.owner === null ? NEUTRAL : SIDE[f.owner];
    shadow(g, x, y, 11);
    const R = (dx: number, dy: number, w: number, h: number, col: string) => { g.fillStyle = hit.white ? '#FFFFFF' : col; g.fillRect(x + dx, y + dy, w, h); };
    R(-9, -14, 2, 14, '#4A3020'); R(7, -14, 2, 14, '#4A3020'); R(-8, -8, 16, 1, '#4A3020');
    R(-11, -17, 22, 3, '#6E4A30'); R(-11, -15, 22, 1, '#553722');
    R(-7, -27, 14, 10, '#7A4A2A'); R(-3, -24, 6, 7, '#1A1210'); R(5, -27, 2, 10, '#553722');
    R(-11, -31, 22, 4, '#3A3442'); R(-12, -32, 24, 1, '#5A5266'); R(-12, -28, 2, 1, '#5A5266'); R(10, -28, 2, 1, '#5A5266');
    R(c === NEUTRAL ? -9 : -11, -30, c === NEUTRAL ? 18 : 22, 1, c); // roof trim in the owner's colour
    const wave = Math.floor(now / 200 + i) & 1;
    R(8, -44, 1, 14, '#C8C4CC');
    R(9, -44, 7, 5 + wave, c); R(9, -40 + wave, 6, 1, f.owner === null ? '#8F8A96' : f.owner === 0 ? '#8A6A1E' : '#7A1E14');
    this.bar(x, y - 50, 22, f.hp / battle.forts.hp, f.owner === null ? NEUTRAL : HP_BAR[f.owner]);
    if (f.capSide !== null && f.capT > 0) {
      const k = f.capT / battle.forts.captureTicks;
      g.fillStyle = '#120A0C'; g.fillRect(x - 12, y - 46, 24, 3);
      g.fillStyle = SIDE[f.capSide]; g.fillRect(x - 11, y - 45, Math.round(22 * k), 1);
      if (Math.floor(now / 150) & 1) this.glow(x + 12, y - 41, 5, SIDE[f.capSide], 0.6);
    }
  }

  // A castle at its end of the road: stone walls and gate, a two-roof keep, banners; cracks and embers as it falls.
  private castle(side: Side, now: number) {
    const c = this.s.castles[side], g = this.g, [x0, y] = this.castleAt(side), hit = this.struck(`c${side}`, now), x = x0 + hit.dx;
    const roof = side === 0 ? '#3A3442' : '#5A0E14', roofHi = side === 0 ? '#5A5266' : '#7A1E14', trim = SIDE[side];
    const R = (dx: number, dy: number, w: number, h: number, col: string) => { g.fillStyle = hit.white ? '#FFFFFF' : col; g.fillRect(x + dx, y + dy, w, h); };
    g.fillStyle = '#00000066'; g.fillRect(x - 34, y - 2, 68, 5); g.fillRect(x - 30, y - 3, 60, 7);
    R(-32, -24, 64, 24, '#4E4858');
    for (let r = -20; r < 0; r += 5) R(-32, r, 64, 1, '#3A3540');
    for (let cx = -32; cx < 32; cx += 8) R(cx, -28, 5, 4, '#4E4858');
    R(-32, -24, 64, 1, '#6E6A78');
    R(-8, -16, 16, 16, '#1A1210'); R(-7, -15, 6, 15, '#6E4A30'); R(1, -15, 6, 15, '#553722'); R(-8, -17, 16, 1, '#6E6A78');
    R(-22, -42, 44, 14, '#D8C0A8'); R(-22, -42, 44, 1, '#E6F4FC');
    for (const px of [-22, -8, 6, 20]) R(px, -42, 2, 14, '#6E4A30');
    R(-16, -38, 4, 4, '#1A1210'); R(-2, -38, 4, 4, '#1A1210'); R(12, -38, 4, 4, '#1A1210');
    R(-28, -48, 56, 6, roof); R(-30, -49, 4, 2, roofHi); R(26, -49, 4, 2, roofHi); R(-26, -48, 52, 1, roofHi); R(-28, -43, 56, 1, trim);
    R(-12, -58, 24, 10, '#D8C0A8'); R(-6, -55, 4, 4, '#1A1210'); R(2, -55, 4, 4, '#1A1210');
    R(-17, -63, 34, 5, roof); R(-19, -64, 4, 2, roofHi); R(15, -64, 4, 2, roofHi); R(-17, -59, 34, 1, trim);
    R(-1, -68, 2, 5, FX.gold); R(-2, -66, 4, 1, FX.gold);
    const wave = Math.floor(now / 220 + side) & 1;
    for (const bx of [-31, 29]) { R(bx, -46, 1, 22, '#C8C4CC'); R(bx + (bx < 0 ? 1 : -7), -46, 7, 6 + wave, trim); }
    const frac = Math.max(0, c.hp) / battle.castle.hp;
    if (frac < 0.6) { g.fillStyle = '#1A1210'; g.fillRect(x - 24, y - 20, 1, 6); g.fillRect(x - 23, y - 14, 1, 4); g.fillRect(x + 18, y - 22, 1, 5); g.fillRect(x + 19, y - 17, 2, 1); }
    if (frac < 0.3) {
      g.fillRect(x - 14, y - 40, 1, 6); g.fillRect(x + 9, y - 36, 1, 5);
      this.glow(x - 10, y - 46, 6, FX.fire, 0.5 + 0.2 * Math.sin(now / 90));
      this.glow(x + 14, y - 30, 5, FX.fire, 0.5 + 0.2 * Math.sin(now / 70 + 1));
    }
    this.bar(x, y - 76, 48, frac, HP_BAR[side]);
  }

  // A unit: its eased spot, the attack lunge, knockback and two white frames on a hit, a status tint, stars when stunned, HP.
  private unit(id: number, q: Seen, hp: number, stunned: boolean, tint: string | null, now: number) {
    const g = this.g;
    let [x, y] = this.spot(id, q);
    const l = this.lunges.get(id), k = l ? (now - l.t0) / LUNGE_MS : 1;
    const out = k < 0 || k >= 1 ? 0 : k < 0.3 ? Math.sin((k / 0.3) * Math.PI / 2) : 1 - (k - 0.3) / 0.7;
    if (l) { x += Math.round(l.ux * LUNGE * out); y += Math.round(l.uy * LUNGE * out * 0.6); }
    if (q.flash && now >= q.flash) { q.white = 2; q.flash = 0; }
    const white = q.white > 0;
    if (white) q.white--;
    const kk = q.kickT && now >= q.kickT ? (now - q.kickT) / KICK_MS : 1;
    if (kk < 1) { x += Math.round(q.kx * (1 - kk) * KICK) + ((Math.floor(now / 16) & 1) * 2 - 1); y += Math.round(q.ky * (1 - kk) * KICK * 0.6); }
    const def = defOf(q.card), fly = def.move === 'fly' ? 8 + Math.round(Math.sin(now / 200 + id) * 2) : 0;
    const walking = now - q.walk < 200 && !stunned;
    const b = walking ? ((Math.floor(now / 140 + id) & 1) ? -1 : 0) : Math.round(Math.sin(now / 300 + id));
    shadow(g, x, y, def.size === 'small' ? 5 : 6);
    g.drawImage(figure(q.card, q.side, q.side === 1, b, white ? 'white' : stunned ? 'stun' : tint), x - FIG_X, y - FIG_Y - fly);
    const top = y - (def.size === 'small' ? 25 : 27) - fly;
    this.bar(x, top, 12, hp, HP_BAR[q.side]);
    if (stunned) {
      g.fillStyle = FX.star;
      for (let i = 0; i < 3; i++) {
        const a = now / 160 + i * 2.094, sx = Math.round(x + Math.cos(a) * 6), sy = Math.round(top - 4 + Math.sin(a) * 2);
        g.fillRect(sx, sy - 1, 1, 3); g.fillRect(sx - 1, sy, 3, 1);
      }
    }
  }

  dispose(): void { this.seen.clear(); this.lunges.clear(); }
}

// ---- figures: drawn once per card, side, facing, bob and overlay into a small canvas, then blitted ----
const FIG_W = 32, FIG_H = 36, FIG_X = 16, FIG_Y = 32; // canvas size and the feet point inside it
const figs = new Map<string, HTMLCanvasElement>();
type Over = 'white' | 'stun' | string | null; // a tint colour, or white (hit flash), or stun (greyed)

export function figure(card: string, side: Side, flip: boolean, b: number, over: Over): HTMLCanvasElement {
  const key = `${card}|${side}|${flip ? 1 : 0}|${b}|${over ?? ''}`;
  let c = figs.get(key);
  if (c) return c;
  const base = document.createElement('canvas');
  base.width = FIG_W; base.height = FIG_H;
  const g = base.getContext('2d')!;
  drawFigure(g, defOf(card), side, b);
  if (over) {
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = over === 'white' ? 1 : over === 'stun' ? 0.45 : 0.4;
    g.fillStyle = over === 'white' ? '#FFFFFF' : over === 'stun' ? '#5A5266' : over;
    g.fillRect(0, 0, FIG_W, FIG_H);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  c = document.createElement('canvas');
  c.width = FIG_W; c.height = FIG_H;
  const o = c.getContext('2d')!;
  if (flip) { o.translate(FIG_W, 0); o.scale(-1, 1); }
  // A 1 px rim in the side colour around the silhouette, then the figure on top.
  const rimC = document.createElement('canvas');
  rimC.width = FIG_W; rimC.height = FIG_H;
  const r = rimC.getContext('2d')!;
  r.drawImage(base, 0, 0);
  r.globalCompositeOperation = 'source-in'; r.fillStyle = SIDE[side]; r.fillRect(0, 0, FIG_W, FIG_H);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) o.drawImage(rimC, dx, dy);
  o.drawImage(base, 0, 0);
  figs.set(key, c);
  return c;
}

// The figure facing right, feet at (FIG_X, FIG_Y): sect-coloured robe, dark hat, and what its card carries.
function drawFigure(g: CanvasRenderingContext2D, d: BattleUnitDef, side: Side, b: number) {
  const x = FIG_X, y = FIG_Y, sm = d.size === 'small' ? 2 : 0, robe = sects.get(d.sect)?.color ?? NEUTRAL;
  const R = (dx: number, dy: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(x + dx, y + dy, w, h); };
  if (d.move === 'fly') { R(-10, -14 + b, 5, 2, '#C8C4CC'); R(5, -14 + b, 5, 2, '#C8C4CC'); }
  R(-4, -1, 3, 1, '#1A1418'); R(1, -1, 3, 1, '#1A1418'); // feet
  R(-5, -14 + sm + b, 10, 13 - sm, '#1A1418'); // outline
  R(-4, -13 + sm + b, 8, 12 - sm, robe);
  R(-4, -13 + sm + b, 1, 12 - sm, '#1A1423'); // shade on the back
  R(-4, -5 + b, 8, 1, '#1A1418'); // belt
  R(-3, -19 + sm + b, 6, 6, '#E9C9A4'); R(1, -17 + sm + b, 1, 1, '#1A1418'); // face and eye, looking ahead
  R(-5, -21 + sm + b, 10, 3, '#1A1418'); R(-2, -23 + sm + b, 4, 2, '#1A1418'); // hat
  R(-5, -19 + sm + b, 10, 1, SIDE[side]); // hat band in the side colour
  const kit = KIT_LOOK[d.kit] ?? KIT_LOOK.metal!;
  if (d.move === 'capture') { // a banner pole over the shoulder
    R(5, -30 + sm + b, 1, 29, '#C8C4CC'); R(6, -30 + sm + b, 7, 5, SIDE[side]); R(6, -26 + sm + b, 6, 1, robe);
  } else if (d.move === 'guard') { R(4, -12 + b, 4, 10, '#1A1418'); R(5, -11 + b, 2, 8, kit[0]); R(5, -11 + b, 1, 1, kit[1]); } // a shield in front
  else if (d.move === 'support') { R(-1, -29 + sm + b, 1, 6, '#3A2A24'); R(-2, -32 + sm + b, 3, 3, FX.star); R(-1, -31 + sm + b, 1, 1, '#FFFFFF'); } // lantern overhead
  else if (!ranged(d)) { for (let i = 0; i < 5; i++) R(5 + i, -9 - i + b, 1, 1, i === 4 ? '#FFFFFF' : '#D9E1EA'); R(4, -8 + b, 2, 1, '#6E4A30'); } // a short blade held forward
  else if (d.kit === 'metal') R(5, -22 + sm + b, 1, 14, '#E5EAF0'); // a sword up
  else if (d.kit === 'fire') { R(5, -15 + b, 5, 2, '#F2A23A'); R(6, -17 + b, 3, 2, '#FFE08A'); } // a fan
  else if (d.kit === 'wood') { R(3, -14 + b, 8, 1, '#9FDCA7'); R(10, -14 + b, 1, 1, '#FFFFFF'); } // a flute
  else { R(5, -15 + b, 3, 3, kit[0]); R(5, -15 + b, 1, 1, kit[1]); } // a charm
}

// A card's face for the HUD: the figure at 3 css pixels per board unit, cropped to the body.
export function portrait(card: string, side: Side = 0, flip = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 28 * 3; c.height = 30 * 3;
  c.className = 'portrait';
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(figure(card, side, flip, 0, null), 2, 2, 28, 30, 0, 0, 28 * 3, 30 * 3);
  return c;
}

// The castle bell for its button and the cut-in.
export function bellIcon(scale = 3): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16 * scale; c.height = 16 * scale;
  c.className = 'portrait';
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  const R = (x: number, y: number, w: number, h: number, col: string) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  R(7, 0, 2, 2, '#6E4A30'); R(5, 2, 6, 1, '#8A6A1E'); R(4, 3, 8, 7, '#E3B04B'); R(3, 10, 10, 2, '#E3B04B'); R(2, 12, 12, 1, '#8A6A1E');
  R(5, 4, 1, 5, '#FFF2B0'); R(4, 6, 8, 1, '#8A6A1E'); R(7, 13, 2, 2, '#8A6A1E');
  return c;
}

function shadow(g: CanvasRenderingContext2D, x: number, y: number, w: number) {
  g.fillStyle = '#00000066';
  g.fillRect(x - w, y - 1, w * 2, 3);
  g.fillRect(x - w + 2, y - 2, w * 2 - 4, 5);
}

function digitSheet(colors: string[]): HTMLCanvasElement[] {
  return colors.map((c) => {
    const cv = document.createElement('canvas');
    cv.width = 50; cv.height = 7;
    const g = cv.getContext('2d')!;
    for (const [fill, pad] of [['#1A1423', 1], [c, 0]] as const)
      DIGITS.forEach((bits, d) => {
        g.fillStyle = fill;
        for (let i = 0; i < 15; i++) if (bits[i] === '1') g.fillRect(d * 5 + 1 + (i % 3) - pad, 1 + Math.floor(i / 3) - pad, 1 + 2 * pad, 1 + 2 * pad);
      });
    return cv;
  });
}

const PUFF = ['#6E6A78', '#5A1820', '#C8C4CC'];
const discs = new Map<string, HTMLCanvasElement>();
function disc(color: string, r: number, alpha = 1): HTMLCanvasElement {
  const k = `${color}|${r}|${alpha}`;
  let c = discs.get(k);
  if (!c) {
    c = Object.assign(document.createElement('canvas'), { width: 2 * r + 1, height: 2 * r + 1 });
    const g = c.getContext('2d')!;
    g.fillStyle = color; g.globalAlpha = alpha;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r) g.fillRect(x + r, y + r, 1, 1);
    discs.set(k, c);
  }
  return c;
}
function halo(color: string, r: number): HTMLCanvasElement {
  const k = `halo|${color}|${r}`;
  let c = discs.get(k);
  if (!c) {
    c = Object.assign(document.createElement('canvas'), { width: 2 * r + 1, height: 2 * r + 1 });
    const g = c.getContext('2d')!;
    g.globalCompositeOperation = 'lighter';
    for (const [f, a] of [[1, 0.16], [0.66, 0.2], [0.33, 0.28]] as const) { const q = Math.max(1, Math.round(r * f)); g.drawImage(disc(color, q, a), r - q, r - q); }
    discs.set(k, c);
  }
  return c;
}

// Rings are drawn at board resolution on a scratch canvas and scaled up, so their anti-aliased pixels come out as whole
// board pixels like the rest of the procedural drawing.
const scratch = document.createElement('canvas');
function ring(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  rx = Math.max(0, rx); ry = Math.max(0, ry);
  const x0 = Math.floor(x - rx) - 1, y0 = Math.floor(y - ry) - 1, w = Math.ceil(2 * rx) + 4, h = Math.ceil(2 * ry) + 4;
  if (scratch.width < w || scratch.height < h) { scratch.width = Math.max(w, scratch.width); scratch.height = Math.max(h, scratch.height); }
  const s = scratch.getContext('2d')!;
  s.clearRect(0, 0, w, h);
  s.setTransform(1, 0, 0, 1, -x0, -y0);
  s.strokeStyle = color; s.lineWidth = 1;
  s.beginPath(); s.ellipse(x + 0.5, y + 0.5, rx, ry, 0, 0, Math.PI * 2); s.stroke();
  s.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(scratch, 0, 0, w, h, x0, y0, w, h);
}
