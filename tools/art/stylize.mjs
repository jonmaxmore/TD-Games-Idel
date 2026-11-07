// Art direction "B" applied to a sprite after generation (ADR 0009): coloured selective outlines and a dark outer contour,
// every result snapped to effects.json > render.palette. Pure and deterministic; it runs once, on each
// downloaded sprite (npm run art:pixellab).
//   selective outline: a near-black line pixel inside the figure takes a darkened shade of the fill next to it
//   outer contour:     a pixel on the silhouette edge takes the darkest tone of the sprite's dominant hue family, never black

const NEAR_BLACK = 32; // luma at or under this is a black line or a black fill (hair, boots)
const LINE_MAX_DARK = 4; // a line pixel has at most this many dark pixels among its 8 neighbours; a dark fill has more
const SHADE = 0.55; // the outline is the fill at this brightness
const NOT_FAMILIES = new Set(['shared', 'board']); // palette groups that are not a hue family (env-* are skipped too)

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

// The nearest palette colour darker than `under` (luma), by redmean distance.
function snap(c, colors, under) {
  let best = null, bd = Infinity;
  for (const p of colors) {
    if (luma(p.rgb) >= under) continue;
    const rm = (c[0] + p.rgb[0]) / 2, dr = c[0] - p.rgb[0], dg = c[1] - p.rgb[1], db = c[2] - p.rgb[2];
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/**
 * @param {{ width: number, height: number, rgba: Uint8Array }} img  straight RGBA, alpha 0 or 255
 * @param {Record<string, string[]>} palette  effects.json > render.palette
 * @returns {{ width: number, height: number, rgba: Uint8Array }} a new image
 */
export function stylize({ width: w, height: h, rgba }, palette) {
  const colors = [...new Set(Object.values(palette).flat().map((c) => c.toUpperCase()))].filter((c) => c !== '#000000').sort()
    .map((c) => ({ hex: c, rgb: rgb(c) }));
  const families = Object.entries(palette).filter(([k]) => !NOT_FAMILIES.has(k) && !k.startsWith('env-') && k !== 'env');
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : (y * w + x) * 4);
  const opaque = (x, y) => { const i = at(x, y); return i >= 0 && rgba[i + 3] > 0; };
  const colorAt = (i) => hex(rgba[i], rgba[i + 1], rgba[i + 2]);
  const dark = (i) => luma([rgba[i], rgba[i + 1], rgba[i + 2]]) <= NEAR_BLACK;

  // The dominant hue family: the one most opaque pixels belong to (ties go to the earlier family in effects.json).
  const count = new Map();
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]) count.set(colorAt(i), (count.get(colorAt(i)) ?? 0) + 1);
  let contour = '#1A1423', most = 0;
  for (const [, cs] of families) {
    const n = cs.reduce((a, c) => a + (count.get(c.toUpperCase()) ?? 0), 0);
    if (n > most) { most = n; contour = [...cs].sort((a, b) => luma(rgb(a)) - luma(rgb(b)))[0].toUpperCase(); }
  }

  const out = rgba.slice();
  const put = (i, c) => { const [r, g, b] = rgb(c); out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255; };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      if (!rgba[i + 3]) continue;
      if (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1)) { put(i, contour); continue; }
      if (!dark(i)) continue;
      let darkN = 0;
      const fills = new Map();
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = at(x + dx, y + dy);
          if ((!dx && !dy) || j < 0 || !rgba[j + 3]) continue;
          if (dark(j)) darkN++;
          else fills.set(colorAt(j), (fills.get(colorAt(j)) ?? 0) + 1);
        }
      if (darkN > LINE_MAX_DARK || !fills.size) continue;
      const fill = [...fills].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0], f = rgb(fill);
      const shade = snap(f.map((v) => Math.round(v * SHADE)), colors, luma(f));
      if (shade && luma(shade.rgb) > NEAR_BLACK) put(i, shade.hex);
    }
  return { width: w, height: h, rgba: out };
}
