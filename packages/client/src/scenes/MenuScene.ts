import Phaser from 'phaser';
import { STAGES } from '@five-sects/sim';
import { discipleKey } from '../art';
import { loadStars } from '../save';
import { STAGE_TYPE_TH, starString } from '../stars';
import { button, COLORS, text, W, setupCamera } from '../ui';

const MENU_STAGES = ['T-1', '1-1', '1-2', '1-3', '1-4'];

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
    MENU_STAGES.forEach((id, i) => {
      const st = STAGES[id]!;
      const y = 124 + i * 30;
      const label = `${id === 'T-1' ? '' : id + '  '}${STAGE_TYPE_TH[st.type] ?? st.type}`;
      button(this, 16, y, W - 32, 24, '', () => this.scene.start(st.type === 'assault' ? 'assault' : 'defend', { stageId: id }));
      text(this, 24, y + 5, label, 8);
      text(this, W - 24, y + 5, id === 'T-1' ? 'ทุกสำนัก' : starString(stars[id]), 8, COLORS.gold).setOrigin(1, 0);
      text(this, 24, y + 15, (st.title ?? '').slice(0, 40), 5, COLORS.mist);
    });
    text(this, W / 2, 300, 'แตะช่องว่างเพื่อวางศิษย์ · แตะศิษย์เพื่ออัปเกรด/ผสาน', 5, COLORS.mist).setOrigin(0.5);
  }
}
