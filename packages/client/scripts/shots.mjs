// Visual proof: opens the game in Chromium at 1280x720 (16:9 PC), plays it, and saves screenshots + a video to shots/.
//   npm run shots    title and deck screens; a match played by hand (aim, a red marker off the zone, a click summon, a drag
//                    summon, the bell cut-in); then a bot-vs-bot match at x4, recorded, with frames of an early field, a fight,
//                    a fort capture and the result screen.
// Exits non-zero on any console error or page crash.
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../../../shots/', import.meta.url));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const server = await createServer({ root, server: { port: 5199 }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0]; // the port vite really got, in case 5199 is taken
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(url, name, videoDir) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } } } : {}) });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await p.goto(base + url);
  return { ctx, p };
}
const shot = (p, name) => p.screenshot({ path: out + `${name}.png` });

// 1) Front screens: title, then the deck pick with each deck shown.
{
  const { ctx, p } = await open('', 'front');
  await p.waitForSelector('.title');
  await sleep(300);
  await shot(p, '01-title');
  await p.getByRole('button', { name: 'เริ่มศึก' }).click();
  await p.waitForSelector('.deck-card');
  await sleep(200);
  await shot(p, '02-deck-fire');
  await p.locator('.deck-row', { hasText: 'สำรับผสม' }).click();
  await sleep(200);
  await shot(p, '03-deck-mixed');
  for (const sect of ['metal', 'water', 'earth']) {
    await p.locator(`.deck-row[data-id=${sect}]`).click();
    await sleep(150);
    await shot(p, `03-deck-${sect}`);
  }
  await p.getByRole('button', { name: 'เข้าสู่ศึก' }).click();
  await p.waitForFunction(() => window.__game?.s);
  await sleep(600);
  await shot(p, '04-match-from-deck');
  await ctx.close();
}

// 2) A match by hand (fire deck vs the AI): aim inside the zone, aim past it (red), summon by click, by drag, ring the bell.
{
  const { ctx, p } = await open('?mode=battle&seed=3&deck=fire', 'hand');
  await p.waitForFunction(() => window.__game?.s);
  await sleep(1500);
  await shot(p, '10-early');
  const at = (d) => p.evaluate((d) => window.__pathClient(d), d);
  await p.keyboard.press('1'); // the banner (1 mana)
  const zone = 4000;
  let pt = await at(zone - 1500);
  await p.mouse.move(pt.x, pt.y);
  await sleep(250);
  await shot(p, '11-aim-ok');
  pt = await at(12000);
  await p.mouse.move(pt.x, pt.y);
  await sleep(250);
  await shot(p, '12-aim-outside');
  await p.mouse.click(pt.x, pt.y); // refused: a toast, the card stays picked
  await sleep(200);
  await shot(p, '13-refused');
  pt = await at(zone - 1000);
  await p.mouse.click(pt.x, pt.y);
  await p.waitForFunction(() => window.__game.s.units.some((u) => u.side === 0));
  await sleep(600);
  await shot(p, '14-summoned');
  // Drag the blade card (2 mana) onto the road.
  await p.waitForFunction(() => window.__game.s.mana[0] >= 2, null, { timeout: 20000 });
  const card = await p.locator('.card').nth(1).boundingBox();
  await p.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await p.mouse.down();
  pt = await at(zone - 2500);
  await p.mouse.move((card.x + pt.x) / 2, (card.y + pt.y) / 2, { steps: 4 });
  await p.mouse.move(pt.x, pt.y, { steps: 4 });
  await sleep(150);
  await shot(p, '15-drag');
  await p.mouse.up();
  await p.waitForFunction(() => window.__game.s.units.filter((u) => u.side === 0).length >= 2, null, { timeout: 5000 });
  await sleep(300);
  await p.waitForFunction(() => window.__game.s.units.some((u) => u.side === 1), null, { timeout: 30000 });
  await sleep(4000);
  await p.keyboard.press('Space');
  await sleep(140);
  await shot(p, '16-bell-cutin');
  await sleep(400);
  await shot(p, '17-bell-after');
  // Under siege: an enemy stands on our castle, yet the gate stays tinted and a click there summons.
  await p.evaluate(() => { for (const u of window.__game.s.units) if (u.side === 1) u.d = 600; });
  await p.waitForFunction(() => window.__game.s.mana[0] >= 1, null, { timeout: 20000 });
  await p.keyboard.press('1');
  pt = await at(1200);
  await p.mouse.move(pt.x, pt.y);
  await sleep(250);
  await shot(p, '18-gate-under-siege');
  const before = await p.evaluate(() => window.__game.s.units.filter((u) => u.side === 0).length);
  await p.mouse.click(pt.x, pt.y);
  await p.waitForFunction((n) => window.__game.s.units.filter((u) => u.side === 0).length > n, before, { timeout: 5000 });
  await sleep(300);
  await shot(p, '19-gate-summoned');
  await ctx.close();
}

// 3) Bot vs bot at x4, recorded: an early field, a fight, a fort capture, then the result; fps sampled throughout.
{
  const dir = out + 'bot-video/';
  const { ctx, p } = await open('?mode=battle&bot=1&speed=4&seed=2&deck=mixed', 'bots', dir);
  await p.waitForFunction(() => window.__game?.s);
  const fps = [];
  const sample = async () => { fps.push(await p.evaluate(() => window.__game.fps)); };
  await p.waitForFunction(() => window.__game.s.tick > 200, null, { timeout: 30000 });
  await shot(p, '20-bots-early');
  await p.waitForFunction(() => window.__game.s.forts.some((f) => f.owner !== null), null, { timeout: 90000, polling: 'raf' });
  await sleep(60);
  await shot(p, '21-fort-capture');
  await sample();
  await p.waitForFunction(() => window.__game.fights >= 12, null, { timeout: 90000, polling: 'raf' });
  await shot(p, '22-fight');
  for (let i = 0; i < 6; i++) {
    await sleep(3000);
    await sample();
    await shot(p, `23-mid-${i}`);
    if (await p.evaluate(() => window.__game.s.winner !== null)) break;
  }
  await p.waitForSelector('.modal.result', { timeout: 90000 });
  await sleep(400);
  await shot(p, '29-result');
  const end = await p.evaluate(() => ({ winner: window.__game.s.winner, tick: window.__game.s.tick, castles: window.__game.s.castles.map((c) => c.hp) }));
  console.log('bot match:', JSON.stringify(end), 'fps samples:', fps.join(','));
  await ctx.close();
  const vid = readdirSync(dir).find((f) => f.endsWith('.webm'));
  if (vid) renameSync(dir + vid, out + 'bot-match.webm');
  rmSync(dir, { recursive: true, force: true });
}

// 3b) Sect decks bot vs bot at x4: the first large unit and the first flier on the field.
for (const [deck, seed] of [['fire', 5], ['earth', 7]]) {
  const { ctx, p } = await open(`?mode=battle&bot=1&speed=4&seed=${seed}&deck=${deck}`, `sect-${deck}`);
  await p.waitForFunction(() => window.__game?.s, null, { timeout: 30000 });
  await p.waitForFunction(() => window.__game.s.units.some((u) => /_(beast|warden|elder|naga|guardian)$/.test(u.card)), null, { timeout: 120000, polling: 'raf' });
  await sleep(500);
  await shot(p, `24-large-${deck}`);
  await sleep(1500);
  await shot(p, `25-large-${deck}-fight`);
  await ctx.close();
}

// 4) Frame rate at x4 without the video recorder, sampled once a second: a busy bot match (seed 12 peaks at 13 units), then a
//    stress run where both sides' mana is kept full so the bots flood the road (the juice caps must hold 60 fps).
for (const [name, stress] of [['busy', false], ['stress', true]]) {
  const { ctx, p } = await open('?mode=battle&bot=1&speed=4&seed=12&deck=mixed', `fps-${name}`);
  await p.waitForFunction(() => window.__game?.s, null, { timeout: 30000 });
  if (stress) await p.evaluate(() => setInterval(() => { window.__game.s.mana = [20, 20]; }, 100));
  await p.waitForFunction(() => window.__game.s.units.length >= 10, null, { timeout: 60000, polling: 'raf' });
  const fps = [], units = [];
  for (let i = 0; i < 8; i++) { await sleep(1000); fps.push(await p.evaluate(() => window.__game.fps)); units.push(await p.evaluate(() => window.__game.s.units.length)); }
  if (stress) await shot(p, '30-stress');
  console.log(`fps x4 ${name} (no video):`, fps.join(','), 'units on field:', units.join(','));
  await ctx.close();
}

await browser.close();
await server.close();
console.log('saved to', out);
if (errors.length) { console.error('console errors:\n' + errors.join('\n')); process.exit(1); }
