import { describe, expect, it } from 'vitest';
import { battleCardIds, battleUnits } from '@five-sects/sim';

// figure() draws into a FIG_W x FIG_H canvas and adds a 1 px rim around the silhouette, so every pixel a figure paints
// (mount, weapon, streak) must stay 1 px inside the canvas or it is clipped on the board.
describe('code-drawn figures', () => {
  it('stay inside the figure canvas with room for the rim', async () => {
    // board.ts makes a scratch canvas on load; the figures under test draw through the fake context below
    (globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => ({}) }) };
    const { drawFigure, FIG_H, FIG_W } = await import('../src/board');
    const out: string[] = [];
    for (const id of battleCardIds)
      for (const b of [0, 1]) {
        const g = { fillStyle: '', fillRect: (x: number, y: number, w: number, h: number) => {
          if (x < 1 || y < 1 || x + w > FIG_W - 1 || y + h > FIG_H - 1) out.push(`${id} b${b}: ${x},${y} ${w}x${h}`);
        } };
        drawFigure(g as unknown as CanvasRenderingContext2D, battleUnits.get(id)!, 0, b);
      }
    expect(out).toEqual([]);
  });
});
