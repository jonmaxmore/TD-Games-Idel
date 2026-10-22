import Phaser from 'phaser';
import {
  canBuild, COMBOS, createGame, ECONOMY, findCombo, GRID_H, GRID_W, isOver, placeCost, SECTS, sellValue, step, upgradeCost,
  UPGRADE, type Command, type DefendState, type Disciple, type Replay, type SimEvent,
} from '@five-sects/sim';
import { discipleKey, EL_COLOR, EL_GLYPH, enemyKey, groundKey } from '../art';
import { banner, floatText, impact, projectile } from '../fx';
import { button, COLORS, H, text, W, setupCamera } from '../ui';
import { showResult } from './result';

const T = 16;
const OX = 2;
const OY = 16;
const TICK_MS = 50;
const sx = (m: number) => OX + (m * T) / 1000;
const sy = (m: number) => OY + (m * T) / 1000;
const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;

export class DefendScene extends Phaser.Scene {
  private s!: DefendState;
  private pending: Command[] = [];
  private acc = 0;
  private speed = 1;
  private prev = new Map<number, [number, number]>();
  private enemySprites = new Map<number, Phaser.GameObjects.Image>();
  private discipleLayer!: Phaser.GameObjects.Container;
  private discipleSig = '';
  private bars!: Phaser.GameObjects.Graphics;
  private hud!: { silver: Phaser.GameObjects.Text; lives: Phaser.GameObjects.Text; wave: Phaser.GameObjects.Text };
  private panel: Phaser.GameObjects.Container | null = null;
  private rangeRing: Phaser.GameObjects.Arc | null = null;
  private waveBtn!: Phaser.GameObjects.Container;
  private ended = false;
  // seed + commands per tick: enough to replay this exact game with runReplay()
  private replay!: Replay;

  constructor() { super('defend'); }

  create(data: { stageId: string }) {
    setupCamera(this);
    const seed = (Math.random() * 2 ** 31) >>> 0;
    this.s = createGame(data.stageId, seed) as DefendState;
    this.replay = { stageId: data.stageId, seed, commands: {} };
    (window as unknown as { __lastReplay: Replay }).__lastReplay = this.replay;
    this.pending = []; this.acc = 0; this.speed = 1; this.ended = false; this.panel = null; this.rangeRing = null;
    this.prev.clear(); this.enemySprites.clear(); this.discipleSig = '';

    const pathTiles = new Set(this.s.pathTiles);
    this.add.image(OX, OY, groundKey(this, `ground-${data.stageId}`, GRID_W, GRID_H, pathTiles)).setOrigin(0);
    const [startX, startY] = this.s.path[0]!;
    const [endX, endY] = this.s.path[this.s.path.length - 1]!;
    this.add.rectangle(sx(startX), sy(startY), 14, 14).setStrokeStyle(1, 0xd2412f);
    this.add.rectangle(sx(endX), sy(endY), 14, 14).setStrokeStyle(1, 0xe3b04b);

    this.discipleLayer = this.add.container(0, 0).setDepth(10);
    this.bars = this.add.graphics().setDepth(30);

    this.add.rectangle(0, 0, W, OY, COLORS.ink).setOrigin(0).setDepth(40);
    this.hud = {
      silver: text(this, 4, 3, '', 8, COLORS.gold).setDepth(41),
      lives: text(this, 54, 3, '', 8, COLORS.seal).setDepth(41),
      wave: text(this, W - 4, 3, '', 8).setOrigin(1, 0).setDepth(41),
    };
    const speedBtn = button(this, 96, 2, 24, 12, 'x1', () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 3 : 1;
      (speedBtn.list[1] as Phaser.GameObjects.Text).setText(`x${this.speed}`);
    }, { size: 6 }).setDepth(42);

    this.add.rectangle(0, H - 16, W, 16, COLORS.ink).setOrigin(0).setDepth(40);
    this.waveBtn = button(this, 4, H - 14, 100, 12, 'เริ่มบุก (wave 1)', () => this.pending.push({ t: 'nextWave' }), { size: 6, color: 0x3a2a14 }).setDepth(42);
    button(this, W - 40, H - 14, 36, 12, 'เมนู', () => this.scene.start('menu'), { size: 6 }).setDepth(42);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length > 0) return; // a button handled it
      this.onTap(p.worldX, p.worldY);
    });
    this.syncDisciples();
    this.updateHud();
  }

  private onTap(x: number, y: number) {
    const tx = Math.floor((x - OX) / T), ty = Math.floor((y - OY) / T);
    this.closePanel();
    if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return;
    const d = this.s.disciples.find((q) => q.tx === tx && q.ty === ty);
    if (d) this.openDisciplePanel(d);
    else if (canBuild(this.s, tx, ty)) this.openBuildPanel(tx, ty);
  }

  private closePanel() {
    this.panel?.destroy(); this.panel = null;
    this.rangeRing?.destroy(); this.rangeRing = null;
  }

  private panelAt(ty: number, h: number) {
    const y = ty >= GRID_H / 2 ? OY + 6 : H - 18 - h;
    const c = this.add.container(0, 0).setDepth(60);
    c.add(this.add.rectangle(4, y, W - 8, h, COLORS.panel, 0.96).setOrigin(0).setStrokeStyle(1, COLORS.line).setInteractive());
    this.panel = c;
    return { c, y };
  }

  private openBuildPanel(tx: number, ty: number) {
    const sects = this.s.unlocked;
    const { c, y } = this.panelAt(ty, 46);
    c.add(this.add.rectangle(OX + tx * T + T / 2, OY + ty * T + T / 2, T, T).setStrokeStyle(1, 0xe3b04b));
    c.add(text(this, 10, y + 4, 'วางศิษย์', 7, COLORS.mist));
    const bw = Math.min(28, (W - 20) / Math.max(1, sects.length));
    sects.forEach((el, i) => {
      const cost = placeCost(el);
      const ok = this.s.silver >= cost;
      const bx = 10 + i * bw;
      c.add(button(this, bx, y + 14, bw - 2, 28, '', () => {
        this.pending.push({ t: 'place', sect: el, tx, ty }); this.closePanel();
      }, { enabled: ok }));
      c.add(this.add.image(bx + (bw - 2) / 2, y + 22, discipleKey(this, [el])).setScale(0.75).setAlpha(ok ? 1 : 0.4));
      c.add(text(this, bx + (bw - 2) / 2, y + 33, `${cost}`, 6, ok ? COLORS.gold : COLORS.mist).setOrigin(0.5, 0));
    });
  }

  private openDisciplePanel(d: Disciple) {
    const { c, y } = this.panelAt(d.ty, 58);
    const stats = SECTS[d.els[0]!];
    this.rangeRing = this.add.circle(sx(d.x), sy(d.y), (Math.max(...d.els.map((e) => SECTS[e].range)) * T) / 1000)
      .setStrokeStyle(1, hex(EL_COLOR[d.els[0]!]), 0.8).setDepth(55);
    const combo = d.combo ? COMBOS.find((x) => x.id === d.combo) : null;
    const title = combo ? `${combo.nameTh} (ยุทธ์ผสาน)` : `${stats.nameTh}`;
    c.add(text(this, 10, y + 4, `${d.els.map((e) => EL_GLYPH[e]).join('+')} ${title}`, 7));
    c.add(text(this, 10, y + 15, combo ? 'ระดับสูงสุด' : `ระดับ ${d.level}/${UPGRADE.levels} · ${UPGRADE.names[d.level - 1]}`, 6, COLORS.mist));

    const upCost = upgradeCost(d);
    const canUp = !d.combo && d.level < UPGRADE.levels;
    c.add(button(this, 10, y + 26, 52, 14, canUp ? `อัปเกรด ${upCost}` : 'เต็มแล้ว', () => {
      this.pending.push({ t: 'upgrade', id: d.id }); this.closePanel();
    }, { enabled: canUp && this.s.silver >= upCost, size: 6 }));
    c.add(button(this, 66, y + 26, 46, 14, `ขาย +${sellValue(d)}`, () => {
      this.pending.push({ t: 'sell', id: d.id }); this.closePanel();
    }, { size: 6 }));

    // Merge candidates: adjacent, both max level, single element, a combo exists.
    if (!d.combo && d.level >= UPGRADE.levels) {
      const cands = this.s.disciples.filter((o) => o !== d && !o.combo && o.level >= UPGRADE.levels
        && Math.abs(o.tx - d.tx) <= 1 && Math.abs(o.ty - d.ty) <= 1 && findCombo(d.els[0]!, o.els[0]!));
      cands.slice(0, 3).forEach((o, i) => {
        const cb = findCombo(d.els[0]!, o.els[0]!)!;
        c.add(button(this, 10 + i * 56, y + 42, 54, 13, `ผสาน ${cb.nameTh}`, () => {
          this.pending.push({ t: 'merge', a: d.id, b: o.id }); this.closePanel();
        }, { size: 5, color: 0x3a2a14 }));
      });
      if (cands.length === 0) c.add(text(this, 10, y + 44, 'วางผู้อาวุโสต่างธาตุไว้ติดกันเพื่อผสาน', 5, COLORS.mist));
    } else if (!d.combo) c.add(text(this, 10, y + 44, 'ถึงระดับผู้อาวุโสแล้วจะผสานกับศิษย์ข้างๆ ได้', 5, COLORS.mist));
  }

  private syncDisciples() {
    const sig = this.s.disciples.map((d) => `${d.id}:${d.level}:${d.els.join('')}`).join('|');
    if (sig === this.discipleSig) return;
    this.discipleSig = sig;
    this.discipleLayer.removeAll(true);
    for (const d of this.s.disciples) {
      const x = sx(d.x), y = sy(d.y);
      if (d.combo || d.level >= 3) {
        const ring = this.add.circle(x, y + 6, 6, hex(EL_COLOR[d.els[1] ?? d.els[0]!]), 0.25);
        this.discipleLayer.add(ring);
      }
      this.discipleLayer.add(this.add.image(x, y - 1, discipleKey(this, d.els)));
      for (let i = 0; i < (d.combo ? 3 : d.level); i++)
        this.discipleLayer.add(this.add.rectangle(x - 3 + i * 3, y + 7, 2, 1, 0xe3b04b));
    }
    this.closePanel();
  }

  private updateHud() {
    this.hud.silver.setText(`ตำลึง ${this.s.silver}`);
    this.hud.lives.setText(`♥ ${this.s.lives}`);
    this.hud.wave.setText(`${this.s.wave}/${this.s.totalWaves}`);
    const label = this.s.phase === 'build' ? 'เริ่มบุก (wave 1)'
      : this.s.phase === 'break' ? `เรียก wave ถัดไป (+${ECONOMY.earlyCallBonus})` : 'กำลังสู้…';
    (this.waveBtn.list[1] as Phaser.GameObjects.Text).setText(label);
  }

  private handleEvents(events: SimEvent[]) {
    for (const ev of events) {
      switch (ev.e) {
        case 'hit': {
          const d = this.s.disciples.find((q) => q.id === ev.from);
          const en = this.s.enemies.find((q) => q.id === ev.to);
          const pos = en ? [en.x, en.y] : this.prev.get(ev.to); // killing blows: enemy already removed
          if (!d || !pos) break;
          const ex = sx(pos[0]!), ey = sy(pos[1]!) - 4;
          projectile(this, ev.el, sx(d.x), sy(d.y) - 4, ex, ey, () => {
            impact(this, ev.el, ex, ey, ev.crit);
            if (ev.crit) floatText(this, ex, ey - 6, `${ev.dmg}!`, '#FFD34A', 7);
            else if (ev.pct !== 100) floatText(this, ex, ey - 6, `${ev.dmg}`, ev.pct > 100 ? '#E3B04B' : '#9A92AE', 6);
          });
          break;
        }
        case 'kill':
          floatText(this, sx(ev.x), sy(ev.y) - 8, `+${ev.bounty}`, '#E3B04B', 6);
          break;
        case 'leak':
          this.cameras.main.flash(120, 210, 65, 47);
          break;
        case 'combo': {
          const d = this.s.disciples.find((q) => q.id === ev.id);
          const els = d?.els ?? ['metal', 'water'];
          banner(this, 150, `${els.map((e) => EL_GLYPH[e]).join('')}合擊`, ev.nameTh, [EL_COLOR[els[0]!], EL_COLOR[els[1] ?? els[0]!]]);
          this.cameras.main.shake(120, 0.004);
          break;
        }
        case 'wave':
          floatText(this, W / 2, 150, `Wave ${ev.wave}`, '#ECE3CF', 10);
          break;
        case 'interest':
          if (ev.amount > 0) floatText(this, 30, 22, `ดอกเบี้ย +${ev.amount}`, '#E3B04B', 6);
          break;
        case 'error':
          floatText(this, W / 2, H - 30, ev.msg === 'not enough silver' ? 'ตำลึงไม่พอ' : ev.msg, '#D2412F', 6);
          break;
        case 'end':
          this.ended = true;
          this.time.delayedCall(600, () => showResult(this, this.s.stageId, ev.won, ev.stars, 'defend'));
          break;
      }
    }
  }

  update(_t: number, delta: number) {
    if (!this.ended) {
      this.acc += Math.min(delta, 250) * this.speed;
      let steps = 0;
      while (this.acc >= TICK_MS && steps < 8 && !isOver(this.s)) {
        this.prev.clear();
        for (const e of this.s.enemies) this.prev.set(e.id, [e.x, e.y]);
        if (this.pending.length) this.replay.commands[this.s.tick] = this.pending;
        const events = step(this.s, this.pending);
        this.pending = [];
        this.handleEvents(events);
        this.acc -= TICK_MS;
        steps++;
      }
      this.acc = Math.min(this.acc, 8 * TICK_MS); // don't build an endless catch-up backlog on slow frames
      this.syncDisciples();
      this.updateHud();
    }
    this.renderEnemies(Math.min(1, this.acc / TICK_MS));
  }

  private renderEnemies(alpha: number) {
    const seen = new Set<number>();
    this.bars.clear();
    for (const e of this.s.enemies) {
      seen.add(e.id);
      let img = this.enemySprites.get(e.id);
      if (!img) {
        img = this.add.image(0, 0, enemyKey(this, e.type)).setDepth(20);
        this.enemySprites.set(e.id, img);
      }
      const [px, py] = this.prev.get(e.id) ?? [e.x, e.y];
      const x = sx(px + (e.x - px) * alpha), y = sy(py + (e.y - py) * alpha);
      const bob = e.air ? -4 : ((e.age >> 2) & 1);
      img.setPosition(Math.round(x), Math.round(y - 2 - bob)).setScale(e.small ? 0.6 : e.type === 'brute' ? 1.15 : 1);
      img.setAlpha(e.type === 'assassin' && !e.revealed ? 0.35 : 1);
      img.setTint(e.stunT > 0 ? 0xbfe6ff : 0xffffff);
      const bw = 10, by = Math.round(y - 12 - bob);
      this.bars.fillStyle(0x1a1423).fillRect(Math.round(x - bw / 2), by, bw, 2);
      this.bars.fillStyle(0xd2412f).fillRect(Math.round(x - bw / 2), by, Math.max(0, Math.round((bw * e.hp) / e.maxHp)), 2);
      if (e.burnT > 0) this.bars.fillStyle(0xff5a1f).fillRect(Math.round(x - 1), by - 3, 2, 2);
      for (let i = 0; i < e.poison; i++) this.bars.fillStyle(0x7ce08a).fillRect(Math.round(x - 5 + i * 3), by - 3, 2, 2);
      if (e.slowT > 0) this.bars.fillStyle(0xbfe6ff).fillRect(Math.round(x - 5), Math.round(y + 5), 10, 1);
    }
    for (const [id, img] of this.enemySprites) if (!seen.has(id)) { img.destroy(); this.enemySprites.delete(id); }
  }
}
