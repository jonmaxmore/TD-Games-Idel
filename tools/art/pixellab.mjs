// npm run art:pixellab — generates the PixelLab sprites listed in art/pixellab.json (ADR 0009, docs/tools/blender.md).
//   npm run art:pixellab -- --dry-run         the plan and the estimated generations (GET /pro-flash/cost), nothing generated
//   npm run art:pixellab -- --only <id>       one asset id (its board figure and its card)
//   npm run art:pixellab -- --concurrency 2   jobs in flight (the trial plan allows 1)
//   npm run art:pixellab -- --manifest        only rewrite packages/client/public/sprites/manifest.json from the files on disk
// Needs PIXELLAB_TOKEN. An asset already on disk is skipped. Submitted job ids are kept in art/pixellab-jobs.json, so a run that
// stops halfway resumes by polling the same jobs instead of paying for new ones. Never fetches the rotation_urls PixelLab returns
// (backblaze.pixellab.ai); downloads go through the zip, spritesheet and image endpoints.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodePng, pngColors, unzip } from './png.mjs';

const root = new URL('../../', import.meta.url);
const at = (p) => fileURLToPath(new URL(p, root));
const API = 'https://api.pixellab.ai/v2';
const SPRITES = at('packages/client/public/sprites/');
const JOBS = at('art/pixellab-jobs.json');
const DIRECTIONS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];

export const manifest = () => JSON.parse(readFileSync(at('art/pixellab.json'), 'utf8'));
export const renderPalette = () => JSON.parse(readFileSync(at('docs/data/effects.json'), 'utf8')).render.palette;

// The colours one asset may use: its palette groups plus the shared outline colours, deduplicated, upper case.
export function colorsOf(asset, m = manifest(), pal = renderPalette()) {
  const groups = asset.palette.flatMap((g) => { if (!pal[g]) throw new Error(`${asset.id}: no palette group ${g}`); return pal[g]; });
  return [...new Set([...groups, ...(m.defaults.outline ?? []), ...(asset.colors ?? [])].map((c) => c.toUpperCase()))].sort();
}

// Where an asset lands; the first file is the one whose presence means "done".
export const filesOf = (a) => (a.kind === 'card' ? [`card/${a.id}.png`] : [`board/${a.id}/south.png`]);
const key = (a) => `${a.kind}:${a.id}`;

// What the client loads at startup: board ids with their directions, and card ids. Derived from disk, so it never lists a 404.
export function spriteManifest() {
  const list = (d) => (existsSync(SPRITES + d) ? readdirSync(SPRITES + d, { withFileTypes: true }) : []);
  const board = {};
  for (const e of list('board')) if (e.isDirectory()) {
    const dirs = list(`board/${e.name}`).map((f) => f.name.replace(/\.png$/, '')).filter((d) => DIRECTIONS.includes(d));
    if (dirs.length) board[e.name] = DIRECTIONS.filter((d) => dirs.includes(d));
  }
  const card = list('card').filter((f) => f.name.endsWith('.png')).map((f) => f.name.slice(0, -4)).sort();
  return { board: Object.fromEntries(Object.keys(board).sort().map((k) => [k, board[k]])), card };
}
export const writeSpriteManifest = () => { mkdirSync(SPRITES, { recursive: true }); writeFileSync(SPRITES + 'manifest.json', JSON.stringify(spriteManifest(), null, 1) + '\n'); };

// ---- PixelLab REST ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function token() {
  const t = process.env.PIXELLAB_TOKEN;
  if (!t) { console.error('PIXELLAB_TOKEN is not set. Export your PixelLab API token (pixellab.ai > account > API) and run again.'); process.exit(2); }
  return t;
}
async function call(path, { method = 'GET', body, raw = false } = {}) {
  for (let tries = 0; ; tries++) {
    const r = await fetch(path.startsWith('http') ? path : API + path, {
      method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body),
    });
    if (r.ok) return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
    const text = await r.text();
    // The plan's job limit, or a download that is not ready yet: wait and ask again.
    const busy = r.status === 429 || /at a time|concurren|not ready|processing/i.test(text);
    if (busy && tries < 60) { await sleep(20_000); continue; }
    throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 300)}`);
  }
}
async function until(path, label) {
  for (let i = 0; i < 120; i++) {
    const s = await call(path);
    if (s.status === 'completed') return s;
    if (s.status && !['pending', 'processing', 'queued', 'running'].includes(s.status)) throw new Error(`${label}: ${s.status} ${JSON.stringify(s).slice(0, 300)}`);
    await sleep(10_000);
  }
  throw new Error(`${label}: still not done after 20 minutes`);
}

const OPS = { character: ['create-character-pro-flash', 'character'], object: ['create-object-pro-flash', 'object'], card: ['create-image-pro-flash', 'create'] };
const directionsOf = (a) => (a.kind === 'character' ? 8 : 1);

function request(a, m) {
  const size = { width: a.size, height: a.size }, target_palette = { name: `Five Sects ${a.palette.join('+')}`, colors: colorsOf(a, m) };
  const seed = a.seed ?? m.defaults.seed;
  if (a.kind === 'card') return { description: a.prompt, image_size: size, no_background: true, seed, target_palette };
  return { description: a.prompt, name: a.id, view: m.defaults.view, n_directions: directionsOf(a), seed, image_size: size, target_palette };
}

function save(rel, png, a, m) {
  const { width, height } = decodePng(png);
  if (width !== a.size || height !== a.size) throw new Error(`${key(a)}: got ${width}x${height}, wanted ${a.size}x${a.size}`);
  const allowed = new Set(colorsOf(a, m)), { colors, partial } = pngColors(png);
  const off = [...colors].filter((c) => !allowed.has(c));
  if (off.length || partial) console.warn(`  ${rel}: ${off.length} colours outside its palette (${off.slice(0, 6).join(' ')}), ${partial} half-transparent pixels`);
  mkdirSync(dirname(SPRITES + rel), { recursive: true });
  writeFileSync(SPRITES + rel, png);
  console.log(`  wrote public/sprites/${rel}`);
}

async function generate(a, m, jobs) {
  const k = key(a), [endpoint] = OPS[a.kind];
  if (!jobs[k]) {
    const res = await call('/' + endpoint, { method: 'POST', body: request(a, m) });
    jobs[k] = { character_id: res.character_id, object_id: res.object_id, job_id: res.background_job_id, estimated: res.estimated_generations };
    writeFileSync(JOBS, JSON.stringify(jobs, null, 1) + '\n'); // before polling: a crash now resumes this job instead of paying again
    console.log(`  submitted ${k}: ${JSON.stringify(jobs[k])}`);
  }
  const j = jobs[k];
  if (a.kind === 'character') {
    await until(`/characters/${j.character_id}`, k);
    const files = unzip(await call(`/characters/${j.character_id}/zip`, { raw: true }));
    for (const [name, png] of files) {
      const dir = name.match(/rotations\/([a-z-]+)\.png$/)?.[1];
      if (dir && DIRECTIONS.includes(dir) && png) save(`board/${a.id}/${dir}.png`, png, a, m);
    }
  } else if (a.kind === 'object') {
    await until(`/objects/${j.object_id}`, k);
    const png = [...unzip(await call(`/objects/${j.object_id}/spritesheet`, { raw: true }))].find(([n]) => n.endsWith('.png'))?.[1];
    if (!png) throw new Error(`${k}: spritesheet zip has no PNG`);
    save(`board/${a.id}/south.png`, png, a, m);
  } else {
    await until(`/background-jobs/${j.job_id}`, k);
    save(`card/${a.id}.png`, await call(`https://api.pixellab.ai/mcp/images/${j.job_id}/download`, { raw: true }), a, m);
  }
  writeSpriteManifest();
}

async function main(argv) {
  const flag = (f) => argv.includes(f), arg = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  if (flag('--manifest')) { writeSpriteManifest(); console.log('wrote public/sprites/manifest.json'); return; }
  const m = manifest(), only = arg('--only'), concurrency = Math.max(1, Number(arg('--concurrency') ?? 1));
  const all = m.assets.filter((a) => !only || a.id === only);
  if (only && !all.length) throw new Error(`no asset ${only} in art/pixellab.json`);
  for (const a of all) colorsOf(a, m); // fail on a bad palette group before anything costs money
  const todo = all.filter((a) => !existsSync(SPRITES + filesOf(a)[0]));
  console.log(`${all.length} assets, ${all.length - todo.length} already on disk, ${todo.length} to generate`);

  if (flag('--dry-run')) {
    const cost = new Map();
    let total = 0;
    for (const a of todo) {
      const q = `operation=${OPS[a.kind][1]}&width=${a.size}&height=${a.size}&n_directions=${directionsOf(a)}`;
      if (!cost.has(q)) cost.set(q, await call(`/pro-flash/cost?${q}`));
      const c = cost.get(q);
      total += c.total;
      console.log(`  ${a.kind.padEnd(9)} ${String(a.size).padStart(3)}  ${a.id.padEnd(26)} ${c.total} generations (${c.image} image + ${c.rotations} rotations)${c.provisional ? ', provisional' : ''}`);
    }
    for (const a of all.filter((x) => !todo.includes(x))) console.log(`  skip      ${String(a.size).padStart(3)}  ${a.id.padEnd(26)} on disk: ${filesOf(a)[0]}`);
    console.log(`estimated total: ${total} generations for ${todo.length} assets`);
    return;
  }

  const jobs = existsSync(JOBS) ? JSON.parse(readFileSync(JOBS, 'utf8')) : {};
  const queue = [...todo], failed = [];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let a; (a = queue.shift());) {
      console.log(`${key(a)} (${a.size}px)`);
      try { await generate(a, m, jobs); } catch (e) { failed.push(key(a)); console.error(`  failed ${key(a)}: ${e.message}`); }
    }
  }));
  writeSpriteManifest();
  if (failed.length) { console.error(`failed: ${failed.join(', ')}`); process.exit(1); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set at start (Node >= 22.21), so behind a proxy run again with it.
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY)
    process.exit(spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } }).status ?? 1);
  await main(process.argv.slice(2));
}
