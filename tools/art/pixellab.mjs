// npm run art:pixellab — generates the PixelLab art listed in art/pixellab.json (ADR 0009, docs/tools/blender.md §0).
//   npm run art:pixellab -- --dry-run          every job it would run and its estimated generations; asks only the free
//                                              GET /v2/pro-flash/cost, needs no token, spends nothing
//   npm run art:pixellab -- --only <id>        one asset id (its figure, card, animations)
//   npm run art:pixellab -- --concurrency 2    jobs in flight (the trial plan allows 1)
//   npm run art:pixellab -- --manifest         only rewrite packages/client/public/sprites/manifest.json from the files on disk
//   npm run art:pixellab -- --import <png> <rel>  post-process a local PNG into public/sprites/<rel> (e.g. card/<id>.png)
// Generating needs PIXELLAB_TOKEN. A job whose output is on disk is skipped. Submitted job ids are kept in art/pixellab-jobs.json,
// so a run that stops halfway resumes by polling the same jobs instead of paying again. Every downloaded sprite goes through
// stylize.mjs (coloured outlines, dark outer contour, palette snap) before it is written.
// Never fetches backblaze.pixellab.ai (blocked here); downloads go through api.pixellab.ai: the character and object zips and
// spritesheets, /mcp/images/{job}/download, and the VFX files the job result links.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodePng, encodePng, pngColors, unzip } from './png.mjs';
import { stylize } from './stylize.mjs';

const root = new URL('../../', import.meta.url);
const at = (p) => fileURLToPath(new URL(p, root));
const API = 'https://api.pixellab.ai/v2';
const SPRITES = at('packages/client/public/sprites/');
const VFX = at('art/vfx/');
const JOBS = at('art/pixellab-jobs.json');
const DIRECTIONS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];

export const manifest = () => JSON.parse(readFileSync(at('art/pixellab.json'), 'utf8'));
export const renderPalette = () => JSON.parse(readFileSync(at('docs/data/effects.json'), 'utf8')).render.palette;

// The colours one asset may use: its palette groups plus the shared outline colours, deduplicated, upper case.
export function colorsOf(asset, m = manifest(), pal = renderPalette()) {
  const groups = asset.palette.flatMap((g) => { if (!pal[g]) throw new Error(`${asset.id}: no palette group ${g}`); return pal[g]; });
  return [...new Set([...groups, ...(m.defaults.outline ?? []), ...(asset.colors ?? [])].map((c) => c.toUpperCase()))].sort();
}

// Every job the manifest asks for, in run order: figures and cards, then animations (they need their figure's character id),
// then VFX. done is the file whose presence means the job needs nothing more.
export function plan(m = manifest()) {
  const jobs = [];
  for (const a of m.assets) {
    const done = a.kind === 'card' ? `card/${a.id}.png` : `board/${a.id}/south.png`;
    jobs.push({ key: `${a.kind}:${a.id}`, kind: a.kind, asset: a, size: a.size, dirs: a.kind === 'character' ? 8 : 1, done: SPRITES + done });
  }
  for (const a of m.assets.filter((x) => x.kind === 'character')) {
    const who = a.role === 'enemy' ? 'enemy' : 'disciple';
    for (const an of m.animations[who])
      for (const dir of an.directions)
        jobs.push({ key: `anim:${a.id}:${an.name}:${dir}`, kind: 'animation', asset: a, anim: an, dir, size: a.size, est: an.estPerDirection, done: SPRITES + `board/${a.id}/anim/${an.name}/${dir}/0.png` });
  }
  for (const v of m.vfx) jobs.push({ key: `vfx:${v.id}`, kind: 'vfx', vfx: v, size: m.defaults.vfxSize, est: v.est ?? 1, done: VFX + `${v.id}.png` });
  return jobs;
}

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
async function call(path, { method = 'GET', body, raw = false, auth = true } = {}) {
  for (let tries = 0; ; tries++) {
    const r = await fetch(path.startsWith('http') ? path : API + path, {
      method, headers: { ...(auth ? { Authorization: `Bearer ${token()}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body),
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

// The approved sprite every generation copies its outline and shading from (art direction B), once one exists.
function style(m) {
  const f = m.defaults.styleImage;
  if (!f) return {};
  const png = readFileSync(at(f)), { width, height } = decodePng(png);
  return { style_image: { image: { type: 'base64', base64: png.toString('base64'), format: 'png' }, size: { width, height } }, style_options: { outline: true, shading: true } };
}

function request(j, m) {
  const a = j.asset;
  if (j.kind === 'vfx') return { description: j.vfx.prompt, name: j.vfx.id, artist: 'lite' };
  const target_palette = { name: `Five Sects ${a.palette.join('+')}`, colors: colorsOf(a, m) }, seed = a.seed ?? m.defaults.seed;
  if (j.kind === 'animation') {
    const an = j.anim, base = { animation_name: an.name, directions: [j.dir], seed, target_palette };
    return an.template ? { ...base, mode: 'template', template_animation_id: an.template } : { ...base, mode: an.mode, action_description: an.action, frame_count: an.frames };
  }
  const size = { width: a.size, height: a.size };
  if (j.kind === 'card') return { description: a.prompt, image_size: size, no_background: true, seed, target_palette, ...style(m) };
  return { description: a.prompt, name: a.id, view: m.defaults.view, n_directions: j.dirs, seed, image_size: size, target_palette, ...style(m) };
}

// Post-processes a downloaded sprite and writes it under public/sprites. Size and palette are checked; a miss is a warning.
function save(rel, png, size, m, colors) {
  const img = decodePng(png);
  if (size && (img.width !== size || img.height !== size)) throw new Error(`${rel}: got ${img.width}x${img.height}, wanted ${size}x${size}`);
  const out = encodePng(stylize(img, renderPalette()));
  const { colors: got, partial } = pngColors(out), off = [...got].filter((c) => !colors.has(c));
  if (off.length || partial) console.warn(`  ${rel}: ${off.length} colours outside render.palette (${off.slice(0, 6).join(' ')}), ${partial} half-transparent pixels`);
  mkdirSync(dirname(SPRITES + rel), { recursive: true });
  writeFileSync(SPRITES + rel, out);
  console.log(`  wrote public/sprites/${rel}`);
}
const allColors = () => new Set(Object.values(renderPalette()).flat().map((c) => c.toUpperCase()));

async function generate(j, m, jobs) {
  const a = j.asset, ok = allColors();
  if (!jobs[j.key]) {
    if (j.kind === 'animation' && !jobs[`character:${a.id}`]?.character_id) throw new Error(`${j.key}: generate character:${a.id} first`);
    const body = request(j, m), path = j.kind === 'animation' ? '/characters/animations' : j.kind === 'vfx' ? '/vfx' : '/' + OPS[j.kind][0];
    if (j.kind === 'animation') body.character_id = jobs[`character:${a.id}`].character_id;
    const res = await call(path, { method: 'POST', body });
    jobs[j.key] = { character_id: res.character_id, object_id: res.object_id, job_id: res.background_job_id ?? res.background_job_ids?.[0], estimated: res.estimated_generations ?? res.quoted_generations };
    writeFileSync(JOBS, JSON.stringify(jobs, null, 1) + '\n'); // before polling: a crash now resumes this job instead of paying again
    console.log(`  submitted ${j.key}: ${JSON.stringify(jobs[j.key])}`);
  }
  const r = jobs[j.key];
  if (j.kind === 'character') {
    await until(`/characters/${r.character_id}`, j.key);
    for (const [name, png] of unzip(await call(`/characters/${r.character_id}/zip`, { raw: true }))) {
      const dir = name.match(/rotations\/([a-z-]+)\.png$/)?.[1];
      if (dir && DIRECTIONS.includes(dir) && png) save(`board/${a.id}/${dir}.png`, png, a.size, m, ok);
    }
  } else if (j.kind === 'object') {
    await until(`/objects/${r.object_id}`, j.key);
    const png = [...unzip(await call(`/objects/${r.object_id}/spritesheet`, { raw: true }))].find(([n]) => n.endsWith('.png'))?.[1];
    if (!png) throw new Error(`${j.key}: spritesheet zip has no PNG`);
    save(`board/${a.id}/south.png`, png, a.size, m, ok);
  } else if (j.kind === 'card') {
    await until(`/background-jobs/${r.job_id}`, j.key);
    save(`card/${a.id}.png`, await call(`https://api.pixellab.ai/mcp/images/${r.job_id}/download`, { raw: true }), a.size, m, ok);
  } else if (j.kind === 'animation') {
    await until(`/background-jobs/${r.job_id}`, j.key);
    const files = unzip(await call(`/characters/${jobs[`character:${a.id}`].character_id}/zip`, { raw: true }));
    const meta = JSON.parse(files.get('metadata.json').toString('utf8'));
    for (const st of meta.states) {
      const frames = Object.entries(st.frames.animations ?? {}).find(([k]) => k.toLowerCase().includes(j.anim.name))?.[1]?.[j.dir];
      (Array.isArray(frames) ? frames : Object.values(frames ?? {})).forEach((f, n) => save(`board/${a.id}/anim/${j.anim.name}/${j.dir}/${n}.png`, files.get(f), a.size, m, ok));
    }
  } else {
    const done = await until(`/background-jobs/${r.job_id}`, j.key);
    const files = done.last_response?.files ?? {};
    mkdirSync(VFX, { recursive: true });
    for (const [name, url] of Object.entries(files)) {
      if (!/\.(png|json)$/.test(name) || /backblaze/.test(String(url))) continue;
      writeFileSync(VFX + `${j.vfx.id}${name.slice(name.lastIndexOf('.'))}`, await call(String(url), { raw: true, auth: false }));
    }
    console.log(`  wrote art/vfx/${j.vfx.id}.*`);
  }
  writeSpriteManifest();
}

// The quote for every job not on disk. Figures and cards come from GET /pro-flash/cost (free, no token); animations and VFX
// use the prices PixelLab publishes for them (art/pixellab.json estPerDirection, vfx lite = 1).
async function dryRun(todo, all) {
  const cost = new Map();
  let total = 0;
  const by = {};
  for (const j of todo) {
    let n, note = '';
    if (OPS[j.kind]) {
      const q = `operation=${OPS[j.kind][1]}&width=${j.size}&height=${j.size}&n_directions=${j.dirs}`;
      if (!cost.has(q)) cost.set(q, await call(`/pro-flash/cost?${q}`, { auth: false }));
      const c = cost.get(q);
      n = c.total; note = `${c.image} image + ${c.rotations} rotations${c.provisional ? ', provisional' : ''}`;
    } else { n = j.est; note = j.kind === 'vfx' ? 'lite artist' : `${j.anim.template ? `template ${j.anim.template}` : `${j.anim.mode} ${j.anim.frames} frames`}, published price`; }
    total += n;
    by[j.kind] = (by[j.kind] ?? 0) + n;
    console.log(`  ${j.kind.padEnd(9)} ${String(j.size).padStart(3)}  ${j.key.padEnd(48)} ${n} (${note})`);
  }
  console.log(`skipped (on disk): ${all.length - todo.length}`);
  console.log(`by kind: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`estimated total: ${total} generations for ${todo.length} jobs`);
}

async function main(argv) {
  const flag = (f) => argv.includes(f), arg = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  if (flag('--manifest')) { writeSpriteManifest(); console.log('wrote public/sprites/manifest.json'); return; }
  const m = manifest();
  if (flag('--import')) {
    const [src, rel] = argv.slice(argv.indexOf('--import') + 1);
    save(rel, readFileSync(src), 0, m, allColors());
    writeSpriteManifest();
    return;
  }
  const only = arg('--only'), concurrency = Math.max(1, Number(arg('--concurrency') ?? 1));
  for (const a of m.assets) colorsOf(a, m); // fail on a bad palette group before anything costs money
  const all = plan(m).filter((j) => !only || j.asset?.id === only || j.vfx?.id === only);
  if (only && !all.length) throw new Error(`no asset ${only} in art/pixellab.json`);
  const todo = all.filter((j) => !existsSync(j.done));
  console.log(`${all.length} jobs, ${all.length - todo.length} already on disk, ${todo.length} to generate`);
  if (flag('--dry-run')) return dryRun(todo, all);

  const jobs = existsSync(JOBS) ? JSON.parse(readFileSync(JOBS, 'utf8')) : {};
  const queue = [...todo], failed = [];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let j; (j = queue.shift());) {
      console.log(`${j.key} (${j.size}px)`);
      try { await generate(j, m, jobs); } catch (e) { failed.push(j.key); console.error(`  failed ${j.key}: ${e.message}`); }
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
