// PixelLab sprites (ADR 0009): 96x96 board figures drawn 1:1 on the board canvas, 128x128 card art in the HUD and lobby.
// public/sprites/manifest.json (written by npm run art:pixellab) lists what exists, so nothing is probed and nothing 404s.
// Anything without a sprite keeps its procedural drawing.

const BASE = `${import.meta.env.BASE_URL}sprites/`;

// One board frame and its opaque bounds in image pixels: the feet sit on the ground point, overlays sit on the head.
export interface Frame { img: HTMLImageElement; w: number; h: number; left: number; right: number; top: number; foot: number }
interface Manifest { board: Record<string, string[]>; card: string[] }

const board = new Map<string, Map<string, Frame>>();
const cards = new Set<string>();
const tints = new Map<string, HTMLCanvasElement>();

function bounds(img: HTMLImageElement): Frame {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const a = g.getImageData(0, 0, c.width, c.height).data;
  let left = c.width, right = -1, top = c.height, foot = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (a[(y * c.width + x) * 4 + 3]) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); foot = Math.max(foot, y); }
  return { img, w: c.width, h: c.height, left, right, top, foot };
}

// Loads every listed sprite once. A missing manifest or a broken image only means fewer sprites.
export async function loadSprites(): Promise<void> {
  let m: Manifest;
  try { m = await (await fetch(`${BASE}manifest.json`)).json() as Manifest; } catch { return; }
  for (const id of m.card ?? []) cards.add(id);
  await Promise.all(Object.entries(m.board ?? {}).flatMap(([id, dirs]) => dirs.map(async (dir) => {
    const img = new Image();
    img.src = `${BASE}board/${id}/${dir}.png`;
    try { await img.decode(); } catch { return; }
    if (!board.has(id)) board.set(id, new Map());
    board.get(id)!.set(dir, bounds(img));
  })));
}

// The frame for an id facing dir; west falls back to east mirrored, anything else to south.
export function boardSprite(id: string, dir = 'south'): { f: Frame; flip: boolean } | null {
  const fs = board.get(id);
  if (!fs) return null;
  const f = fs.get(dir);
  if (f) return { f, flip: false };
  if (dir === 'west' && fs.has('east')) return { f: fs.get('east')!, flip: true };
  const s = fs.get('south') ?? fs.values().next().value;
  return s ? { f: s, flip: false } : null;
}

// The frame's silhouette in one colour (hit flash, status tint, sealed grey), made once per frame and colour.
export function silhouette(f: Frame, color: string): HTMLCanvasElement {
  const k = `${f.img.src}|${color}`;
  let c = tints.get(k);
  if (!c) {
    c = document.createElement('canvas');
    c.width = f.w; c.height = f.h;
    const g = c.getContext('2d')!;
    g.drawImage(f.img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color; g.fillRect(0, 0, f.w, f.h);
    tints.set(k, c);
  }
  return c;
}

// The 128x128 card art for a unit, shown pixel-crisp at 1x (style.css .art); null when there is none yet.
export function cardArt(id: string): HTMLImageElement | null {
  if (!cards.has(id)) return null;
  const img = new Image(128, 128);
  img.className = 'art';
  img.alt = '';
  img.src = `${BASE}card/${id}.png`;
  return img;
}
