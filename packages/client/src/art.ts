// Procedural pixel art (placeholder until real sprites). Same 12x16 template as docs/concept.
import Phaser from 'phaser';
import type { Element } from '@five-sects/sim';

const BODY = [
  '....oooo....', '...ohhhho...', '..ohhhhhho..', '..ohssssho..', '..osesseso..', '..oossssoo..',
  '...occcco...', '..occaacco..', '.occcaaccco.', '.ocdccccdco.', '.ocdccccdco.', '..occaacco..',
  '..occcccco..', '..oddddddo..', '..odo..odo..', '..oo....oo..',
];
const OUT = '#1A1423';
const SKIN = '#F2C9A0';
export const GOLD = '#E3B04B';
export const SEAL = '#D2412F';

export const EL_COLOR: Record<Element, string> = {
  metal: '#D9E1EA', wood: '#5BC46A', water: '#4FB3FF', fire: '#FF5A1F', earth: '#C99A4A', yinyang: '#F2F2F2',
};
export const EL_GLYPH: Record<Element, string> = { metal: '金', wood: '木', water: '水', fire: '火', earth: '土', yinyang: '☯' };

interface Look { robe: string; dark: string; hair: string | null; accent: string; weapon?: string; skin?: string }

const SECT_LOOK: Record<Element, Look> = {
  metal: { robe: '#D9E1EA', dark: '#8C99A8', hair: '#2A2030', accent: '#8C99A8', weapon: 'sword' },
  wood: { robe: '#5BC46A', dark: '#2E7A3C', hair: '#1E3A22', accent: '#2E7A3C', weapon: 'flute' },
  water: { robe: '#4FB3FF', dark: '#22609C', hair: '#DDE8F5', accent: '#22609C', weapon: 'palm' },
  fire: { robe: '#FF5A1F', dark: '#A02A10', hair: '#3A1210', accent: '#A02A10', weapon: 'fan' },
  earth: { robe: '#D98A2B', dark: '#8A4F18', hair: null, accent: GOLD, weapon: 'staff' },
  yinyang: { robe: '#F2F2F2', dark: '#3A3442', hair: '#1A1423', accent: '#1A1423', weapon: 'taiji' },
};

const ENEMY_LOOK: Record<string, Look> = {
  cultist: { robe: '#5A1820', dark: '#2A0A10', hair: '#120A10', accent: SEAL },
  runner: { robe: '#3E5A2A', dark: '#1E2E14', hair: '#120A10', accent: SEAL },
  brute: { robe: '#6E6A78', dark: '#3A3642', hair: '#120A10', accent: SEAL },
  leaper: { robe: '#2E4A3A', dark: '#16261C', hair: '#120A10', accent: '#9BD17A' },
  puppet: { robe: '#3A5A7A', dark: '#1C2E40', hair: '#2A2A30', accent: '#8FB3D0', skin: '#C9D3D8' },
  assassin: { robe: '#1A1A24', dark: '#0A0A10', hair: '#0A0A10', accent: '#5A5266' },
  healer: { robe: '#8A2A1A', dark: '#4A140C', hair: null, accent: GOLD },
  mimic: { robe: '#5A6A8A', dark: '#2E3648', hair: '#1A1423', accent: '#BFD0F0' },
};

function drawFigure(ctx: CanvasRenderingContext2D, look: Look, ox = 0, oy = 0) {
  const skin = look.skin ?? SKIN;
  const pal: Record<string, string> = { o: OUT, h: look.hair ?? skin, s: skin, e: OUT, c: look.robe, d: look.dark, a: look.accent };
  BODY.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = pal[ch];
    if (c) { ctx.fillStyle = c; ctx.fillRect(ox + x, oy + y, 1, 1); }
  }));
  const px = (c: string, pts: [number, number][]) => { ctx.fillStyle = c; pts.forEach(([x, y]) => ctx.fillRect(ox + x, oy + y, 1, 1)); };
  switch (look.weapon) {
    case 'sword': px('#EEF3F8', [[11, 1], [11, 2], [11, 3], [11, 4], [11, 5], [11, 6], [11, 7]]); px(GOLD, [[10, 8], [11, 8], [11, 9]]); break;
    case 'flute': px('#9BD17A', [[0, 8], [1, 8], [2, 8], [3, 8]]); break;
    case 'palm': px(skin, [[0, 8], [0, 9], [11, 8], [11, 9]]); px('#BFE6FF', [[0, 7], [11, 7]]); break;
    case 'fan': px('#FFB347', [[0, 6], [1, 6], [0, 7], [1, 7], [2, 7], [0, 8], [1, 8]]); break;
    case 'staff': for (let y = 1; y < 16; y++) px('#8A5A2B', [[0, y]]); px(GOLD, [[0, 1], [0, 9]]); break;
    case 'taiji': px('#F2F2F2', [[10, 0], [10, 1]]); px('#5A5266', [[11, 0], [11, 1]]); break;
  }
}

function addCanvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h)!;
  draw(tex.getContext());
  tex.refresh();
}

// Disciple texture: base sect look; combos take the second element as sash colour.
export function discipleKey(scene: Phaser.Scene, els: Element[]): string {
  const key = `d-${els.join('-')}`;
  addCanvasTexture(scene, key, 12, 16, (ctx) => {
    const look = { ...SECT_LOOK[els[0]!] };
    if (els[1]) look.accent = EL_COLOR[els[1]];
    drawFigure(ctx, look);
  });
  return key;
}

export function enemyKey(scene: Phaser.Scene, type: string): string {
  const key = `e-${type}`;
  addCanvasTexture(scene, key, 12, 16, (ctx) => drawFigure(ctx, ENEMY_LOOK[type] ?? ENEMY_LOOK.cultist!));
  return key;
}

export function outpostKey(scene: Phaser.Scene): string {
  addCanvasTexture(scene, 'outpost', 14, 16, (ctx) => {
    ctx.fillStyle = OUT; ctx.fillRect(1, 4, 12, 12);
    ctx.fillStyle = '#5A1820'; ctx.fillRect(2, 5, 10, 10);
    ctx.fillStyle = '#2A0A10'; ctx.fillRect(0, 2, 14, 3);
    ctx.fillStyle = SEAL; ctx.fillRect(3, 0, 8, 2); ctx.fillRect(6, 8, 2, 4);
    ctx.fillStyle = GOLD; ctx.fillRect(6, 9, 2, 1);
  });
  return 'outpost';
}

// Ground: grass with speckles, path tiles with pebbles. Deterministic pattern (no randomness).
export function groundKey(scene: Phaser.Scene, key: string, cols: number, rows: number, pathTiles: Set<string>, tile = 16) {
  addCanvasTexture(scene, key, cols * tile, rows * tile, (ctx) => {
    ctx.fillStyle = '#16201A'; ctx.fillRect(0, 0, cols * tile, rows * tile);
    for (let i = 0; i < cols * rows * 3; i++) {
      ctx.fillStyle = i % 3 ? '#1E2B22' : '#24352A';
      ctx.fillRect((i * 53) % (cols * tile), (i * 97) % (rows * tile), 2, 1);
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (pathTiles.has(`${x},${y}`)) {
        ctx.fillStyle = '#3B2C2A'; ctx.fillRect(x * tile, y * tile, tile, tile);
        ctx.fillStyle = '#4A3833';
        ctx.fillRect(x * tile + ((x * 7 + y * 3) % 12) + 2, y * tile + ((x * 5 + y * 11) % 12) + 2, 2, 1);
        ctx.fillRect(x * tile + ((x * 13 + y * 5) % 10) + 3, y * tile + ((x * 3 + y * 7) % 10) + 4, 1, 1);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(x * tile, y * tile, 1, 1);
      }
    }
  });
  return key;
}
