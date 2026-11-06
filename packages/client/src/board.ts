// The battlefield in 2.5D pixel art with plain Canvas 2D: a 3/4 top-down board (tiles squashed vertically) and
// upright pixel figures drawn back to front. It draws at low resolution in whole pixels; CSS scales the canvas up
// with hard edges. It only reads the sim state; it never changes it.
import { enemies as enemyDefs, grid, sects, TILE, units, type DefendState, type SimEvent } from '@five-sects/sim';

const TOP = 34; // room above the far row for figures standing on it
const PAD = 6;
// The grid's x runs across the 16:9 screen and y runs into it.

const ENEMY_COLOR: Record<string, string> = {
  cultist: '#8A2A2A', runner: '#3E7A3A', brute: '#6E7680', leaper: '#4A6A3A', puppet: '#5A6E8A',
  assassin: '#2A2A38', healer: '#B0302A', mimic: '#4A5AA0',
};
const ROLE_LOOK: Record<string, string> = { striker: '#E8EEF5', burst: '#FF9A4A', control: '#7FD0FF', stacker: '#7CFF6A', support: '#FFE9A8' };

interface Fx { draw: (g: CanvasRenderingContext2D, k: number) => void; from: number; until: number }
interface Status { burnT: number; poison: number; stunT: number; slowT: number; id: number }

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
  private seen = new Map<number, { x: number; y: number }>(); // drawn enemy positions, eased toward the sim's
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
      if (!p) this.seen.set(e.id, { x: e.x, y: e.y });
      else { p.x += (e.x - p.x) * 0.35; p.y += (e.y - p.y) * 0.35; }
    }
    for (const id of this.seen.keys()) if (!s.enemies.some((e) => e.id === id)) this.seen.delete(id);
    this.fx = this.fx.filter((f) => now < f.until);
  }

  // Short-lived visuals for sim events: a streak per hit, a ring per secret art, a sweep for the phoenix.
  events(s: DefendState, ev: SimEvent[], now: number): void {
    for (const e of ev) {
      if (e.e === 'hit') {
        const d = s.disciples.find((x) => x.id === e.from), t = s.enemies.find((x) => x.id === e.to);
        if (!d || !t) continue;
        const color = e.crit ? '#FFFFFF' : units.get(d.unit ?? '')?.color ?? sects.get(d.els[0]!)?.color ?? '#fff';
        const [x0, y0, x1, y1] = [this.sx(d.x), this.sy(d.y) - 14, this.sx(t.x), this.sy(t.y) - 6];
        this.fx.push({ from: now, until: now + 100, draw: (g) => line(g, x0, y0, x1, y1, color, e.crit ? 2 : 1) });
      } else if (e.e === 'art' || e.e === 'phoenix') {
        const phoenix = e.e === 'phoenix';
        const [cx, cy] = phoenix || !(e.x || e.y) ? [this.ox + this.BW / 2, this.oy + this.BH / 2] : [this.sx(e.x!), this.sy(e.y!)];
        const [rx, ry] = phoenix ? [this.BW / 2, this.BH / 2] : [3 * this.T, 3 * this.TH];
        this.fx.push({ from: now, until: now + 450, draw: (g, k) => { g.globalAlpha = 1 - k; ring(g, cx, cy, rx * k, ry * k, phoenix ? '#FF7A1F' : '#FFE9A8'); g.globalAlpha = 1; } });
      }
    }
  }

  render(): void {
    const g = this.g, s = this.s, now = performance.now();
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#0B0910';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Ground: a cliff lip under the near edge for depth, the tiles with a little speckle, the path.
    g.fillStyle = '#1A120C'; g.fillRect(this.ox, this.oy + this.BH, this.BW, 8);
    g.fillStyle = '#0F0A08'; g.fillRect(this.ox, this.oy + this.BH + 8, this.BW, 2);
    for (let tx = 0; tx < grid.w; tx++)
      for (let ty = 0; ty < grid.h; ty++) {
        const onPath = s.pathTiles.has(`${tx},${ty}`);
        const px = this.ox + tx * this.T, py = Math.round(this.oy + ty * this.TH), h = Math.round(this.oy + (ty + 1) * this.TH) - py;
        g.fillStyle = onPath ? ((tx + ty) % 2 ? '#7E5E40' : '#86664A') : (tx + ty) % 2 ? '#2E4430' : '#355036';
        g.fillRect(px, py, this.T, h);
        g.fillStyle = onPath ? '#6A4C32' : '#26382A';
        g.fillRect(px + ((tx * 7 + ty * 3) % 19) + 2, py + ((tx * 5 + ty) % 9) + 2, 2, 1); // speckle, fixed per tile
      }
    if (this.cursor) {
      const px = this.ox + this.cursor.tx * this.T, py = Math.round(this.oy + this.cursor.ty * this.TH);
      g.fillStyle = this.cursor.ok ? '#FFE9A855' : '#FF3B2E66';
      g.fillRect(px, py, this.T, Math.round(this.TH));
    }
    if (this.range) ring(g, this.sx(this.range.x), this.sy(this.range.y), (this.range.r / TILE) * this.T, (this.range.r / TILE) * this.TH, '#FFE9A8aa');

    // Everything that stands up is drawn back to front.
    const things: { depth: number; draw: () => void }[] = [];
    for (const key of s.blocked) {
      const [tx, ty] = key.split(',').map(Number) as [number, number];
      things.push({ depth: ty + 0.5, draw: () => this.rock(this.ox + tx * this.T + this.T / 2, Math.round(this.oy + (ty + 0.6) * this.TH)) });
    }
    // A cave mouth at every spawn gate, so each entrance reads at a glance; one sect gate at the shared goal.
    for (const p of s.paths) things.push({ depth: p[0]!.y / TILE, draw: () => this.cave(this.sx(p[0]!.x), this.sy(p[0]!.y)) });
    const goal = s.paths[0]!.at(-1)!;
    things.push({ depth: goal.y / TILE, draw: () => this.gate(this.sx(goal.x), this.sy(goal.y)) });
    for (const d of s.disciples) {
      const off = d.offT > 0 || (s.sealT > 0 && s.sealEl != null && d.els.includes(s.sealEl));
      things.push({ depth: d.y / TILE, draw: () => this.disciple(d.unit ?? d.els[0]!, d.level, this.sx(d.x), this.sy(d.y), off, now + d.id * 97) });
    }
    for (const e of s.enemies) {
      if (e.type === 'assassin' && !e.revealed && Math.floor(now / 150) % 4 !== 0) continue; // a hidden assassin only flickers
      const p = this.seen.get(e.id) ?? e;
      things.push({ depth: p.y / TILE, draw: () => this.enemy(e.type, e.hp / e.maxHp, this.sx(p.x), this.sy(p.y), e, now) });
    }
    things.sort((a, b) => a.depth - b.depth);
    for (const t of things) t.draw();
    for (const f of this.fx) f.draw(g, (now - f.from) / (f.until - f.from));
  }

  private shadow(x: number, y: number, w: number) {
    this.g.fillStyle = '#00000066';
    this.g.fillRect(x - w, y - 1, w * 2, 3);
    this.g.fillRect(x - w + 2, y - 2, w * 2 - 4, 5);
  }

  private rock(x: number, y: number) {
    const g = this.g;
    this.shadow(x, y, 9);
    g.fillStyle = '#3A3540'; g.fillRect(x - 8, y - 10, 16, 10);
    g.fillStyle = '#4E4858'; g.fillRect(x - 8, y - 12, 16, 3);
    g.fillStyle = '#2A2630'; g.fillRect(x + 3, y - 9, 5, 9);
  }

  private cave(x: number, y: number) {
    const g = this.g;
    g.fillStyle = '#2A2630'; g.fillRect(x - 11, y - 16, 22, 16);
    g.fillStyle = '#4E4858'; g.fillRect(x - 11, y - 18, 22, 3);
    g.fillStyle = '#0B0910'; g.fillRect(x - 6, y - 12, 12, 12);
  }

  private gate(x: number, y: number) {
    const g = this.g;
    g.fillStyle = '#4A0E0A'; g.fillRect(x - 12, y - 26, 3, 26); g.fillRect(x + 9, y - 26, 3, 26);
    g.fillStyle = '#9A2A1E'; g.fillRect(x - 15, y - 29, 30, 4); g.fillRect(x - 13, y - 22, 26, 2);
    g.fillStyle = '#E3B04B'; g.fillRect(x - 2, y - 28, 4, 2);
  }

  // A disciple: sect-coloured robe, dark hat, and what its role carries; one gold pip per level above 1.
  private disciple(key: string, level: number, x: number, y: number, off: boolean, t: number) {
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
  private enemy(type: string, hp: number, x: number, y: number, e: Status, now: number) {
    const g = this.g;
    const def = enemyDefs.get(type)!;
    const boss = def.boss != null;
    const w = boss ? 8 : type === 'brute' ? 6 : 4, h = boss ? 22 : 11;
    const lift = def.air ? 8 + Math.round(Math.sin(now / 200 + e.id) * 2) : 0;
    this.shadow(x, y, w + 2);
    const top = y - h - lift;
    g.fillStyle = '#120A0C'; g.fillRect(x - w - 1, top - 6, w * 2 + 2, h + 7); // outline
    g.fillStyle = boss ? '#5A0E14' : ENEMY_COLOR[type] ?? '#7A2A2A';
    g.fillRect(x - w, top, w * 2, h);
    g.fillStyle = '#D8C0A8'; g.fillRect(x - 3, top - 5, 6, 5);
    g.fillStyle = '#120A0C'; g.fillRect(x + 1, top - 3, 1, 1); // eye, facing the gate
    if (def.air) { g.fillStyle = '#2A3A2A'; g.fillRect(x - w - 5, top + 2, 5, 2); g.fillRect(x + w, top + 2, 5, 2); }
    const tint = e.burnT > 0 ? '#FF6A1F88' : e.poison > 0 ? '#5BC46A88' : e.stunT > 0 || e.slowT > 0 ? '#7FD0FF88' : null;
    if (tint) { g.fillStyle = tint; g.fillRect(x - w, top, w * 2, h); }
    const bw = boss ? 24 : 12;
    g.fillStyle = '#200808'; g.fillRect(x - bw / 2, top - 9, bw, 2);
    g.fillStyle = '#E23B2E'; g.fillRect(x - bw / 2, top - 9, Math.max(1, Math.round(bw * Math.max(0, hp))), 2);
  }

  dispose(): void { this.fx = []; this.seen.clear(); }
}

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, w: number) {
  g.strokeStyle = color; g.lineWidth = w;
  g.beginPath(); g.moveTo(x0 + 0.5, y0 + 0.5); g.lineTo(x1 + 0.5, y1 + 0.5); g.stroke();
}

function ring(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  g.strokeStyle = color; g.lineWidth = 1;
  g.beginPath(); g.ellipse(x + 0.5, y + 0.5, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2); g.stroke();
}
