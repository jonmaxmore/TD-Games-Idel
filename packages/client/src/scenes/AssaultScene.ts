import Phaser from 'phaser';
import { createGame, GRID_H, GRID_W, isOver, LAYOUTS, step, TICK_HZ, type AssaultState, type Command, type SimEvent } from '@five-sects/sim';
import { discipleKey, enemyKey, groundKey, outpostKey } from '../art';
import { floatText, impact, projectile } from '../fx';
import { button, COLORS, H, text, W, setupCamera } from '../ui';
import { showResult } from './result';

const T = 16;
const OX = 2;
const OY = 16;
const TICK_MS = 50;
const sx = (m: number) => OX + (m * T) / 1000;
const sy = (m: number) => OY + (m * T) / 1000;

type Pt = [number, number];

function tilesOf(points: Pt[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!, [x1, y1] = points[i]!;
    for (let x = x0, y = y0; ; x += Math.sign(x1 - x0), y += Math.sign(y1 - y0)) {
      out.push(`${x},${y}`);
      if (x === x1 && y === y1) break;
    }
  }
  return out;
}

export class AssaultScene extends Phaser.Scene {
  private s!: AssaultState;
  private pending: Command[] = [];
  private acc = 0;
  private prev: Pt[] = [];
  private members: Phaser.GameObjects.Image[] = [];
  private outposts: Phaser.GameObjects.Image[] = [];
  private bars!: Phaser.GameObjects.Graphics;
  private skillBtns: Phaser.GameObjects.Container[] = [];
  private routePanel: Phaser.GameObjects.Container | null = null;
  private pills: Phaser.GameObjects.Rectangle[] = [];
  private shade: Phaser.GameObjects.Rectangle[] = [];
  private status!: Phaser.GameObjects.Text;
  private ended = false;

  constructor() { super('assault'); }

  create(data: { stageId: string }) {
    setupCamera(this);
    this.s = createGame(data.stageId, (Math.random() * 2 ** 31) >>> 0) as AssaultState;
    this.pending = []; this.acc = 0; this.ended = false; this.routePanel = null;
    this.members = []; this.outposts = []; this.skillBtns = []; this.pills = []; this.shade = [];

    const layout = LAYOUTS['assault-a'];
    if (!layout || layout.kind !== 'assault') throw new Error('missing assault layout');
    const branchStart = layout.start[layout.start.length - 1]!;
    const left = tilesOf([branchStart, ...layout.left, ...layout.end]);
    const right = tilesOf([branchStart, ...layout.right]);
    const tiles = new Set([...tilesOf(layout.start), ...left, ...right]);
    this.add.image(OX, OY, groundKey(this, 'ground-assault-a', GRID_W, GRID_H, tiles)).setOrigin(0);
    this.registry.set('assault-right-tiles', right);
    this.registry.set('assault-left-tiles', left);
    const [ex, ey] = layout.end[0]!;
    this.add.rectangle(OX + ex * T + T / 2, OY + ey * T + T / 2, 14, 14).setStrokeStyle(1, 0xe3b04b);

    for (const p of this.s.pills) this.pills.push(this.add.rectangle(sx(p[0]), sy(p[1]), 4, 4, 0x7ce08a).setDepth(5));
    for (const o of this.s.outposts) this.outposts.push(this.add.image(sx(o.x), sy(o.y) - 2, outpostKey(this)).setDepth(8));
    for (const m of this.s.members) this.members.push(this.add.image(sx(m.x), sy(m.y), discipleKey(this, [m.el])).setDepth(10));
    this.add.image(0, 0, enemyKey(this, 'cultist')).setVisible(false);
    this.bars = this.add.graphics().setDepth(30);

    this.add.rectangle(0, 0, W, OY, COLORS.ink).setOrigin(0).setDepth(40);
    text(this, 4, 3, `${data.stageId} บุกค่าย`, 8).setDepth(41);
    this.status = text(this, W - 4, 3, '', 7, COLORS.mist).setOrigin(1, 0).setDepth(41);

    this.add.rectangle(0, H - 16, W, 16, COLORS.ink).setOrigin(0).setDepth(40);
    this.s.members.forEach((m, i) => {
      const b = button(this, 4 + i * 44, H - 14, 42, 12, 'ปราณกระบี่', () => this.pending.push({ t: 'skill', member: i }), { size: 5, color: 0x3a2a14 }).setDepth(42);
      this.skillBtns.push(b);
    });
    button(this, W - 40, H - 14, 36, 12, 'เมนู', () => this.scene.start('menu'), { size: 6 }).setDepth(42);
  }

  private showRoutePanel() {
    if (this.routePanel) return;
    const c = this.add.container(0, 0).setDepth(60);
    c.add(this.add.rectangle(8, 200, W - 16, 70, COLORS.panel, 0.96).setOrigin(0).setStrokeStyle(1, COLORS.line).setInteractive());
    c.add(text(this, W / 2, 206, 'ทางแยก: เลือกเส้นทางบุก', 8).setOrigin(0.5, 0));
    c.add(button(this, 14, 222, 74, 40, '', () => this.pending.push({ t: 'route', choice: 'left' })));
    c.add(text(this, 51, 228, 'ซ้าย', 8).setOrigin(0.5, 0));
    c.add(text(this, 51, 242, 'ป้อมเล็ก 2 + ยาฟื้นพลัง', 5, COLORS.mist).setOrigin(0.5, 0));
    c.add(button(this, W - 88, 222, 74, 40, '', () => this.pending.push({ t: 'route', choice: 'right' })));
    c.add(text(this, W - 51, 228, 'ขวา', 8).setOrigin(0.5, 0));
    c.add(text(this, W - 51, 242, 'ป้อมใหญ่ 1 · สั้นกว่า', 5, COLORS.mist).setOrigin(0.5, 0));
    this.routePanel = c;
  }

  private handleEvents(events: SimEvent[]) {
    for (const ev of events) {
      if (ev.e === 'outpostHit') {
        const m = this.s.members[ev.member]!, o = this.s.outposts[ev.outpost]!;
        const tx = sx(o.x), ty = sy(o.y) - 4;
        projectile(this, 'metal', sx(m.x), sy(m.y) - 4, tx, ty, () => {
          impact(this, 'metal', tx, ty, ev.skill);
          if (ev.skill) floatText(this, tx, ty - 6, `${ev.dmg}!`, '#FFD34A', 8);
        });
        if (ev.skill) this.cameras.main.shake(80, 0.003);
      } else if (ev.e === 'memberHit') {
        const m = this.s.members[ev.member]!, o = this.s.outposts[ev.outpost]!;
        projectile(this, 'fire', sx(o.x), sy(o.y) - 6, sx(m.x), sy(m.y) - 4, () => impact(this, 'fire', sx(m.x), sy(m.y) - 4));
      } else if (ev.e === 'outpostDown') {
        const o = this.s.outposts[ev.outpost]!;
        impact(this, 'earth', sx(o.x), sy(o.y), true);
        this.outposts[ev.outpost]!.setTint(0x333333).setAlpha(0.5);
      } else if (ev.e === 'memberDown') {
        this.members[ev.member]!.setTint(0x555555).setAngle(90);
        floatText(this, W / 2, 140, 'ศิษย์ล้ม!', '#D2412F', 9);
      } else if (ev.e === 'pill') {
        this.pills.forEach((p) => p.destroy()); this.pills = [];
        floatText(this, sx(ev.at[0]), sy(ev.at[1]) - 8, 'ฟื้นพลัง +30%', '#7CE08A', 7);
      } else if (ev.e === 'end') {
        this.ended = true;
        this.time.delayedCall(600, () => showResult(this, this.s.stageId, ev.won, ev.stars, 'assault'));
      }
    }
  }

  update(_t: number, delta: number) {
    if (!this.ended) {
      this.acc += Math.min(delta, 250);
      while (this.acc >= TICK_MS && !isOver(this.s)) {
        this.prev = this.s.members.map((m) => [m.x, m.y]);
        const before = this.s.route;
        const events = step(this.s, this.pending);
        this.pending = [];
        if (before === null && this.s.route !== null) this.onRouteChosen();
        this.handleEvents(events);
        this.acc -= TICK_MS;
      }
      if (this.s.phase === 'choosing') this.showRoutePanel();
    }
    this.render(Math.min(1, this.acc / TICK_MS));
  }

  private onRouteChosen() {
    this.routePanel?.destroy(); this.routePanel = null;
    const other = (this.registry.get(this.s.route === 'left' ? 'assault-right-tiles' : 'assault-left-tiles') as string[])
      .filter((k) => !(this.registry.get(this.s.route === 'left' ? 'assault-left-tiles' : 'assault-right-tiles') as string[]).includes(k));
    for (const k of other) {
      const [x, y] = k.split(',').map(Number);
      this.shade.push(this.add.rectangle(OX + x! * T, OY + y! * T, T, T, 0x000000, 0.45).setOrigin(0).setDepth(4));
    }
    this.s.outposts.forEach((o, i) => { if (o.route !== 'any' && o.route !== this.s.route) this.outposts[i]!.setAlpha(0.25); });
  }

  private render(alpha: number) {
    this.bars.clear();
    this.s.members.forEach((m, i) => {
      const [px, py] = this.prev[i] ?? [m.x, m.y];
      const x = sx(px + (m.x - px) * alpha), y = sy(py + (m.y - py) * alpha);
      this.members[i]!.setPosition(Math.round(x), Math.round(y - 2));
      if (m.hp > 0) {
        this.bars.fillStyle(0x1a1423).fillRect(Math.round(x - 5), Math.round(y - 12), 10, 2);
        this.bars.fillStyle(0x7ce08a).fillRect(Math.round(x - 5), Math.round(y - 12), Math.max(0, Math.round((10 * m.hp) / m.maxHp)), 2);
      }
      const btn = this.skillBtns[i]!;
      const label = btn.list[1] as Phaser.GameObjects.Text;
      label.setText(m.hp <= 0 ? 'ล้มแล้ว' : m.skillCd > 0 ? `ปราณกระบี่ ${Math.ceil(m.skillCd / TICK_HZ)}` : 'ปราณกระบี่');
    });
    this.s.outposts.forEach((o) => {
      if (o.hp <= 0) return;
      this.bars.fillStyle(0x1a1423).fillRect(Math.round(sx(o.x) - 7), Math.round(sy(o.y) - 13), 14, 2);
      this.bars.fillStyle(0xd2412f).fillRect(Math.round(sx(o.x) - 7), Math.round(sy(o.y) - 13), Math.max(0, Math.round((14 * o.hp) / o.maxHp)), 2);
    });
    const alive = this.s.members.filter((m) => m.hp > 0).length;
    const phaseTh = { moving: 'เดินทัพ', fighting: 'ปะทะป้อม', choosing: 'ทางแยก', won: 'ชนะ', lost: 'แพ้' }[this.s.phase];
    this.status.setText(`${phaseTh} · ศิษย์ ${alive}/3 · ${Math.floor(this.s.tick / TICK_HZ)} วิ`);
  }
}
