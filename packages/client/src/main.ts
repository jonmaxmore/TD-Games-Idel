import Phaser from 'phaser';
import { AssaultScene } from './scenes/AssaultScene';
import { DefendScene } from './scenes/DefendScene';
import { MenuScene } from './scenes/MenuScene';
import { H, W, ZOOM } from './ui';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  // World is 180x320; the canvas is 4x so text can render sharper than the pixel art.
  width: W * ZOOM,
  height: H * ZOOM,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#0b0910',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [MenuScene, DefendScene, AssaultScene],
});

// Handle for the smoke test and debugging in devtools.
(window as unknown as { __game: Phaser.Game }).__game = game;
