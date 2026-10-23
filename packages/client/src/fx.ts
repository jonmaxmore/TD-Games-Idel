// Per-sect projectile and impact effects (docs/data/effects.json, simplified for M0).
import Phaser from 'phaser';
import type { Element } from '@five-sects/sim';
import { EL_COLOR } from './art';
import { FONT, TEXT_RES } from './ui';

const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;
const MAX_LIVE = 400;
let live = 0;

function track(obj: Phaser.GameObjects.GameObject) {
  live++;
  obj.once('destroy', () => live--);
}

export function projectile(scene: Phaser.Scene, el: Element, fx: number, fy: number, tx: number, ty: number, onHit: () => void) {
  if (live > MAX_LIVE) { onHit(); return; }
  const c = hex(EL_COLOR[el]);
  const size = el === 'earth' ? 4 : el === 'metal' ? 3 : 2;
  const p = scene.add.rectangle(fx, fy, size, el === 'metal' ? 1 : size, c).setBlendMode(Phaser.BlendModes.ADD);
  const glow = scene.add.rectangle(fx, fy, size + 3, size + 3, c, 0.25).setBlendMode(Phaser.BlendModes.ADD);
  track(p); track(glow);
  p.rotation = Math.atan2(ty - fy, tx - fx);
  const dur = el === 'metal' ? 90 : el === 'water' || el === 'earth' ? 160 : 120;
  scene.tweens.add({ targets: [p, glow], x: tx, y: ty, duration: dur, onComplete: () => { p.destroy(); glow.destroy(); onHit(); } });
}

export function impact(scene: Phaser.Scene, el: Element, x: number, y: number, big = false) {
  if (live > MAX_LIVE) return;
  const base = hex(EL_COLOR[el]);
  const n = big ? 12 : el === 'fire' ? 8 : 5;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + (el === 'fire' ? -Math.PI / 2 : 0);
    const sp = el === 'fire' ? 6 + (i % 3) * 3 : 5 + (i % 2) * 4;
    const col = el === 'fire' && i % 2 ? 0xffd34a : el === 'water' && i % 3 === 0 ? 0xe8f6ff : base;
    const r = scene.add.rectangle(x, y, el === 'earth' ? 2 : 1, el === 'earth' ? 2 : 1, col).setBlendMode(Phaser.BlendModes.ADD);
    track(r);
    const dy = el === 'fire' ? -sp - 4 : Math.sin(ang) * sp;
    scene.tweens.add({ targets: r, x: x + Math.cos(ang) * sp, y: y + dy, alpha: 0, duration: 260 + (i % 3) * 60, onComplete: () => r.destroy() });
  }
  if (el === 'yinyang') {
    const ring = scene.add.circle(x, y, 3).setStrokeStyle(1, 0xffffff);
    track(ring);
    scene.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 300, onComplete: () => ring.destroy() });
  }
}

export function floatText(scene: Phaser.Scene, x: number, y: number, str: string, color: string, size = 6) {
  if (live > MAX_LIVE) return;
  const t = scene.add.text(x, y, str, { fontFamily: FONT, fontSize: `${size}px`, color, stroke: '#1A1423', strokeThickness: 2 })
    .setResolution(TEXT_RES).setOrigin(0.5).setDepth(50);
  track(t);
  scene.tweens.add({ targets: t, y: y - 10, alpha: 0, duration: 650, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
}

export function banner(scene: Phaser.Scene, y: number, title: string, sub: string, colors: [string, string]) {
  const g = scene.add.container(0, 0).setDepth(80);
  const bg = scene.add.rectangle(0, y, 180, 30, 0x0a0810, 0.85).setOrigin(0, 0.5);
  const l1 = scene.add.rectangle(0, y - 15, 180, 1, hex(colors[0]));
  const l2 = scene.add.rectangle(0, y + 15, 180, 1, hex(colors[1]));
  const t1 = scene.add.text(90, y - 5, title, { fontFamily: FONT, fontSize: '12px', color: '#ECE3CF' }).setResolution(TEXT_RES).setOrigin(0.5);
  const t2 = scene.add.text(90, y + 8, sub, { fontFamily: FONT, fontSize: '7px', color: '#E3B04B' }).setResolution(TEXT_RES).setOrigin(0.5);
  l1.setOrigin(0, 0.5); l2.setOrigin(0, 0.5);
  g.add([bg, l1, l2, t1, t2]);
  g.setAlpha(0);
  scene.tweens.add({ targets: g, alpha: 1, duration: 120, yoyo: true, hold: 1100, onComplete: () => g.destroy() });
  const flash = scene.add.rectangle(0, 0, 180, 320, 0xffffff, 0.5).setOrigin(0).setDepth(79);
  scene.tweens.add({ targets: flash, alpha: 0, duration: 200, onComplete: () => flash.destroy() });
}
