import Phaser from 'phaser';
import { STAGES } from '@five-sects/sim';
import { discipleKey } from '../art';
import { loadStars } from '../save';
import { STAGE_TYPE_TH, starString } from '../stars';
import { STAGE_ORDER } from './result';
import { button, COLORS, text, W, setupCamera } from '../ui';

const MENU_STAGES = ['T-1', '1-1', '1-2', '1-3', '1-4'];
const STAGE_HINT: Record<string, string> = {
  'T-1': 'ลองครบ 6 สำนัก ห้าธาตุ และยุทธ์ผสาน',
  '1-1': 'บทเรียน: วางศิษย์กระบี่ ป้องกันหมู่บ้าน',
  '1-2': 'ศัตรูกระโดดหลังคา · ศิษย์รับเชิญ: ธาราเหมันต์',
  '1-3': 'นำขบวนศิษย์บุกค่ายโจร เลือกเส้นทางเอง',
  '1-4': 'ปลดวัดวัชระศิลา · ศิษย์รับเชิญ: หงส์เพลิง',
};

export class MenuScene extends Phaser.Scene {
  constructor() { super('menu'); }

  create() {
    setupCamera(this);
    const seal = this.add.rectangle(W / 2, 34, 26, 26, 0xd2412f).setAngle(-4);
    text(this, seal.x, seal.y, '五', 16).setOrigin(0.5);
    text(this, W / 2, 62, 'ศึกห้าสำนัก', 18).setOrigin(0.5);
    text(this, W / 2, 80, 'Idle Wuxia Tower Defense · M0', 6, COLORS.mist).setOrigin(0.5);

    (['metal', 'wood', 'water', 'fire', 'earth', 'yinyang'] as const).forEach((el, i) => {
      this.add.image(30 + i * 24, 102, discipleKey(this, [el])).setScale(1);
    });

    const stars = loadStars();
    const nextUp = STAGE_ORDER.find((id) => !stars[id]?.[0]);
    MENU_STAGES.forEach((id, i) => {
      const st = STAGES[id]!;
      const y = 124 + i * 30;
      const label = `${id === 'T-1' ? '' : id + '  '}${STAGE_TYPE_TH[st.type] ?? st.type}`;
      button(this, 16, y, W - 32, 24, '', () => this.scene.start(st.type === 'assault' ? 'assault' : 'defend', { stageId: id }));
      text(this, 24, y + 5, label, 8);
      text(this, W - 24, y + 5, id === 'T-1' ? 'ทุกสำนัก' : starString(stars[id]), 8, COLORS.gold).setOrigin(1, 0);
      if (id === nextUp) {
        const tag = text(this, W - 24, y + 15, 'ด่านถัดไป ▶', 6, COLORS.seal).setOrigin(1, 0);
        this.tweens.add({ targets: tag, alpha: 0.4, yoyo: true, repeat: -1, duration: 600 });
      }
      text(this, 24, y + 15, STAGE_HINT[id] ?? '', 6, COLORS.mist);
    });
    text(this, W / 2, 300, 'แตะช่องว่างเพื่อวางศิษย์ · แตะศิษย์เพื่ออัปเกรด/ผสาน', 6, COLORS.mist).setOrigin(0.5);
  }
}
