import Phaser from 'phaser';
import {
  ARTS, canBuild, CARDS, COMBOS, createGame, ECONOMY, ELITES, ENEMIES, findCombo, GRID_H, GRID_W, isOver, placeCost,
  previewWave, SECTS, sellValue, STAGES, step, TARGET_MODES, upgradeCost, UPGRADE,
  type Command, type DefendState, type Disciple, type Replay, type SimEvent, type TargetMode,
} from '@five-sects/sim';
import { discipleKey, EL_COLOR, EL_GLYPH, enemyKey, groundKey } from '../art';
import { banner, floatText, impact, projectile } from '../fx';
import { button, COLORS, H, text, W, setupCamera } from '../ui';
import { showResult } from './result';
import { Tutorial } from './tutorial';

const T = 16;
const OX = 2;
const OY = 16;
const TICK_MS = 50;
const sx = (m: number) => OX + (m * T) / 1000;
const sy = (m: number) => OY + (m * T) / 1000;
const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;

const ART_SHORT: Record<string, string> = { heaven_sword: 'ฟัน', time_incense: 'ชะลอ', silver_rain: 'เงิน×2', lion_roar: 'มึน' };
const TARGET_TH: Record<TargetMode, string> = { first: 'หน้าสุด', strong: 'เลือดมากสุด', weak: 'เลือดน้อยสุด', close: 'ใกล้สุด' };

type PanelSpec = { kind: 'build'; tx: number; ty: number } | { kind: 'disciple'; id: number; confirmSell?: boolean };

export class DefendScene extends Phaser.Scene {
  private s!: DefendState;
  private pending: Command[] = [];
  private acc = 0;
  private speed = 1;
  private paused = false;
  private prev = new Map<number, [number, number]>();
  private enemySprites = new Map<number, Phaser.GameObjects.Image>();
  private discipleLayer!: Phaser.GameObjects.Container;
  private discipleSig = '';
  private bars!: Phaser.GameObjects.Graphics;
  private hud!: { silver: Phaser.GameObjects.Text; lives: Phaser.GameObjects.Text; wave: Phaser.GameObjects.Text };
  private panel: Phaser.GameObjects.Container | null = null;
  private panelSpec: PanelSpec | null = null;
  private panelSilver = -1;
  private waveBtn!: Phaser.GameObjects.Container;
  private artBtns: Phaser.GameObjects.Container[] = [];
  private cardPanel: Phaser.GameObjects.Container | null = null;
  private preview!: Phaser.GameObjects.Container;
  private previewWaveNo = -1;
  private pauseText!: Phaser.GameObjects.Text;
  private seenElites = new Set<string>();
  private tutorial: Tutorial | null = null;
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
    this.pending = []; this.acc = 0; this.speed = 1; this.paused = false; this.ended = false;
    this.panel = null; this.panelSpec = null; this.cardPanel = null; this.previewWaveNo = -1;
    this.prev.clear(); this.enemySprites.clear(); this.discipleSig = ''; this.artBtns = []; this.seenElites.clear();

    const pathTiles = new Set(this.s.pathTiles);
    this.add.image(OX, OY, groundKey(this, `ground-${data.stageId}`, GRID_W, GRID_H, pathTiles)).setOrigin(0);
    const [startX, startY] = this.s.path[0]!;
    const [endX, endY] = this.s.path[this.s.path.length - 1]!;
    this.add.rectangle(sx(startX), sy(startY), 14, 14).setStrokeStyle(1, 0xd2412f);
    text(this, sx(startX), sy(startY), 'มาร', 6, COLORS.seal).setOrigin(0.5).setAlpha(0.8);
    this.add.rectangle(sx(endX), sy(endY), 14, 14).setStrokeStyle(1, 0xe3b04b);
    text(this, sx(endX), sy(endY), 'บ้าน', 6, COLORS.gold).setOrigin(0.5).setAlpha(0.8);

    this.discipleLayer = this.add.container(0, 0).setDepth(10);
    this.bars = this.add.graphics().setDepth(30);
    this.preview = this.add.container(0, 0).setDepth(45);

    // Top bar: silver, lives, speed, pause, wave.
    this.add.rectangle(0, 0, W, OY, COLORS.ink).setOrigin(0).setDepth(40);
    this.hud = {
      silver: text(this, 4, 3, '', 8, COLORS.gold).setDepth(41),
      lives: text(this, 58, 3, '', 8, COLORS.seal).setDepth(41),
      wave: text(this, W - 4, 3, '', 8).setOrigin(1, 0).setDepth(41),
    };
    const speedBtn = button(this, 92, 2, 22, 12, 'x1', () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 3 : 1;
      (speedBtn.list[1] as Phaser.GameObjects.Text).setText(`x${this.speed}`);
    }, { size: 6 }).setDepth(42);
    button(this, 116, 2, 22, 12, '❚❚', () => this.togglePause(), { size: 6 }).setDepth(42);
    this.pauseText = text(this, W / 2, 150, 'หยุดชั่วคราว · แตะ ❚❚ เพื่อเล่นต่อ', 8).setOrigin(0.5).setDepth(85).setVisible(false);

    // Bottom bar: wave call, secret arts, menu.
    this.add.rectangle(0, H - 16, W, 16, COLORS.ink).setOrigin(0).setDepth(40);
    this.waveBtn = button(this, 2, H - 14, 66, 12, 'เริ่มบุก', () => this.pending.push({ t: 'nextWave' }), { size: 6, color: 0x3a2a14 }).setDepth(42);
    ARTS.forEach((art, i) => {
      const b = button(this, 71 + i * 20, H - 15, 18, 14, art.glyph, () => this.pending.push({ t: 'cast', art: art.id }), { size: 8, color: 0x2a1420 }).setDepth(42);
      this.artBtns.push(b);
    });
    button(this, W - 28, H - 14, 26, 12, 'เมนู', () => this.scene.start('menu'), { size: 6 }).setDepth(42);
    const hint = text(this, W / 2, H - 24, `ไม้ตาย: ${ARTS.map((x) => `${x.glyph} ${ART_SHORT[x.id] ?? ''}`).join(' · ')}`, 6, COLORS.mist).setOrigin(0.5).setDepth(42);
    this.time.delayedCall(12000, () => this.tweens.add({ targets: hint, alpha: 0, duration: 600, onComplete: () => hint.destroy() }));

    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length > 0) return; // a button handled it
      this.onTap(p.worldX, p.worldY);
    });
    this.tutorial = data.stageId === '1-1' ? new Tutorial(this, OX, OY, T) : null;
    this.syncDisciples();
    this.updateHud();
  }

  private togglePause() {
    this.paused = !this.paused;
    this.pauseText.setVisible(this.paused);
  }

  // ---------- panels ----------

  private pendingPlaceAt(tx: number, ty: number) {
    return this.pending.some((c) => c.t === 'place' && c.tx === tx && c.ty === ty);
  }

  private onTap(x: number, y: number) {
    const tx = Math.floor((x - OX) / T), ty = Math.floor((y - OY) / T);
    this.closePanel();
    if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H || this.pendingPlaceAt(tx, ty)) return;
    const d = this.s.disciples.find((q) => q.tx === tx && q.ty === ty);
    if (d) this.openPanel({ kind: 'disciple', id: d.id });
    else if (canBuild(this.s, tx, ty)) this.openPanel({ kind: 'build', tx, ty });
  }

  private closePanel() {
    this.panel?.destroy(); this.panel = null; this.panelSpec = null;
  }

  private openPanel(spec: PanelSpec) {
    this.panel?.destroy();
    this.panelSpec = spec;
    this.panelSilver = this.s.silver;
    if (spec.kind === 'build') this.buildPanel(spec.tx, spec.ty);
    else {
      const d = this.s.disciples.find((q) => q.id === spec.id);
      if (d) this.disciplePanel(d, !!spec.confirmSell); else this.closePanel();
    }
  }

  private panelBox(ty: number, h: number) {
    const y = ty >= GRID_H / 2 ? OY + 6 : H - 18 - h;
    const c = this.add.container(0, 0).setDepth(60);
    c.add(this.add.rectangle(4, y, W - 8, h, COLORS.panel, 0.96).setOrigin(0).setStrokeStyle(1, COLORS.line).setInteractive());
    this.panel = c;
    return { c, y };
  }

  private buildPanel(tx: number, ty: number) {
    const sects = this.s.unlocked;
    const guests = STAGES[this.s.stageId]?.guestSects ?? [];
    const { c, y } = this.panelBox(ty, 54);
    // Buildable tiles and the reach of the longest-range option, so placement is an informed choice.
    const g = this.add.graphics();
    for (let yy = 0; yy < GRID_H; yy++) for (let xx = 0; xx < GRID_W; xx++)
      if (canBuild(this.s, xx, yy)) g.fillStyle(0xffffff, 0.05).fillRect(OX + xx * T + 1, OY + yy * T + 1, T - 2, T - 2);
    c.addAt(g, 0);
    const cx = OX + tx * T + T / 2, cy = OY + ty * T + T / 2;
    const reach = Math.max(...sects.map((el) => SECTS[el].range));
    c.add(this.add.circle(cx, cy, (reach * T) / 1000).setStrokeStyle(1, 0xe3b04b, 0.5));
    c.add(this.add.rectangle(cx, cy, T, T).setStrokeStyle(1, 0xe3b04b));
    c.add(text(this, 10, y + 3, 'วางศิษย์ (แตะเพื่อวาง)', 7, COLORS.mist));
    const bw = Math.min(28, (W - 20) / Math.max(1, sects.length));
    sects.forEach((el, i) => {
      const cost = placeCost(el);
      const ok = this.s.silver >= cost;
      const bx = 10 + i * bw;
      c.add(button(this, bx, y + 13, bw - 2, 38, '', () => {
        this.pending.push({ t: 'place', sect: el, tx, ty });
        this.tutorial?.on('placed');
        this.closePanel();
      }, { enabled: ok }));
      c.add(this.add.image(bx + (bw - 2) / 2, y + 22, discipleKey(this, [el])).setAlpha(ok ? 1 : 0.4));
      c.add(text(this, bx + (bw - 2) / 2, y + 31, EL_GLYPH[el], 6, EL_COLOR[el]).setOrigin(0.5, 0));
      c.add(text(this, bx + (bw - 2) / 2, y + 40, `${cost}`, 6, ok ? COLORS.gold : COLORS.mist).setOrigin(0.5, 0));
      if (guests.includes(el)) c.add(text(this, bx + bw - 3, y + 14, 'เชิญ', 6, COLORS.gold).setOrigin(1, 0));
    });
  }

  private statsAt(d: Disciple, level: number) {
    const base = d.els.reduce((sum, el) => sum + SECTS[el].dmg, 0);
    return Math.floor((base * UPGRADE.statPct[level - 1]!) / 100);
  }

  private disciplePanel(d: Disciple, confirmSell: boolean) {
    const { c, y } = this.panelBox(d.ty, 70);
    const reach = Math.max(...d.els.map((e) => SECTS[e].range));
    c.add(this.add.circle(sx(d.x), sy(d.y), (reach * T) / 1000).setStrokeStyle(1, hex(EL_COLOR[d.els[0]!]), 0.8));
    const combo = d.combo ? COMBOS.find((x) => x.id === d.combo) : null;
    const title = combo ? `${combo.nameTh} (ยุทธ์ผสาน)` : SECTS[d.els[0]!].nameTh;
    c.add(text(this, 10, y + 3, `${d.els.map((e) => EL_GLYPH[e]).join('+')} ${title}`, 8));
    const lvlName = combo ? 'ระดับสูงสุด' : `${UPGRADE.names[d.level - 1]} · ระดับ ${d.level}/${UPGRADE.levels}`;
    const canUp = !d.combo && d.level < UPGRADE.levels;
    const dmgNow = this.statsAt(d, d.level);
    c.add(text(this, 10, y + 14, `${lvlName} · ดาเมจ ${dmgNow}${canUp ? ` → ${this.statsAt(d, d.level + 1)}` : ''}`, 6, COLORS.mist));

    const upCost = upgradeCost(d);
    c.add(button(this, 10, y + 25, 54, 15, canUp ? `อัปเกรด ${upCost}` : 'เต็มแล้ว', () => {
      this.pending.push({ t: 'upgrade', id: d.id });
      this.tutorial?.on('upgraded');
      this.closePanel();
    }, { enabled: canUp && this.s.silver >= upCost, size: 6, color: 0x3a2a14 }));
    c.add(button(this, 68, y + 25, 50, 15, confirmSell ? 'ยืนยันขาย?' : `ขาย +${sellValue(d, this.s)}`, () => {
      if (confirmSell) { this.pending.push({ t: 'sell', id: d.id }); this.closePanel(); }
      else this.openPanel({ kind: 'disciple', id: d.id, confirmSell: true });
    }, { size: 6, color: confirmSell ? 0x5a1820 : undefined }));
    const next = TARGET_MODES[(TARGET_MODES.indexOf(d.target) + 1) % TARGET_MODES.length]!;
    c.add(button(this, 122, y + 25, 50, 15, `เป้า: ${TARGET_TH[d.target]}`, () => {
      this.pending.push({ t: 'target', id: d.id, mode: next });
      d.target = next; // show immediately; the sim applies it next tick
      this.openPanel({ kind: 'disciple', id: d.id });
    }, { size: 6 }));

    const cands = this.mergeCandidates(d);
    if (cands.length > 0) {
      cands.slice(0, 3).forEach((o, i) => {
        const cb = findCombo(d.els[0]!, o.els[0]!)!;
        c.add(button(this, 10 + i * 56, y + 44, 54, 20, `ผสาน ${cb.nameTh}`, () => {
          this.pending.push({ t: 'merge', a: d.id, b: o.id }); this.closePanel();
        }, { size: 6, color: 0x3a2a14 }));
      });
    } else if (!d.combo) {
      c.add(text(this, 10, y + 48, d.level < UPGRADE.levels
        ? 'ถึงผู้อาวุโสแล้ว วางติดกับผู้อาวุโสต่างธาตุ เพื่อผสานยุทธ์'
        : 'วางผู้อาวุโสต่างธาตุไว้ติดกันเพื่อผสานยุทธ์', 6, COLORS.mist));
    }
  }

  private mergeCandidates(d: Disciple) {
    if (d.combo || d.level < UPGRADE.levels) return [];
    return this.s.disciples.filter((o) => o !== d && !o.combo && o.level >= UPGRADE.levels
      && Math.abs(o.tx - d.tx) <= 1 && Math.abs(o.ty - d.ty) <= 1 && findCombo(d.els[0]!, o.els[0]!));
  }

  // ---------- rendering ----------

  private syncDisciples() {
    const sig = this.s.disciples.map((d) => `${d.id}:${d.level}:${d.els.join('')}`).join('|');
    if (sig === this.discipleSig) return;
    this.discipleSig = sig;
    this.discipleLayer.removeAll(true);
    for (const d of this.s.disciples) {
      const x = sx(d.x), y = sy(d.y);
      if (d.combo || d.level >= 3) this.discipleLayer.add(this.add.circle(x, y + 6, 6, hex(EL_COLOR[d.els[1] ?? d.els[0]!]), 0.25));
      this.discipleLayer.add(this.add.image(x, y - 1, discipleKey(this, d.els)));
      for (let i = 0; i < (d.combo ? 3 : d.level); i++) this.discipleLayer.add(this.add.rectangle(x - 3 + i * 3, y + 7, 2, 1, 0xe3b04b));
      if (this.mergeCandidates(d).length > 0) {
        const mark = text(this, x + 6, y - 10, '合', 7, COLORS.gold).setOrigin(0.5);
        this.tweens.add({ targets: mark, y: y - 12, yoyo: true, repeat: -1, duration: 500 });
        this.discipleLayer.add(mark);
      }
    }
    if (this.panelSpec) this.openPanel(this.panelSpec);
  }

  private updateHud() {
    this.hud.silver.setText(`ตำลึง ${this.s.silver}`);
    this.hud.lives.setText(`♥ ${this.s.lives}`);
    this.hud.wave.setText(`${this.s.wave}/${this.s.totalWaves}`);
    const label = this.s.phase === 'build' ? 'เริ่มบุก'
      : this.s.phase === 'break' ? `wave ถัดไป +${ECONOMY.earlyCallBonus}` : this.s.phase === 'picking' ? 'เลือกคัมภีร์' : 'กำลังสู้…';
    (this.waveBtn.list[1] as Phaser.GameObjects.Text).setText(label);
    ARTS.forEach((art, i) => {
      const cd = this.s.artCd[i]!;
      const t = this.artBtns[i]?.list[1] as Phaser.GameObjects.Text | undefined;
      t?.setText(cd > 0 ? `${Math.ceil(cd / 20)}` : art.glyph).setColor(cd > 0 ? COLORS.mist : COLORS.gold).setFontSize(cd > 0 ? 6 : 8);
    });
    // Keep an open panel's buttons honest about what is affordable right now.
    if (this.panelSpec && this.s.silver !== this.panelSilver) this.openPanel(this.panelSpec);
    this.updatePreview();
  }

  // Next wave composition, shown while the player is preparing.
  private updatePreview() {
    const show = this.s.phase === 'build' || this.s.phase === 'break';
    this.preview.setVisible(show);
    if (!show || this.previewWaveNo === this.s.wave) return;
    this.previewWaveNo = this.s.wave;
    this.preview.removeAll(true);
    const rows = previewWave(this.s);
    if (rows.length === 0) return;
    const w = 44 + rows.length * 22;
    this.preview.add(this.add.rectangle(W - w - 2, OY + 2, w, 14, COLORS.ink, 0.85).setOrigin(0).setStrokeStyle(1, COLORS.line));
    this.preview.add(text(this, W - w + 2, OY + 4, `wave ${this.s.wave + 1}:`, 6, COLORS.mist));
    rows.forEach(([type, n], i) => {
      const x = W - w + 40 + i * 22;
      this.preview.add(this.add.image(x + 4, OY + 9, enemyKey(this, type)).setScale(0.6));
      this.preview.add(text(this, x + 10, OY + 4, `×${n}`, 6));
    });
  }

  private flashSilver() {
    this.hud.silver.setColor(COLORS.seal);
    this.tweens.add({ targets: this.hud.silver, x: { from: 2, to: 6 }, duration: 50, yoyo: true, repeat: 2,
      onComplete: () => { this.hud.silver.setColor(COLORS.gold).setX(4); } });
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
          this.tutorial?.on('wave', ev.wave);
          break;
        case 'interest':
          if (ev.amount > 0) floatText(this, 30, 22, `ดอกเบี้ย +${ev.amount}`, '#E3B04B', 6);
          break;
        case 'error':
          if (ev.msg === 'not enough silver') this.flashSilver();
          else if (ev.msg === 'art on cooldown') floatText(this, W / 2, H - 30, 'ไม้ตายยังไม่พร้อม', '#9A92AE', 7);
          else if (ev.msg === 'no enemies') floatText(this, W / 2, H - 30, 'ยังไม่มีศัตรูให้ใช้ไม้ตาย', '#9A92AE', 7);
          break;
        case 'art': {
          const art = ARTS.find((a) => a.id === ev.art)!;
          floatText(this, W / 2, 120, art.nameTh, '#E3B04B', 9);
          if (art.type === 'strike') {
            const x = sx(ev.x), y = sy(ev.y);
            const blade = this.add.rectangle(x, y - 60, 4, 30, 0xeef3f8).setDepth(70).setBlendMode(Phaser.BlendModes.ADD);
            this.tweens.add({ targets: blade, y: y - 8, duration: 160, onComplete: () => {
              blade.destroy(); impact(this, 'metal', x, y, true); impact(this, 'earth', x, y, true);
              this.cameras.main.shake(160, 0.008);
            } });
          } else if (art.type === 'slowAll') this.cameras.main.flash(250, 79, 179, 255);
          else if (art.type === 'stunAll') {
            this.cameras.main.shake(200, 0.006);
            const ring = this.add.circle(W / 2, H / 2, 10).setStrokeStyle(2, 0xffffff).setDepth(70);
            this.tweens.add({ targets: ring, scale: 12, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
          } else this.cameras.main.flash(250, 227, 176, 75);
          this.tutorial?.on('art');
          break;
        }
        case 'offer':
          this.showCards(ev.cards);
          break;
        case 'picked':
          this.cardPanel?.destroy(); this.cardPanel = null;
          floatText(this, W / 2, 140, CARDS.find((c) => c.id === ev.card)?.nameTh ?? ev.card, '#E3B04B', 8);
          break;
        case 'newEnemy': {
          const def = ENEMIES[ev.type];
          if (def) banner(this, 60, `ศัตรูใหม่: ${def.nameTh}`, def.traitTh, ['#D2412F', '#D2412F']);
          break;
        }
        case 'end':
          this.ended = true;
          this.tutorial?.destroy();
          this.time.delayedCall(600, () => showResult(this, this.s.stageId, ev.won, ev.stars, 'defend'));
          break;
      }
    }
  }

  private showCards(ids: string[]) {
    this.closePanel();
    this.cardPanel?.destroy();
    const c = this.add.container(0, 0).setDepth(90);
    c.add(this.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0).setInteractive());
    c.add(text(this, W / 2, 70, 'เลือกคัมภีร์ยุทธ์ 1 เล่ม', 10, COLORS.gold).setOrigin(0.5));
    c.add(text(this, W / 2, 84, 'ไม่เลือกภายใน 15 วิ จะได้เล่มแรกอัตโนมัติ', 6, COLORS.mist).setOrigin(0.5));
    ids.forEach((id, i) => {
      const card = CARDS.find((k) => k.id === id)!;
      const y = 96 + i * 46;
      c.add(button(this, 16, y, W - 32, 40, '', () => this.pending.push({ t: 'pick', card: id }), { color: 0x221a2c }));
      c.add(text(this, 26, y + 7, card.nameTh, 9));
      c.add(text(this, 26, y + 22, card.effectTh, 7, COLORS.mist));
    });
    this.cardPanel = c;
  }

  update(_t: number, delta: number) {
    if (!this.ended && !this.paused) {
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
    this.renderEnemies(this.paused ? 1 : Math.min(1, this.acc / TICK_MS));
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
        if (e.elite && !this.seenElites.has(e.elite)) {
          this.seenElites.add(e.elite);
          const a = ELITES.affixes.find((x) => x.id === e.elite)!;
          banner(this, 60, `ศัตรูชั้นยอด: ${a.nameTh}`, `${a.traitTh} · ค่าหัว ×${ELITES.bountyMult}`, [a.outline, a.outline]);
        }
      }
      const [px, py] = this.prev.get(e.id) ?? [e.x, e.y];
      const x = sx(px + (e.x - px) * alpha), y = sy(py + (e.y - py) * alpha);
      const bob = e.air ? -4 : ((e.age >> 2) & 1);
      img.setPosition(Math.round(x), Math.round(y - 2 - bob)).setScale(e.small ? 0.6 : e.type === 'brute' ? 1.15 : 1);
      img.setAlpha(e.type === 'assassin' && !e.revealed ? 0.35 : 1);
      img.setTint(e.stunT > 0 ? 0xbfe6ff : 0xffffff);
      if (e.elite) {
        const a = ELITES.affixes.find((q) => q.id === e.elite)!;
        this.bars.lineStyle(1, hex(a.outline), 0.9).strokeRect(Math.round(x - 7), Math.round(y - 11 - bob), 14, 18);
      }
      const bw = 10, by = Math.round(y - 13 - bob);
      this.bars.fillStyle(0x1a1423).fillRect(Math.round(x - bw / 2), by, bw, 2);
      this.bars.fillStyle(0xd2412f).fillRect(Math.round(x - bw / 2), by, Math.max(0, Math.round((bw * e.hp) / e.maxHp)), 2);
      if (e.burnT > 0) this.bars.fillStyle(0xff5a1f).fillRect(Math.round(x - 1), by - 3, 2, 2);
      for (let i = 0; i < e.poison; i++) this.bars.fillStyle(0x7ce08a).fillRect(Math.round(x - 5 + i * 3), by - 3, 2, 2);
      if (e.slowT > 0) this.bars.fillStyle(0xbfe6ff).fillRect(Math.round(x - 5), Math.round(y + 5), 10, 1);
    }
    for (const [id, img] of this.enemySprites) if (!seen.has(id)) { img.destroy(); this.enemySprites.delete(id); }
  }
}

