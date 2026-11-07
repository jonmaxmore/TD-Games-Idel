// Visual proof: opens the game in Chromium at 1280x720 (16:9 PC), plays it, and saves screenshots + a video to shots/.
//   npm run shots    title and team setup (leader, sub, bench, redraw); a match played by hand (aim, a red marker off the
//                    zone, a click summon, a drag summon, counter highlights, the cannon aimed and fired); then a bot-vs-bot
//                    match at x4, recorded, with frames of an early field, a fight, a fort capture and the result screen;
//                    burn/poison marks, burning ground and the stun-resistance halo; the collection filters, a hand led
//                    by beasts and a dragon match.
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

// 1) Front screens: title, then the team setup: a collection, a leader and a bench picked, the dealt hand, a redraw.
{
  const { ctx, p } = await open('', 'front');
  await p.waitForSelector('.title');
  await sleep(300);
  await shot(p, '01-title');
  await p.getByRole('button', { name: 'เริ่มศึก' }).click();
  await p.waitForSelector('.team-card');
  await p.locator('.deck-row[data-id=fire]').click();
  await sleep(200);
  await shot(p, '02-team-fire');
  await p.locator('.team-card[data-id=crimson_phoenix_kite] .acts button:nth-child(2)').click();
  await p.locator('.team-card[data-id=crimson_phoenix_support] .acts button:nth-child(3)').click();
  await p.locator('.team-card[data-id=crimson_phoenix_beast]').hover();
  await sleep(200);
  await shot(p, '03-team-sub-bench');
  const before = await p.locator('.hand-card b').allTextContents();
  await p.getByRole('button', { name: /สับมือใหม่/ }).click();
  await sleep(200);
  const after = await p.locator('.hand-card b').allTextContents();
  console.log('hand before redraw:', before.join(','), '| after:', after.join(','));
  await shot(p, '03-team-redraw');
  await p.locator('.deck-row[data-id=all]').click();
  await sleep(200);
  await shot(p, '03-team-all');
  // The collection filters: by kind, by cost, by role, then a hand led by a dragon and a divine beast.
  for (const [f, name] of [['kind:demon', '05-filter-demons'], ['kind:divine', '05-filter-divine'], ['kind:dragon', '05-filter-dragons'], ['kind:all', null], ['cost:1', '05-filter-cost1'], ['cost:all', null], ['role:สกัด', '05-filter-guards'], ['role:all', null]]) {
    await p.locator(`.chip[data-f="${f}"]`).click();
    await sleep(150);
    if (name) await shot(p, name);
  }
  await p.locator('.team-card[data-id=storm_dragon] .acts button:nth-child(1)').click();
  await p.locator('.team-card[data-id=jade_tortoise] .acts button:nth-child(2)').click();
  await p.locator('.team-card[data-id=storm_dragon]').hover();
  await sleep(200);
  await shot(p, '06-hand-beasts');
  console.log('hand with beasts:', (await p.locator('.hand-card').evaluateAll((es) => es.map((e) => e.dataset.id))).join(','));
  await p.locator('.deck-row[data-id=fire]').click();
  await p.getByRole('button', { name: 'เข้าสู่ศึก' }).click();
  await p.waitForFunction(() => window.__game?.s);
  await sleep(600);
  await shot(p, '04-match-from-team');
  await ctx.close();
}

// 2) A match by hand (fire team vs the AI): aim inside the zone, aim past it (red), summon by click, by drag, a card's
//    counter highlight, the cannon aimed and fired.
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
  // Drag the sub-leader card (slot 3) onto the road.
  await p.waitForFunction(() => window.__game.s.mana[0] >= 4, null, { timeout: 20000 });
  const card = await p.locator('.card').nth(2).boundingBox();
  await p.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await p.mouse.down();
  pt = await at(zone - 2500);
  await p.mouse.move((card.x + pt.x) / 2, (card.y + pt.y) / 2, { steps: 4 });
  await p.mouse.move(pt.x, pt.y, { steps: 4 });
  await sleep(150);
  await shot(p, '15-drag');
  await p.mouse.up();
  await p.waitForFunction(() => window.__game.s.units.filter((u) => u.side === 0).length >= 2, null, { timeout: 5000 });
  await p.waitForFunction(() => window.__game.s.units.filter((u) => u.side === 1).length >= 3, null, { timeout: 40000 });
  await sleep(500);
  // Hover each card until one marks an enemy (orange: it beats it, blue: it loses to it).
  for (let i = 0; i < 7; i++) {
    const b = await p.locator('.card').nth(i).boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + 20);
    await sleep(120);
    await shot(p, `16-counter-hover-${i + 1}`);
  }
  // The cannon: Space arms it, the enemy nearest our castle is the aim, a click fires.
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.__game.s.mana[0] >= 2 && window.__game.s.castles[0].cannonCd === 0, null, { timeout: 20000 });
  await p.waitForFunction(() => window.__game.s.units.some((u) => u.side === 1 && u.d <= 8500), null, { timeout: 60000 });
  const foe = await p.evaluate(() => Math.min(...window.__game.s.units.filter((u) => u.side === 1).map((u) => u.d)));
  await p.keyboard.press('Space');
  pt = await at(foe);
  await p.mouse.move(pt.x, pt.y);
  await sleep(200);
  await shot(p, '17-cannon-aim');
  await p.mouse.click(pt.x, pt.y);
  await sleep(220);
  await shot(p, '17-cannon-shot');
  await sleep(400);
  await shot(p, '17-cannon-after');
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
  const { ctx, p } = await open('?mode=battle&bot=1&speed=4&seed=2&deck=all', 'bots', dir);
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

// 3a) Status marks, bot vs bot: burn and poison stacks (fire vs wood), burning ground, an earth unit's stun resistance halo.
for (const [deck, seed, name, cond] of [
  ['fire', 4, '26-dot-marks', 'window.__game.s.units.some((u) => u.burn > 1) && window.__game.s.units.some((u) => u.poison > 0)'],
  ['fire', 7, '27-burning-ground', 'window.__game.s.zones.length > 0 && window.__game.s.units.length >= 4'],
  ['earth', 7, '28-stun-immune', 'window.__game.s.units.some((u) => u.stunImmT > 0)'],
]) {
  const { ctx, p } = await open(`?mode=battle&bot=1&speed=2&seed=${seed}&deck=${deck}`, name);
  await p.waitForFunction(() => window.__game?.s, null, { timeout: 30000 });
  console.log('waiting for', name);
  await p.waitForFunction(cond, null, { timeout: 120000, polling: 'raf' });
  await shot(p, name);
  await ctx.close();
}

// 3b) Sect teams bot vs bot at x4: the first large unit on the field.
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

// 3c) Dragons by hand against the AI (all cards): with our mana topped up once, the lava dragon (key 2) holds our zone and
//     the storm dragon (key 3) flies at the enemy; then the AI's answer and the fight around them.
{
  const deck = 'lava_dragon,storm_dragon,wandering_archer,ember_imp,blood_bat,golden_lion,jade_tortoise,corpse_puppeteer';
  const { ctx, p } = await open(`?mode=battle&seed=5&speed=2&deck=${deck}&leader=lava_dragon&sub=storm_dragon`, 'dragons');
  await p.waitForFunction(() => window.__game?.s, null, { timeout: 30000 });
  await sleep(500);
  const at = (d) => p.evaluate((d) => window.__pathClient(d), d);
  await p.evaluate(() => { window.__game.s.mana[0] = 40; });
  for (const [key, d] of [['2', 3500], ['3', 2500]]) {
    await p.keyboard.press(key);
    const pt = await at(d);
    await p.mouse.click(pt.x, pt.y);
    await sleep(150);
  }
  await p.waitForFunction(() => window.__game.s.units.filter((u) => u.card.endsWith('_dragon')).length >= 2, null, { timeout: 20000 });
  await sleep(1500);
  await shot(p, '31-dragons');
  await p.waitForFunction(() => window.__game.fights >= 6, null, { timeout: 120000, polling: 'raf' });
  await shot(p, '32-dragon-fight');
  await sleep(2500);
  await shot(p, '33-dragon-fight-later');
  console.log('dragon match units:', await p.evaluate(() => window.__game.s.units.map((u) => `${u.side}:${u.card}`).join(',')));
  await ctx.close();
}

// 4) Frame rate at x4 without the video recorder, sampled once a second: a busy bot match (seed 12 peaks at 13 units), then a
//    stress run where both sides' mana is kept full so the bots flood the road (the juice caps must hold 60 fps).
for (const [name, stress] of [['busy', false], ['stress', true]]) {
  const { ctx, p } = await open('?mode=battle&bot=1&speed=4&seed=12&deck=all', `fps-${name}`);
  await p.waitForFunction(() => window.__game?.s, null, { timeout: 30000 });
  if (stress) await p.evaluate(() => setInterval(() => { window.__game.s.mana = [40, 40]; }, 100));
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
