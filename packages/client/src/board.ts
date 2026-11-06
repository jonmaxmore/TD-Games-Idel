// The battlefield in 2.5D pixel art with plain Canvas 2D: a 3/4 top-down board (tiles squashed vertically) and
// upright pixel figures drawn back to front. It draws at low resolution in whole pixels; CSS scales the canvas up
// with hard edges. It only reads the sim state; it never changes it.
import {
  biomes, branchB, discipleStats, enemies as enemyDefs, FIRE_SPLASH, grid, moonPhase, openPath, palette, propBlocks, sects, TILE, units, type DefendState, type Disciple,
  type SimEvent,
} from '@five-sects/sim';

const TOP = 34; // room above the far row for figures standing on it
const PAD = 6;
// The grid's x runs across the 16:9 screen and y runs into it.

const ENEMY_COLOR: Record<string, string> = {
  cultist: '#8A2A2A', runner: '#3E7A3A', brute: '#6E7680', leaper: '#4A6A3A', puppet: '#5A6E8A',
  assassin: '#2A2A38', healer: '#B0302A', mimic: '#4A5AA0',
};
const ROLE_LOOK: Record<string, string> = { striker: '#E8EEF5', burst: '#FF9A4A', control: '#7FD0FF', stacker: '#7CFF6A', support: '#FFE9A8' };

const BOSS_COLOR = '#5A0E14';

// Tier-3 looks, technique effects and enemy status marks. Every one is an effects.json render.palette colour (test/board.test.ts).
export const FX = {
  gold: '#E3B04B', markA: '#EEF3F8', markB: '#D2412F', // tier 3: gold trim, hat mark per branch
  vine: '#3DA94C', vineDark: '#225F2B', leaf: '#9FDCA7', // wood aura, Binding Roots
  ice: '#C9E6F7', iceEdge: '#8EC3E8', glint: '#FFFFFF', slow: '#ABDBFF', // water freeze, slow
  star: '#FFE08A', // stun
  fire: '#FF5A1F', ember: '#FFE08A', // wildfire
  slash: '#D2412F', // execute
};

// Props as pixel rects [dx, dy, w, h, colour] from the tile's ground point. Standing props are depth sorted with the
// figures; flat ones (roof, rice) are painted into the ground.
type Rect = [number, number, number, number, string];
const PROP_ART: Record<string, Rect[]> = {
  house: [[-8, -10, 16, 10, '#6E4A30'], [3, -10, 5, 10, '#553722'], [-2, -6, 4, 6, '#1A1210'], [-6, -8, 3, 2, '#F2A23A'],
    [-10, -16, 20, 6, '#3A3442'], [-11, -17, 22, 2, '#5A5266'], [-11, -11, 2, 1, '#5A5266'], [9, -11, 2, 1, '#5A5266']],
  tree: [[-1, -5, 3, 5, '#4A3020'], [-7, -9, 14, 4, '#225F2B'], [2, -9, 5, 4, '#173F1D'], [-5, -13, 10, 4, '#2F833B'],
    [1, -13, 4, 4, '#225F2B'], [-3, -17, 6, 4, '#3DA94C'], [-1, -19, 2, 2, '#3DA94C']],
  shrine: [[-7, -3, 14, 3, '#5E4A42'], [-5, -11, 10, 8, '#9A2A1E'], [-2, -8, 4, 5, '#1A0C10'], [-8, -14, 16, 3, '#3A3442'],
    [-9, -15, 18, 1, '#5A5266'], [-1, -17, 2, 2, '#E3B04B']],
  rock: [[-8, -10, 16, 10, '#3A3540'], [-8, -12, 16, 3, '#4E4858'], [3, -9, 5, 9, '#2A2630']],
  bamboo: [[-6, -18, 2, 18, '#3DA94C'], [-1, -22, 2, 22, '#5BC46A'], [4, -16, 2, 16, '#2F833B'], [-6, -12, 2, 1, '#225F2B'],
    [-1, -15, 2, 1, '#225F2B'], [-1, -8, 2, 1, '#225F2B'], [4, -9, 2, 1, '#225F2B'], [-9, -17, 3, 1, '#5BC46A'], [1, -21, 4, 1, '#9FDCA7'], [6, -15, 3, 1, '#3DA94C']],
  ice: [[-8, -12, 16, 12, '#8EC3E8'], [-8, -14, 16, 3, '#C9E6F7'], [3, -11, 5, 11, '#4A78B8'], [-5, -10, 2, 4, '#FFFFFF']],
  stall: [[-8, -6, 1, 6, '#3A2A24'], [7, -6, 1, 6, '#3A2A24'], [-9, -7, 18, 3, '#7A4A2A'], [-6, -9, 3, 2, '#F2A23A'], [-1, -9, 3, 2, '#D2412F'],
    [4, -9, 3, 2, '#5BC46A'], [-9, -17, 1, 10, '#3A2A24'], [8, -17, 1, 10, '#3A2A24'], [-10, -19, 4, 3, '#D2412F'], [-6, -19, 4, 3, '#EEF3F8'],
    [-2, -19, 4, 3, '#D2412F'], [2, -19, 4, 3, '#EEF3F8'], [6, -19, 4, 3, '#D2412F']],
  ruin: [[-7, -14, 4, 14, '#6E6A78'], [-4, -14, 1, 14, '#4A4048'], [-7, -15, 4, 1, '#8F8A96'], [3, -8, 4, 8, '#6E6A78'], [3, -9, 4, 1, '#8F8A96'],
    [-2, -3, 4, 3, '#5A5266'], [6, -2, 3, 2, '#5A5266']],
  lantern: [[-1, -16, 2, 16, '#3A2A24'], [-1, -16, 6, 1, '#3A2A24'], [2, -15, 5, 1, '#E3B04B'], [2, -14, 5, 6, '#D2412F'], [3, -13, 3, 4, '#F2A23A'],
    [4, -12, 1, 2, '#FFE08A'], [2, -8, 5, 1, '#E3B04B']],
  flag: [[-4, -24, 1, 24, '#C8C4CC'], [-3, -23, 9, 11, '#9A2A1E'], [6, -22, 1, 9, '#7A1E14'], [0, -19, 3, 3, '#E3B04B']],
};
const FLAT = new Set(['roof', 'rice']);

// Projectile look per kit (the unit's fighting element); a burst-role unit throws a fan wave whatever its kit.
const KIT_LOOK: Record<string, [string, string]> = { // [body, highlight]
  metal: ['#9FB3CA', '#FFFFFF'], fire: ['#FF5A1F', '#FFE08A'], water: ['#4FB3FF', '#ABDBFF'], earth: ['#836127', '#DEC191'],
  wood: ['#3DA94C', '#9FDCA7'], yinyang: ['#1A1423', '#F2F2F2'],
};

// 3x5 digits, row by row.
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001010010010', '111101111101111', '111101111001111'];

interface Fx { draw: (g: CanvasRenderingContext2D, k: number) => void; from: number; until: number }
interface Status { burnT: number; poison: number; stunT: number; slowT: number; rootedT: number; id: number }
interface Seen { x: number; y: number; type: string; flash: number; stunBy: string } // flash: when to draw one white frame (0 = none); stunBy: the last stun's kind
interface Live { t0: number; t1: number } // visible from t0 until t1 (ms, performance.now)

// A fixed ring of particles: taking one reuses the oldest, so a burst never allocates.
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

export class Board {
  private g: CanvasRenderingContext2D;
  private ox = 0;
  private oy = 0;
  private scale = 1; // CSS pixels per buffer pixel
  // Tile size in buffer pixels, chosen to fill the canvas: T across, TH deep (TH < T is the 3/4 view).
  private T = 24;
  private TH = 15;
  private get BW() { return grid.w * this.T; }
  private get BH() { return grid.h * this.TH; }
  private fx: Fx[] = [];
  private seen = new Map<number, Seen>(); // drawn enemy positions, eased toward the sim's
  private bg = document.createElement('canvas'); // backdrop, ground and flat props, redrawn on resize
  private mist = document.createElement('canvas'); // fog layer with each disciple's sight cut out
  private shots = new Pool(128, () => ({ t0: 0, t1: 0, x0: 0, y0: 0, x1: 0, y1: 0, kit: '', fan: false, crit: false }));
  private nums = new Pool(64, () => ({ t0: 0, t1: 0, x: 0, y: 0, v: 0, crit: false, exec: false, to: 0 }));
  // Technique effects (SimEvent kind): a ring or a slash centred at (x, y), rx by ry buffer pixels at full size.
  private marks = new Pool(48, () => ({ t0: 0, t1: 0, x: 0, y: 0, rx: 0, ry: 0, kind: '' }));
  private shards = new Pool(256, () => ({ t0: 0, t1: 0, x: 0, y: 0, vx: 0, vy: 0, c: '' }));
  private coins = new Pool(48, () => ({ t0: 0, t1: 0, x: 0, y: 0 }));
  private font = digitSheet(['#FFD34A', '#FFFFFF', FX.slash]); // normal, crit, execute
  private shakeT = 0;
  private shakeA = 0;
  private silver = { x: 0, y: -8 }; // the top bar's silver counter, in buffer pixels
  shake = true;
  private range: { x: number; y: number; r: number } | null = null;
  private cursor: { tx: number; ty: number; ok: boolean } | null = null;

  constructor(private canvas: HTMLCanvasElement, private s: DefendState) {
    this.g = canvas.getContext('2d')!;
    this.resize();
  }

  // A whole-number pixel scale (pixels stay square), then tiles sized to fill the canvas.
  resize(): void {
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    this.scale = Math.max(1, Math.round(ch / 320));
    this.canvas.width = Math.floor(cw / this.scale);
    this.canvas.height = Math.floor(ch / this.scale);
    this.T = Math.floor((this.canvas.width - 2 * PAD) / grid.w);
    // Depth per row: fill the height, kept between a steep 0.55 and a top-down 1.0 of the tile width.
    this.TH = Math.max(Math.round(this.T * 0.55), Math.min(this.T, Math.floor((this.canvas.height - TOP - 2 * PAD - 10) / grid.h)));
    this.ox = Math.floor((this.canvas.width - this.BW) / 2);
    this.oy = Math.floor((this.canvas.height - this.BH + TOP - 10) / 2);
    this.paintGround();
  }

  // Where coins fly: the silver counter's centre in client pixels.
  silverAt(clientX: number, clientY: number): void {
    const r = this.canvas.getBoundingClientRect();
    if (r.width) this.silver = { x: Math.round(((clientX - r.left) / r.width) * this.canvas.width), y: Math.round(((clientY - r.top) / r.height) * this.canvas.height) };
  }

  // Sim milli-tiles to buffer pixels at ground level.
  private sx = (x: number) => Math.round(this.ox + (x / TILE) * this.T);
  private sy = (y: number) => Math.round(this.oy + (y / TILE) * this.TH);

  tileAt(clientX: number, clientY: number): { tx: number; ty: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const bx = ((clientX - r.left) / r.width) * this.canvas.width, by = ((clientY - r.top) / r.height) * this.canvas.height;
    const tx = Math.floor((bx - this.ox) / this.T), ty = Math.floor((by - this.oy) / this.TH);
    return tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h ? { tx, ty } : null;
  }

  // World point (milli-tiles) to CSS pixels inside the canvas, for floating text. lift is in tiles above the ground.
  toScreen(x: number, y: number, lift = 0.9): { x: number; y: number } {
    const r = this.canvas.clientWidth / this.canvas.width;
    return { x: this.sx(x) * r, y: (this.sy(y) - lift * this.T) * r };
  }

  showRange(x: number, y: number, range: number | null, tile?: { tx: number; ty: number }, ok = true): void {
    this.range = range != null ? { x, y, r: range } : null;
    this.cursor = tile ? { ...tile, ok } : null;
  }

  sync(s: DefendState, now: number): void {
    this.s = s;
    for (const e of s.enemies) {
      const p = this.seen.get(e.id);
      if (!p) this.seen.set(e.id, { x: e.x, y: e.y, type: e.type, flash: 0, stunBy: '' });
      else { p.x += (e.x - p.x) * 0.35; p.y += (e.y - p.y) * 0.35; }
    }
    for (const id of this.seen.keys()) if (!s.enemies.some((e) => e.id === id)) this.seen.delete(id);
    this.fx = this.fx.filter((f) => now < f.until);
  }

  // Short-lived visuals for sim events: a projectile, number and flash per hit, shards and a coin per kill,
  // rings for secret arts, and a shake for leaks, bosses and arts.
  events(s: DefendState, ev: SimEvent[], now: number): void {
    for (const e of ev) {
      if (e.e === 'hit') {
        const d = s.disciples.find((x) => x.id === e.from), t = this.seen.get(e.to!);
        if (!d || !t) continue;
        const u = units.get(d.unit ?? '');
        const [x0, y0, x1, y1] = [this.sx(d.x), this.sy(d.y) - 14, this.sx(t.x), this.sy(t.y) - 6];
        const fly = Math.min(220, Math.max(90, Math.hypot(x1 - x0, y1 - y0) * 5));
        Object.assign(this.shots.take(now, now + fly), { x0, y0, x1, y1, kit: u?.element ?? d.els[0]!, fan: u?.roleId === 'burst', crit: !!e.crit });
        // Hits landing on one enemy, or on one spot, within 150 ms add up into one number: fast play shows a total, not a pile.
        const exec = e.kind === 'execute', big = !!e.crit || exec;
        const n = this.nums.items.find((p) => now < p.t1 && Math.abs(p.t0 - (now + fly)) < 150 && (p.to === e.to || (Math.abs(p.x - x1) < 20 && Math.abs(p.y - y1 + 10) < 10)));
        if (n) { n.v += e.dmg!; n.crit ||= !!e.crit; n.exec ||= exec; n.t1 = Math.max(n.t1, now + fly + (n.crit || n.exec ? 800 : 550)); }
        else Object.assign(this.nums.take(now + fly, now + fly + (big ? 800 : 550)), { x: x1 + ((e.to! * 7) % 7) - 3, y: y1 - (exec ? 24 : 10), v: e.dmg!, crit: !!e.crit, exec, to: e.to! });
        t.flash = now + fly;
        if (exec) this.mark(now + fly, 360, x1, y1, 0, 0, 'execute');
        else if (e.kind === 'wildfire') { const r = (FIRE_SPLASH * branchB.splashPct) / 100 / TILE; this.mark(now + fly, 420, x1, y1 + 6, r * this.T, r * this.TH, 'wildfire'); }
      } else if (e.e === 'stun') {
        const t = this.seen.get(e.id!), d = s.disciples.find((x) => x.id === e.from);
        if (t) t.stunBy = e.kind ?? '';
        if (e.kind === 'freeze' && t) this.freezeBurst(now, this.sx(t.x), this.sy(t.y) - 6);
        else if (d && e.kind === 'bell') { const r = d.level >= 3 && d.branch !== 'b' ? 2 : 1; this.mark(now, 420, this.sx(d.x), this.sy(d.y), r * this.T, r * this.TH, 'bell'); }
        else if (d && e.kind === 'root' && d.branch === 'b') { const r = discipleStats(s, d).range / TILE; this.mark(now, 600, this.sx(d.x), this.sy(d.y), r * this.T, r * this.TH, 'root'); }
      } else if (e.e === 'kill') {
        const t = this.seen.get(e.id!);
        const [x, y] = [this.sx(t?.x ?? e.x!), this.sy(t?.y ?? e.y!) - 6];
        const type = t?.type ?? '';
        const c = enemyDefs.get(type)?.boss != null ? BOSS_COLOR : ENEMY_COLOR[type] ?? '#7A2A2A';
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4, v = 30 + Math.random() * 40;
          Object.assign(this.shards.take(now, now + 450 + Math.random() * 200), { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 50, c: i % 3 ? c : '#D8C0A8' });
        }
        Object.assign(this.coins.take(now + 80, now + 600), { x, y });
      } else if (e.e === 'leak') this.shakeFor(now, 2, 250);
      else if (e.e === 'melt') this.paintGround();
      else if (e.e === 'leap') {
        const t = this.seen.get(e.id!);
        if (t) { const [x, y] = [this.sx(t.x), this.sy(t.y)]; this.fx.push({ from: now, until: now + 300, draw: (g, k) => { g.globalAlpha = 1 - k; ring(g, x, y, 4 + 6 * k, 2 + 3 * k, '#D8C0A8'); g.globalAlpha = 1; } }); }
      }
      else if (e.e === 'spawn' && enemyDefs.get(s.enemies.find((x) => x.id === e.id)?.type ?? '')?.boss != null) this.shakeFor(now, 3, 700);
      else if (e.e === 'art' || e.e === 'phoenix') {
        const phoenix = e.e === 'phoenix';
        const [cx, cy] = phoenix || !(e.x || e.y) ? [this.ox + this.BW / 2, this.oy + this.BH / 2] : [this.sx(e.x!), this.sy(e.y!)];
        const [rx, ry] = phoenix ? [this.BW / 2, this.BH / 2] : [3 * this.T, 3 * this.TH];
        this.fx.push({ from: now, until: now + 450, draw: (g, k) => { g.globalAlpha = 1 - k; ring(g, cx, cy, rx * k, ry * k, phoenix ? '#FF7A1F' : '#FFE9A8'); g.globalAlpha = 1; } });
        this.shakeFor(now, 2, 300);
      }
    }
  }

  // One effect per technique proc: stuns arrive one event per enemy, so a second at the same spot and moment is dropped.
  private mark(t0: number, ms: number, x: number, y: number, rx: number, ry: number, kind: string) {
    for (const m of this.marks.items) if (m.t0 === t0 && m.kind === kind && m.x === x && m.y === y) return;
    Object.assign(this.marks.take(t0, t0 + ms), { x, y, rx, ry, kind });
  }

  private freezeBurst(now: number, x: number, y: number) {
    this.mark(now, 300, x, y, 9, 6, 'freeze');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, v = 40 + Math.random() * 20;
      Object.assign(this.shards.take(now, now + 300 + Math.random() * 120), { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, c: i % 2 ? FX.ice : FX.glint });
    }
  }

  private shakeFor(now: number, amp: number, ms: number) {
    if (now + ms > this.shakeT) this.shakeT = now + ms;
    this.shakeA = Math.max(now < this.shakeT - ms ? this.shakeA : 0, amp);
  }

  // The static layer: a ridge behind the board, the cliff under it, the tiles, the path and the flat props.
  private paintGround(): void {
    const { width: w, height: h } = this.canvas;
    this.bg.width = w; this.bg.height = h;
    const g = this.bg.getContext('2d')!, s = this.s;
    const pal = palette.get(biomes.get(s.layout.biome)?.palette ?? '') ?? palette.get('env')!;
    g.fillStyle = '#0B0910'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++) {
      const far = Math.round(14 + 7 * Math.sin(x / 37) + 4 * Math.sin(x / 13 + 2));
      const near = Math.round(6 + 5 * Math.sin(x / 23 + 1) + 3 * Math.sin(x / 7));
      g.fillStyle = pal[3]!; g.fillRect(x, this.oy - 10 - far, 1, far + 10);
      g.fillStyle = pal[1]!; g.fillRect(x, this.oy - near, 1, near);
    }
    // Cliff face under the near edge, down to the bottom of the canvas, with a few cracks.
    const cy = this.oy + this.BH;
    g.fillStyle = '#1A120C'; g.fillRect(this.ox, cy, this.BW, h - cy);
    g.fillStyle = '#0F0A08';
    for (let y = cy + 8; y < h; y += 6) g.fillRect(this.ox, y, this.BW, 1);
    for (let x = this.ox + 7; x < this.ox + this.BW; x += 23) g.fillRect(x, cy + 2 + (x % 5), 1, 9 + (x % 7));
    for (let tx = 0; tx < grid.w; tx++)
      for (let ty = 0; ty < grid.h; ty++) {
        const onPath = s.pathTiles.has(`${tx},${ty}`);
        const px = this.ox + tx * this.T, py = Math.round(this.oy + ty * this.TH), th = Math.round(this.oy + (ty + 1) * this.TH) - py;
        const ice = s.ice.has(`${tx},${ty}`);
        g.fillStyle = ice ? ((tx + ty) % 2 ? '#8EC3E8' : '#9ACDEE') : onPath ? ((tx + ty) % 2 ? '#7E5E40' : '#86664A') : (tx + ty) % 2 ? '#2E4430' : '#355036';
        g.fillRect(px, py, this.T, th);
        g.fillStyle = ice ? '#E6F4FC' : onPath ? '#6A4C32' : '#26382A';
        g.fillRect(px + ((tx * 7 + ty * 3) % (this.T - 4)) + 2, py + ((tx * 5 + ty) % Math.max(1, th - 4)) + 2, ice ? 5 : 2, 1); // speckle (ice: a glint), fixed per tile
        if (ice) { g.fillStyle = '#4A78B8'; g.fillRect(px, py + th - 1, this.T, 1); }
      }
    for (const p of s.layout.props) {
      if (!FLAT.has(p.type)) continue;
      const px = this.ox + p.at.x * this.T, py = Math.round(this.oy + p.at.y * this.TH), th = Math.round(this.oy + (p.at.y + 1) * this.TH) - py;
      if (p.type === 'roof') { // slate tiles in rows, a lit ridge on top
        g.fillStyle = '#3A3442'; g.fillRect(px, py, this.T, th);
        g.fillStyle = '#2A2630';
        for (let y = py + 3; y < py + th; y += 3) g.fillRect(px, y, this.T, 1);
        for (let y = py, r = 0; y < py + th; y += 3, r++) for (let x = px + (r % 2) * 2; x < px + this.T; x += 4) g.fillRect(x, y, 1, 3);
        g.fillStyle = '#6E6A78'; g.fillRect(px, py, this.T, 1);
      } else { // rice paddy: water with rows of green tufts
        g.fillStyle = '#2A4A3E'; g.fillRect(px, py, this.T, th);
        for (let y = py + 2, r = 0; y < py + th - 1; y += 4, r++)
          for (let x = px + 1 + (r % 2) * 2; x < px + this.T - 1; x += 4) { g.fillStyle = '#5BC46A'; g.fillRect(x, y, 1, 2); g.fillStyle = '#9FDCA7'; g.fillRect(x, y, 1, 1); g.fillStyle = '#3DA94C'; g.fillRect(x + 1, y + 1, 1, 1); }
      }
    }
  }

  // Fog (bamboo rule): mist over the board, drawn above the figures, with each disciple's sight (its range) cut clear.
  private fog(now: number) {
    const m = this.mist, f = m.getContext('2d')!, s = this.s;
    if (m.width !== this.canvas.width || m.height !== this.canvas.height) { m.width = this.canvas.width; m.height = this.canvas.height; }
    f.clearRect(0, 0, m.width, m.height);
    f.fillStyle = '#B8CCC4';
    f.globalAlpha = 0.42;
    f.fillRect(this.ox, this.oy - 10, this.BW, this.BH + 10);
    f.globalAlpha = 0.3;
    for (let i = 0; i < 5; i++) { // slow drifting bands
      const y = this.oy + ((i * 47 + now / 90) % this.BH), x = this.ox + ((i * 131 + now / 40) % this.BW) - this.BW / 3;
      f.fillRect(Math.max(this.ox, Math.round(x)), Math.round(y), Math.round(this.BW / 3), 4);
    }
    f.globalAlpha = 1;
    f.globalCompositeOperation = 'destination-out';
    for (const d of s.disciples) {
      const r = discipleStats(s, d).range / TILE;
      f.beginPath(); f.ellipse(this.sx(d.x), this.sy(d.y), r * this.T, r * this.TH, 0, 0, Math.PI * 2); f.fill();
    }
    f.globalCompositeOperation = 'source-over';
    this.g.drawImage(m, 0, 0);
  }

  // Blood moon in the sky: a red disc with a dark bite that grows one step per phase (0 = full).
  private moon(phase: number) {
    const g = this.g, x = this.ox + this.BW - 34, y = Math.max(14, this.oy - 36);
    g.fillStyle = '#5A0E14'; g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#D2412F'; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FF7A5A'; g.fillRect(x - 6, y - 6, 4, 3); g.fillRect(x + 2, y + 2, 3, 2);
    if (phase % 5) { g.fillStyle = '#0B0910'; g.beginPath(); g.arc(x + 24 - (phase % 5) * 4, y - 2, 12, 0, Math.PI * 2); g.fill(); }
  }

  render(): void {
    const g = this.g, s = this.s, now = performance.now();
    g.imageSmoothingEnabled = false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0B0910';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const a = this.shake && now < this.shakeT ? this.shakeA : 0;
    if (a) g.setTransform(1, 0, 0, 1, Math.round((Math.random() * 2 - 1) * a), Math.round((Math.random() * 2 - 1) * a));
    g.drawImage(this.bg, 0, 0);

    if (this.cursor) {
      const px = this.ox + this.cursor.tx * this.T, py = Math.round(this.oy + this.cursor.ty * this.TH);
      g.fillStyle = this.cursor.ok ? '#FFE9A855' : '#FF3B2E66';
      g.fillRect(px, py, this.T, Math.round(this.TH));
    }
    if (this.range) ring(g, this.sx(this.range.x), this.sy(this.range.y), (this.range.r / TILE) * this.T, (this.range.r / TILE) * this.TH, '#FFE9A8aa');
    // Song of Withering (wood tier 3 a): its aura on the ground, a faint ring breathing slowly.
    g.globalAlpha = 0.35 + 0.2 * Math.sin(now / 700);
    for (const d of s.disciples) if (woodAura(d)) { const r = discipleStats(s, d).range / TILE; ring(g, this.sx(d.x), this.sy(d.y), r * this.T, r * this.TH, FX.vine); }
    g.globalAlpha = 1;

    // Everything that stands up is drawn back to front.
    const things: { depth: number; draw: () => void }[] = [];
    for (const p of s.layout.props) {
      const art = PROP_ART[p.type];
      if (art) things.push({ depth: p.at.y + 0.5, draw: () => this.prop(art, this.ox + p.at.x * this.T + (this.T >> 1), Math.round(this.oy + (p.at.y + 0.7) * this.TH), !!propBlocks.get(p.type)) });
    }
    // A cave mouth at every spawn gate, so each entrance reads at a glance; one sect gate at the shared goal.
    // City gates: a closed road gets bars; the one that opens next wave blinks them.
    const open = openPath(s.stageId, Math.max(1, s.wave)), next = s.wave < s.totalWaves ? openPath(s.stageId, s.wave + 1) : open;
    s.paths.forEach((p, i) => things.push({ depth: p[0]!.y / TILE, draw: () => {
      const closed = open != null && open !== i;
      this.cave(this.sx(p[0]!.x), this.sy(p[0]!.y), closed && !(next === i && Math.floor(now / 250) % 2 === 0), next === i && closed);
      if (s.paths.length > 1) this.number(i + 1, this.sx(p[0]!.x), this.sy(p[0]!.y) - 34, 1); // lane number over its cave
    } }));
    const goal = s.paths[0]!.at(-1)!;
    things.push({ depth: goal.y / TILE, draw: () => this.gate(this.sx(goal.x), this.sy(goal.y)) });
    for (const d of s.disciples) {
      const off = d.offT > 0 || (s.sealT > 0 && s.sealEl != null && d.els.includes(s.sealEl));
      things.push({ depth: d.y / TILE, draw: () => this.disciple(d.unit ?? d.els[0]!, d.level, d.branch, this.sx(d.x), this.sy(d.y), off, now + d.id * 97) });
    }
    for (const e of s.enemies) {
      if (e.type === 'assassin' && !e.revealed && Math.floor(now / 150) % 4 !== 0) continue; // a hidden assassin only flickers
      const p = this.seen.get(e.id);
      let white = false;
      if (p && p.flash && now >= p.flash) { white = true; p.flash = 0; } // exactly one white frame per landed hit
      const q = p ?? e;
      things.push({ depth: q.y / TILE, draw: () => this.enemy(e.type, e.hp / e.maxHp, this.sx(q.x), this.sy(q.y), e, p?.stunBy ?? '', now, white) });
    }
    things.sort((a, b) => a.depth - b.depth);
    for (const t of things) t.draw();
    if (s.rule.fogSight > 0) this.fog(now);
    if (s.rule.moonEveryWaves > 0) this.moon(moonPhase(s.rule, Math.max(1, s.wave)));
    for (const f of this.fx) f.draw(g, (now - f.from) / (f.until - f.from));
    this.particles(now);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  private particles(now: number) {
    const g = this.g;
    for (const p of this.shots.items) {
      if (now < p.t0 || now >= p.t1) continue;
      const k = (now - p.t0) / (p.t1 - p.t0);
      const x = Math.round(p.x0 + (p.x1 - p.x0) * k), y = Math.round(p.y0 + (p.y1 - p.y0) * k);
      const len = Math.hypot(p.x1 - p.x0, p.y1 - p.y0) || 1, ux = (p.x1 - p.x0) / len, uy = (p.y1 - p.y0) / len;
      this.projectile(x, y, ux, uy, p.kit, p.fan, p.crit);
    }
    for (const p of this.shards.items) {
      if (now < p.t0 || now >= p.t1) continue;
      const t = (now - p.t0) / 1000;
      g.fillStyle = p.c;
      g.fillRect(Math.round(p.x + p.vx * t), Math.round(p.y + p.vy * t + 160 * t * t), 2, 2);
    }
    for (const p of this.coins.items) {
      if (now < p.t0 || now >= p.t1) continue;
      const k = (now - p.t0) / (p.t1 - p.t0), e = k * k; // speeds up toward the counter
      const x = Math.round(p.x + (this.silver.x - p.x) * e), y = Math.round(p.y + (this.silver.y - p.y) * e - Math.sin(k * Math.PI) * 14);
      g.fillStyle = '#8A6A1E'; g.fillRect(x - 1, y - 1, 4, 4);
      g.fillStyle = '#E3B04B'; g.fillRect(x - 1, y - 1, 3, 3);
      g.fillStyle = '#FFF2B0'; g.fillRect(x - 1, y - 1, 1, 1);
    }
    for (const m of this.marks.items) {
      if (now < m.t0 || now >= m.t1) continue;
      const k = (now - m.t0) / (m.t1 - m.t0);
      g.globalAlpha = 1 - k * k;
      if (m.kind === 'execute') { // a red stroke cut down across the target, its white edge leading
        const n = Math.min(16, Math.round(k * 48));
        for (let i = 0; i < n; i++) { g.fillStyle = i >= n - 2 ? FX.glint : FX.slash; g.fillRect(m.x - 8 + i, m.y - 10 + i, 2, 2); }
      } else if (m.kind === 'wildfire') { // a wide ring of fire rolling out, embers riding its rim
        const rx = m.rx * (0.3 + 0.7 * k), ry = m.ry * (0.3 + 0.7 * k);
        ring(g, m.x, m.y, rx, ry, FX.fire); ring(g, m.x, m.y, rx - 1, ry - 1, FX.ember);
        g.fillStyle = FX.ember;
        for (let i = 0; i < 10; i++) { const a = i * 0.628 + k * 2; g.fillRect(Math.round(m.x + Math.cos(a) * rx), Math.round(m.y + Math.sin(a) * ry) - 2, 1, 2); }
      } else if (m.kind === 'bell') { // the golden bell rings out: two gold rings from the monk
        ring(g, m.x, m.y, m.rx * (0.5 + 0.5 * k), m.ry * (0.5 + 0.5 * k), FX.gold); ring(g, m.x, m.y, m.rx * k, m.ry * k, FX.star);
      } else if (m.kind === 'root') { // a vine ring at the reach of the roots, thorns closing in
        ring(g, m.x, m.y, m.rx, m.ry, FX.vine); ring(g, m.x, m.y, m.rx - 1, m.ry - 1, FX.vineDark);
        g.fillStyle = FX.leaf;
        for (let i = 0; i < 16; i++) { const a = i * 0.3927; g.fillRect(Math.round(m.x + Math.cos(a) * (m.rx - 2 - 2 * k)), Math.round(m.y + Math.sin(a) * (m.ry - 2 - 2 * k)), 1, 1); }
      } else ring(g, m.x, m.y, m.rx * (0.3 + 0.7 * k), m.ry * (0.3 + 0.7 * k), FX.ice); // freeze
    }
    for (const p of this.nums.items) {
      if (now < p.t0 || now >= p.t1) continue;
      const k = (now - p.t0) / (p.t1 - p.t0);
      g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      this.number(p.v, p.x, Math.round(p.y - k * (p.crit || p.exec ? 14 : 10)), p.exec ? 2 : p.crit ? 1 : 0);
    }
    g.globalAlpha = 1;
  }

  // One pixel projectile at (x, y) heading (ux, uy).
  private projectile(x: number, y: number, ux: number, uy: number, kit: string, fan: boolean, crit: boolean) {
    const g = this.g;
    const [body, hi] = KIT_LOOK[kit] ?? KIT_LOOK.metal!;
    const px = (dx: number, dy: number, c: string, n = 1) => { g.fillStyle = c; g.fillRect(x + dx, y + dy, n, n); };
    if (fan) { // a crescent across the heading
      for (let i = -3; i <= 3; i++) px(Math.round(-uy * i - ux * Math.abs(i) * 0.6), Math.round(ux * i - uy * Math.abs(i) * 0.6), Math.abs(i) < 2 ? hi : body);
    } else if (kit === 'metal') { // flying sword: blade trailing back from a bright tip, a hilt at the end
      for (let i = 1; i < 6; i++) px(Math.round(-ux * i), Math.round(-uy * i), body);
      px(Math.round(-ux * 6 - uy), Math.round(-uy * 6 + ux), '#6B8AAD'); px(Math.round(-ux * 6 + uy), Math.round(-uy * 6 - ux), '#6B8AAD');
      px(0, 0, hi);
    } else { // a ball (ice, fire, rock, leaf, orb) with a two-pixel trail
      px(Math.round(-ux * 3) - 1, Math.round(-uy * 3), body, 1); px(Math.round(-ux * 2) - 1, Math.round(-uy * 2) - 1, body, 2);
      px(-1, -1, body, 3); px(-1, -1, hi, 1);
    }
    if (crit) px(0, -1, '#FFFFFF', 2);
  }

  // A number in the 3x5 pixel font, centred on x. style 0 normal, 1 crit (white), 2 execute (red); crits and executes are twice the size.
  private number(v: number, x: number, y: number, style: number) {
    const str = String(v), k = style ? 2 : 1, sheet = this.font[style]!;
    let cx = x - ((str.length * 4 + 1) * k >> 1);
    for (const ch of str) {
      this.g.drawImage(sheet, (ch.charCodeAt(0) - 48) * 5, 0, 5, 7, cx, y, 5 * k, 7 * k);
      cx += 4 * k;
    }
  }

  private prop(art: Rect[], x: number, y: number, shadow: boolean) {
    const g = this.g;
    if (shadow) this.shadow(x, y, 9);
    for (const [dx, dy, w, h, c] of art) { g.fillStyle = c; g.fillRect(x + dx, y + dy, w, h); }
  }

  private shadow(x: number, y: number, w: number) {
    this.g.fillStyle = '#00000066';
    this.g.fillRect(x - w, y - 1, w * 2, 3);
    this.g.fillRect(x - w + 2, y - 2, w * 2 - 4, 5);
  }

  private cave(x: number, y: number, barred = false, opening = false) {
    const g = this.g;
    g.fillStyle = '#2A2630'; g.fillRect(x - 11, y - 16, 22, 16);
    g.fillStyle = opening ? '#E3B04B' : '#4E4858'; g.fillRect(x - 11, y - 18, 22, 3);
    g.fillStyle = '#0B0910'; g.fillRect(x - 6, y - 12, 12, 12);
    if (barred) { g.fillStyle = '#9A2A1E'; for (let i = -5; i <= 4; i += 3) g.fillRect(x + i, y - 12, 2, 12); g.fillRect(x - 6, y - 8, 12, 2); }
  }

  private gate(x: number, y: number) {
    const g = this.g;
    g.fillStyle = '#4A0E0A'; g.fillRect(x - 12, y - 26, 3, 26); g.fillRect(x + 9, y - 26, 3, 26);
    g.fillStyle = '#9A2A1E'; g.fillRect(x - 15, y - 29, 30, 4); g.fillRect(x - 13, y - 22, 26, 2);
    g.fillStyle = '#E3B04B'; g.fillRect(x - 2, y - 28, 4, 2);
  }

  // A disciple: sect-coloured robe, dark hat, and what its role carries; one gold pip per level above 1.
  // Tier 3 adds a gold hem, belt and hat band, and a mark on the hat: white jade for branch a, red for branch b.
  private disciple(key: string, level: number, branch: string | null, x: number, y: number, off: boolean, t: number) {
    const g = this.g;
    const u = units.get(key);
    const color = off ? '#5A5266' : u?.color ?? sects.get(key)?.color ?? '#ffffff';
    const role = u?.roleId ?? 'striker';
    const b = Math.round(Math.sin(t / 300)); // idle bob
    this.shadow(x, y, 7);
    g.fillStyle = '#1A1418'; g.fillRect(x - 5, y - 14 + b, 10, 13); // outline
    g.fillStyle = color; g.fillRect(x - 4, y - 13 + b, 8, 12); // robe
    g.fillStyle = '#1A1418'; g.fillRect(x - 4, y - 5 + b, 8, 1); // belt
    g.fillStyle = '#E9C9A4'; g.fillRect(x - 3, y - 19 + b, 6, 6); // face
    g.fillStyle = '#1A1418'; g.fillRect(x - 5, y - 21 + b, 10, 3); g.fillRect(x - 2, y - 23 + b, 4, 2); // hat
    if (level >= 3 && !off) {
      g.fillStyle = FX.gold; g.fillRect(x - 4, y - 2 + b, 8, 1); g.fillRect(x - 4, y - 5 + b, 8, 1); g.fillRect(x - 5, y - 19 + b, 10, 1);
      g.fillStyle = branch === 'b' ? FX.markB : FX.markA; g.fillRect(x - 1, y - 23 + b, 2, 2);
    }
    g.fillStyle = off ? '#5A5266' : ROLE_LOOK[role]!;
    if (role === 'striker') g.fillRect(x + 5, y - 22 + b, 1, 14); // sword
    else if (role === 'burst') { g.fillRect(x + 5, y - 15 + b, 5, 2); g.fillRect(x + 6, y - 17 + b, 3, 2); } // fan
    else if (role === 'control') { g.fillRect(x - 8, y, 16, 1); g.fillRect(x - 6, y - 2, 1, 2); g.fillRect(x + 5, y - 2, 1, 2); } // ring on the ground
    else if (role === 'stacker') g.fillRect(x + 5, y - 15 + b, 3, 3); // charm
    else g.fillRect(x - 1, y - 28 + b, 3, 3); // lantern overhead
    g.fillStyle = '#FFD34A';
    for (let i = 1; i < level; i++) g.fillRect(x - 5 + (i - 1) * 4, y + 2, 3, 2);
  }

  // An enemy: body by type (bosses big, brutes wide, fliers raised with wings), status tint, and an HP bar.
  // Stunned: vines at the feet when rooted, an ice block when frozen, else stars circling the head.
  private enemy(type: string, hp: number, x: number, y: number, e: Status, stunBy: string, now: number, white: boolean) {
    const g = this.g;
    const def = enemyDefs.get(type)!;
    const boss = def.boss != null;
    const w = boss ? 8 : type === 'brute' ? 6 : 4, h = boss ? 22 : 11;
    const lift = def.air ? 8 + Math.round(Math.sin(now / 200 + e.id) * 2) : 0;
    this.shadow(x, y, w + 2);
    const top = y - h - lift;
    g.fillStyle = '#120A0C'; g.fillRect(x - w - 1, top - 6, w * 2 + 2, h + 7); // outline
    g.fillStyle = white ? '#FFFFFF' : boss ? BOSS_COLOR : ENEMY_COLOR[type] ?? '#7A2A2A';
    g.fillRect(x - w, top, w * 2, h);
    g.fillStyle = white ? '#FFFFFF' : '#D8C0A8'; g.fillRect(x - 3, top - 5, 6, 5);
    g.fillStyle = '#120A0C'; g.fillRect(x + 1, top - 3, 1, 1); // eye, facing the gate
    if (def.air) { g.fillStyle = '#2A3A2A'; g.fillRect(x - w - 5, top + 2, 5, 2); g.fillRect(x + w, top + 2, 5, 2); }
    const tint = e.burnT > 0 ? '#FF6A1F88' : e.poison > 0 ? '#5BC46A88' : e.slowT > 0 ? FX.slow + '88' : null;
    if (tint && !white) { g.fillStyle = tint; g.fillRect(x - w, top, w * 2, h); }
    const bw = boss ? 24 : 12;
    g.fillStyle = '#200808'; g.fillRect(x - bw / 2, top - 9, bw, 2);
    g.fillStyle = '#E23B2E'; g.fillRect(x - bw / 2, top - 9, Math.max(1, Math.round(bw * Math.max(0, hp))), 2);
    if (e.stunT <= 0) return;
    if (e.rootedT > 0 || stunBy === 'root') {
      for (let i = -w - 2; i <= w + 1; i++) {
        g.fillStyle = FX.vineDark; g.fillRect(x + i, y - 1 - ((i + 12) % 3) - lift, 1, 1);
        g.fillStyle = FX.vine; g.fillRect(x + i, y - 3 - (((i + 13) % 4) >> 1) - lift, 1, 1);
      }
      g.fillStyle = FX.leaf; g.fillRect(x - w - 2, y - 5 - lift, 2, 1); g.fillRect(x + w, y - 4 - lift, 2, 1);
    } else if (stunBy === 'freeze') {
      g.fillStyle = FX.ice + 'AA'; g.fillRect(x - w - 2, top - 7, w * 2 + 4, h + 7);
      g.fillStyle = FX.iceEdge;
      g.fillRect(x - w - 2, top - 7, w * 2 + 4, 1); g.fillRect(x - w - 2, top - 7, 1, h + 7); g.fillRect(x + w + 1, top - 7, 1, h + 7); g.fillRect(x - w - 2, top + h - 1, w * 2 + 4, 1);
      g.fillStyle = FX.glint; g.fillRect(x - w, top - 5, 1, 3); g.fillRect(x - w + 1, top - 5, 1, 1);
    } else {
      g.fillStyle = FX.star;
      for (let i = 0; i < 3; i++) {
        const a = now / 160 + i * 2.094, sx = Math.round(x + Math.cos(a) * 6), sy = Math.round(top - 13 + Math.sin(a) * 2);
        g.fillRect(sx, sy - 1, 1, 3); g.fillRect(sx - 1, sy, 3, 1);
      }
    }
  }

  dispose(): void { this.fx = []; this.seen.clear(); }
}

// Digit glyphs 0-9 with a dark outline, one 5x7 cell each, one sheet per colour.
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

const woodAura = (d: Disciple) => d.els.includes('wood') && d.level >= 3 && d.branch !== 'b' && d.offT <= 0;

function ring(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  g.strokeStyle = color; g.lineWidth = 1;
  g.beginPath(); g.ellipse(x + 0.5, y + 0.5, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2); g.stroke();
}
