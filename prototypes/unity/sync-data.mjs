// Copies the game data (docs/data/*.json) and the Blender-built sprites (packages/client/public/sprites)
// into the Unity project so both engines read the same numbers and art.
// Usage (repo root): npm run unity:sync
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

const copy = (from, to, ext) => {
  const src = new URL(from, import.meta.url), dst = new URL(to, import.meta.url);
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) if (ext.some((e) => f.endsWith(e))) copyFileSync(new URL(f, src), new URL(f, dst));
  console.log('synced', readdirSync(dst).length, 'files to', to);
};
copy('../../docs/data/', './Assets/Resources/data/', ['.json']);
copy('../../packages/client/public/sprites/', './Assets/Resources/sprites/', ['.json', '.png']);
