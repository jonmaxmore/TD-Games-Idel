// npm run art:build [-- asset-id ...] / npm run art:mockups — finds Blender and runs tools/blender/build.py headless.
// Set BLENDER=/path/to/blender if it is not on PATH. Docs: docs/tools/blender.md
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  const win = 'C:\\Program Files\\Blender Foundation';
  if (process.platform === 'win32' && existsSync(win)) {
    const dir = readdirSync(win).filter((d) => d.startsWith('Blender')).sort().pop();
    if (dir) return `${win}\\${dir}\\blender.exe`;
  }
  if (process.platform === 'darwin' && existsSync('/Applications/Blender.app')) return '/Applications/Blender.app/Contents/MacOS/Blender';
  return 'blender';
}

// `--script other.py [args]` runs another Blender script the same way (e.g. tools/art/mockups.py).
const rest = process.argv.slice(2);
const args = rest[0] === '--script'
  ? ['-b', '--factory-startup', '-P', rest[1], '--', ...rest.slice(2)]
  : ['-b', '--factory-startup', '-P', 'tools/blender/build.py', '--', 'art/manifest.json', ...rest];
const r = spawnSync(findBlender(), args, { stdio: 'inherit' });
if (r.error) console.error('Blender not found. Install Blender 4.x or set BLENDER=path/to/blender.', r.error.message);
process.exit(r.status ?? 1);
