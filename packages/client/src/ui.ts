import Phaser from 'phaser';

export const W = 180;
export const H = 320;
export const FONT = '"Sarabun", "Noto Sans Thai", "Tahoma", sans-serif';
// Text is drawn at a higher resolution than the 180x320 world so Thai stays readable when scaled up.
export const ZOOM = 4;
export const TEXT_RES = ZOOM;

// Every scene views the 180x320 world through a 4x camera.
export function setupCamera(scene: Phaser.Scene) {
  scene.cameras.main.setZoom(ZOOM).centerOn(W / 2, H / 2);
}

export const COLORS = {
  ink: 0x0e0b14, panel: 0x17121f, line: 0x2a2236, paper: '#ECE3CF', mist: '#9A92AE', gold: '#E3B04B', seal: '#D2412F',
};

export function text(scene: Phaser.Scene, x: number, y: number, str: string, size = 8, color = COLORS.paper) {
  return scene.add.text(x, y, str, { fontFamily: FONT, fontSize: `${size}px`, color }).setResolution(TEXT_RES);
}

export function button(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, label: string,
  onClick: () => void, opts: { color?: number; size?: number; enabled?: boolean } = {},
) {
  const enabled = opts.enabled ?? true;
  const bg = scene.add.rectangle(x, y, w, h, enabled ? opts.color ?? COLORS.panel : 0x221c2a).setOrigin(0).setStrokeStyle(1, COLORS.line);
  const t = text(scene, x + w / 2, y + h / 2, label, opts.size ?? 7, enabled ? COLORS.paper : COLORS.mist).setOrigin(0.5);
  if (enabled) {
    bg.setInteractive({ useHandCursor: true }).on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, ev: Phaser.Types.Input.EventData) => {
      ev?.stopPropagation?.();
      onClick();
    });
  }
  const c = scene.add.container(0, 0, [bg, t]);
  return c;
}
