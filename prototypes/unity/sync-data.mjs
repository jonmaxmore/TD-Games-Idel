// Copies the game data (docs/data/*.json) into the Unity project so both engines read the same numbers.
// Usage (repo root): npm run unity:sync
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

const src = new URL('../../docs/data/', import.meta.url);
const dst = new URL('./Assets/Resources/data/', import.meta.url);
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) if (f.endsWith('.json')) copyFileSync(new URL(f, src), new URL(f, dst));
console.log('synced', readdirSync(dst).length, 'files');
