// Step-by-step hints for the first stage. Each step waits for the player to do the thing it asks.
import Phaser from 'phaser';
import { COLORS, H, text, W } from '../ui';

type Trigger = 'placed' | 'upgraded' | 'wave' | 'art';

interface Step { msg: string; until: Trigger; wave?: number; marker?: [number, number] | 'waveBtn' | 'arts' }

const STEPS: Step[] = [
  { msg: 'แตะช่องหญ้าข้างทาง แล้วเลือกศิษย์กระบี่เพื่อวาง', until: 'placed', marker: [4, 3] },
  { msg: 'เยี่ยม! กด "เริ่มบุก" ด้านล่างเมื่อพร้อม', until: 'wave', wave: 1, marker: 'waveBtn' },
  { msg: 'ศิษย์ยิงเอง ฆ่าศัตรูได้ตำลึง แตะศิษย์เพื่ออัปเกรด หรือวางเพิ่ม', until: 'wave', wave: 2 },
  { msg: 'ศัตรูเยอะเกินไป? กดไม้ตาย 劍 ด้านล่าง', until: 'art', marker: 'arts' },
];

export class Tutorial {
  private i = 0;
  private box: Phaser.GameObjects.Container;

  constructor(private scene: Phaser.Scene, private ox: number, private oy: number, private tile: number) {
    this.box = scene.add.container(0, 0).setDepth(88);
    this.render();
  }

  on(trigger: Trigger, wave?: number) {
    const step = STEPS[this.i];
    if (!step || step.until !== trigger || (step.wave !== undefined && wave !== undefined && wave < step.wave)) return;
    this.i++;
    this.render();
  }

  destroy() { this.box.destroy(); }

  private render() {
    this.box.removeAll(true);
    const step = STEPS[this.i];
    if (!step) return;
    const s = this.scene;
    const y = 36; // top of the field: panels open at the bottom
    this.box.add(s.add.rectangle(10, y, W - 20, 26, 0x2a1d0c, 0.92).setOrigin(0).setStrokeStyle(1, 0xe3b04b));
    this.box.add(text(s, W / 2, y + 13, step.msg, 7, COLORS.paper).setOrigin(0.5).setWordWrapWidth(W - 30).setAlign('center'));
    let mx = 0, my = 0;
    if (Array.isArray(step.marker)) { mx = this.ox + step.marker[0] * this.tile + this.tile / 2; my = this.oy + step.marker[1] * this.tile + this.tile / 2; }
    else if (step.marker === 'waveBtn') { mx = 35; my = H - 8; }
    else if (step.marker === 'arts') { mx = 80; my = H - 8; }
    if (step.marker) {
      const ring = s.add.circle(mx, my, 9).setStrokeStyle(1, 0xe3b04b);
      s.tweens.add({ targets: ring, scale: 1.4, alpha: 0.3, yoyo: true, repeat: -1, duration: 450 });
      this.box.add(ring);
    }
  }
}
