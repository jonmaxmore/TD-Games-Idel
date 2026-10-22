// Procedural pixel art (placeholder until real sprites). Same 12x16 template as docs/concept.
import Phaser from 'phaser';
import { BIOMES, type Element, type Layout } from '@five-sects/sim';
import effectsJson from '../../../docs/data/effects.json';

const PALETTE = effectsJson.render.palette as Record<string, string[]>;

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
// pal: biome ground colours (effects.json render.palette env-*): base, 2 speckle shades, path, pebble.
export function groundKey(scene: Phaser.Scene, key: string, cols: number, rows: number, pathTiles: Set<string>, tile = 16, pal = PALETTE.env!) {
  addCanvasTexture(scene, key, cols * tile, rows * tile, (ctx) => {
    ctx.fillStyle = pal[0]!; ctx.fillRect(0, 0, cols * tile, rows * tile);
    for (let i = 0; i < cols * rows * 3; i++) {
      ctx.fillStyle = i % 3 ? pal[1]! : pal[2]!;
      ctx.fillRect((i * 53) % (cols * tile), (i * 97) % (rows * tile), 2, 1);
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (pathTiles.has(`${x},${y}`)) {
        ctx.fillStyle = pal[3]!; ctx.fillRect(x * tile, y * tile, tile, tile);
        ctx.fillStyle = pal[4]!;
        if (!pathTiles.has(`${x},${y - 1}`)) ctx.fillRect(x * tile, y * tile, tile, 1); // worn rim where the trail meets grass
        ctx.fillRect(x * tile + ((x * 7 + y * 3) % 12) + 2, y * tile + ((x * 5 + y * 11) % 12) + 2, 2, 1);
        ctx.fillRect(x * tile + ((x * 13 + y * 5) % 10) + 3, y * tile + ((x * 3 + y * 7) % 10) + 4, 1, 1);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(x * tile, y * tile, 1, 1);
      }
    }
  });
  return key;
}

// ---------- map props and gates (placeholders until the tileset from docs/art arrives; same shapes as the Unity Art.cs) ----------

type Draw = { rect: (x: number, y: number, w: number, h: number, c: string) => void; disc: (cx: number, cy: number, r: number, c: string) => void };
function shapes(ctx: CanvasRenderingContext2D): Draw {
  const rect = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const disc = (cx: number, cy: number, r: number, c: string) => {
    ctx.fillStyle = c;
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + r) ctx.fillRect(cx + i, cy + j, 1, 1);
  };
  return { rect, disc };
}

const PROPS: Record<string, (d: Draw) => void> = {
  house: ({ rect }) => {
    rect(2, 9, 12, 9, '#C9A27A'); rect(2, 17, 12, 1, '#7A5A3A'); rect(4, 11, 2, 2, '#FFE08A'); rect(10, 11, 2, 2, '#FFE08A'); rect(7, 13, 2, 5, '#4A2E1E');
    for (let i = 0; i < 6; i++) rect(1 + i, 8 - i, 14 - 2 * i, 1, i === 0 ? OUT : '#5A1E28');
  },
  tree: ({ rect, disc }) => { rect(7, 13, 2, 6, '#4A2E1E'); disc(8, 9, 6, '#173F1D'); disc(7, 8, 4, '#225F2B'); disc(6, 6, 2, '#2F833B'); },
  shrine: ({ rect }) => { rect(3, 8, 2, 11, SEAL); rect(11, 8, 2, 11, SEAL); rect(1, 6, 14, 2, OUT); rect(2, 5, 12, 1, GOLD); rect(6, 10, 4, 3, GOLD); },
  rock: ({ rect, disc }) => { disc(8, 15, 5, '#4A4048'); disc(7, 14, 3, '#6E6A78'); rect(6, 12, 1, 1, '#9A92AE'); },
  bamboo: ({ rect }) => {
    for (const x of [4, 8, 12]) { rect(x, 2 + (x % 3), 2, 17 - (x % 3), '#4E8A5A'); for (let y = 6; y < 19; y += 5) rect(x, y, 2, 1, '#2A5A3E'); rect(x + 2, 3 + (x % 4), 2, 1, '#9FC7B4'); }
  },
  ice: ({ rect, disc }) => { disc(8, 14, 5, '#8EC3E8'); rect(6, 7, 4, 8, '#C9E6F7'); rect(7, 8, 1, 2, '#FFFFFF'); },
  stall: ({ rect }) => { rect(2, 12, 12, 7, '#7A2A1E'); rect(3, 13, 10, 2, '#F2A23A'); for (let i = 0; i < 12; i++) rect(2 + i, 8, 1, 3, i % 2 ? '#ECE3CF' : SEAL); },
  ruin: ({ rect }) => { rect(3, 9, 3, 10, '#4A4048'); rect(10, 12, 3, 7, '#4A4048'); rect(3, 8, 4, 1, '#6E6A78'); rect(8, 17, 5, 2, '#3A1622'); },
  lantern: ({ rect, disc }) => { rect(7, 12, 1, 7, '#4A2E1E'); disc(8, 10, 3, SEAL); rect(7, 9, 2, 2, '#FFE08A'); },
  roof: ({ rect }) => { for (let y = 6; y < 19; y += 3) rect(0, y, 16, 2, y % 2 ? '#7A2A2A' : '#5A1E28'); rect(0, 5, 16, 1, OUT); },
  rice: ({ rect }) => { for (let y = 9; y < 19; y += 3) for (let x = 1; x < 16; x += 3) { rect(x, y, 1, 1, '#5BC46A'); rect(x, y - 1, 1, 1, '#9FDCA7'); } },
  flag: ({ rect }) => { rect(4, 4, 1, 15, '#4A2E1E'); rect(5, 4, 7, 5, SEAL); rect(8, 6, 1, 1, GOLD); },
};

// 16x20 sprite standing on its tile (draw with origin (0.5, 1) at the tile's bottom centre).
export function propKey(scene: Phaser.Scene, type: string): string {
  const key = `prop-${type}`;
  addCanvasTexture(scene, key, 16, 20, (ctx) => (PROPS[type] ?? PROPS.rock!)(shapes(ctx)));
  return key;
}

// Spawn gate = dark opening on the board edge; goal gate = the sect's arch the enemies must not pass. 24x26, origin (0.5, 1).
export function gateKey(scene: Phaser.Scene, type: string, goal: boolean): string {
  const key = `gate-${type}-${goal}`;
  addCanvasTexture(scene, key, 24, 26, (ctx) => {
    const { rect, disc } = shapes(ctx);
    if (goal) {
      const pillar = type === 'jade-gate' ? '#7FE0D0' : type === 'bandit-camp' ? '#5A3A24' : SEAL;
      rect(3, 8, 3, 18, pillar); rect(18, 8, 3, 18, pillar);
      rect(0, 4, 24, 3, OUT); rect(1, 3, 22, 1, GOLD); rect(2, 9, 20, 2, OUT); rect(8, 5, 8, 3, GOLD); rect(10, 6, 4, 1, OUT);
      if (type === 'bandit-camp') for (let x = 7; x < 18; x += 2) rect(x, 14, 1, 12, '#5A3A24');
    } else {
      const portal = type === 'demon-portal';
      disc(12, 16, 10, portal ? '#5A1E28' : '#4A4048'); disc(12, 18, 7, portal ? SEAL : '#120A10'); disc(12, 19, 5, portal ? '#24101A' : '#0A0610');
      rect(0, 24, 24, 2, portal ? '#3A1622' : '#3A3442');
    }
  });
  return key;
}

export const biomePalette = (layout: Layout) => PALETTE[BIOMES[layout.biome]?.palette ?? 'env'] ?? PALETTE.env!;

// Props and both gates for a layout; returns the goal gate so scenes can flash it on a leak.
export function drawMap(scene: Phaser.Scene, layout: Layout, ox: number, oy: number, t: number, spawn: [number, number], goal: [number, number]) {
  const biome = BIOMES[layout.biome]!;
  for (const p of layout.props) {
    const flat = p.type === 'roof' || p.type === 'rice';
    scene.add.image(ox + p.at[0] * t + t / 2, oy + (p.at[1] + 1) * t, propKey(scene, p.type)).setOrigin(0.5, 1).setDepth(flat ? 1 : 5 + p.at[1] * 0.01);
  }
  scene.add.image(ox + spawn[0] * t + t / 2, oy + (spawn[1] + 1) * t + 2, gateKey(scene, biome.spawnGate, false)).setOrigin(0.5, 1).setDepth(2);
  return scene.add.image(ox + goal[0] * t + t / 2, oy + (goal[1] + 1) * t + 2, gateKey(scene, layout.goalGate ?? biome.goalGate, true)).setOrigin(0.5, 1).setDepth(25);
}
