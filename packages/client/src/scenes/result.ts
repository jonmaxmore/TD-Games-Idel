import Phaser from 'phaser';
import { STAGES } from '@five-sects/sim';
import { saveStars } from '../save';
import { STAR_LABEL } from '../stars';
import { button, COLORS, H, text, W } from '../ui';

export const STAGE_ORDER = ['1-1', '1-2', '1-3', '1-4'];

export function showResult(scene: Phaser.Scene, stageId: string, won: boolean, stars: boolean[], retryScene: string) {
  saveStars(stageId, stars);
  const keys = STAGES[stageId]?.stars ?? [];
  const c = scene.add.container(0, 0).setDepth(100);
  c.add(scene.add.rectangle(0, 0, W, H, 0x000000, 0.6).setOrigin(0).setInteractive());
  c.add(scene.add.rectangle(14, 90, W - 28, 140, COLORS.panel).setOrigin(0).setStrokeStyle(1, won ? 0xe3b04b : 0xd2412f));
  c.add(text(scene, W / 2, 104, won ? 'ชนะ' : 'พ่ายแพ้', 14, won ? COLORS.gold : COLORS.seal).setOrigin(0.5));
  keys.forEach((k, i) => {
    const y = 126 + i * 16;
    c.add(text(scene, 26, y, stars[i] ? '★' : '☆', 10, COLORS.gold));
    c.add(text(scene, 42, y + 2, STAR_LABEL[k] ?? k, 7, stars[i] ? COLORS.paper : COLORS.mist));
  });
  const next = STAGE_ORDER[STAGE_ORDER.indexOf(stageId) + 1];
  const nextType = next ? STAGES[next]?.type : undefined;
  if (won && next) {
    c.add(button(scene, 24, 184, W - 48, 18, `ด่านถัดไป ${next}`, () => scene.scene.start(nextType === 'assault' ? 'assault' : 'defend', { stageId: next }), { color: 0x3a2a14 }));
  }
  c.add(button(scene, 24, 206, 62, 18, won ? 'เล่นอีกครั้ง' : 'ลองใหม่', () => scene.scene.start(retryScene, { stageId })));
  c.add(button(scene, W - 86, 206, 62, 18, 'เมนู', () => scene.scene.start('menu')));
  if (!won) c.add(text(scene, W / 2, 186, 'ลองเปลี่ยนตำแหน่ง ใช้ไม้ตาย หรือเลือกเป้าหมายใหม่', 6, COLORS.mist).setOrigin(0.5));
}
