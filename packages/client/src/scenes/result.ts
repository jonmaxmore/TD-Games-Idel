import Phaser from 'phaser';
import { STAGES } from '@five-sects/sim';
import { saveStars } from '../save';
import { STAR_LABEL } from '../stars';
import { button, COLORS, H, text, W } from '../ui';

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
  c.add(button(scene, 24, 196, 60, 20, 'เล่นอีกครั้ง', () => scene.scene.start(retryScene, { stageId })));
  c.add(button(scene, W - 84, 196, 60, 20, 'เมนู', () => scene.scene.start('menu')));
}
