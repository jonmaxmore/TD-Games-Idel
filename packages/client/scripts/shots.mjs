// Visual proof: opens the game in Chromium at 1280x720 (16:9 PC), plays it, and saves screenshots + a video to shots/.
//   npm run shots    title, the lobby for a fresh, a mid-progress and a chapter-1-done save (primary button, unlocks, the
//                    locked next one), its overlays (settings, profile, egg shop), the clicks from the lobby to each main
//                    action, the versus screen, a loss with its tip, the pause menu; team setup (leader, sub, bench, redraw); a match played by hand (aim, a red marker off the
//                    zone, a click summon, a drag summon, counter highlights, the cannon aimed and fired); then a bot-vs-bot
//                    match at x4, recorded, with frames of an early field, a fight, a fort capture and the result screen;
//                    burn/poison marks, burning ground and the stun-resistance halo; the collection filters, a hand led
//                    by beasts and a dragon match; ค่ายฝึก (a level-up, a forge slot building, a town upgrade, the egg odds
//                    and a roll), hand cards with realm badges in ศึกทั่วไป and without them in ศึกฝีมือ; ศึกปราบ (the stage
//                    map with stars and locks, a briefing, the team screen for a stage, a waves stage mid-fight, the
//                    stars result, a wave warning, a first-clear card); ศึกฝีมือ (the rank change on the result, the replay of
//                    that match ending on its hash); the first-run sect pick, the card log, the egg shop, the lobby before
//                    and after 1-10.
// Exits non-zero on any console error or page crash.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
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

async function open(url, name, videoDir, profile) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } } } : {}) });
  if (profile) await ctx.addInitScript((t) => localStorage.setItem('five-sects.profile', t), JSON.stringify(profile));
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await p.goto(base + url);
  return { ctx, p };
}
const shot = (p, name) => p.screenshot({ path: out + `${name}.png` });
const check = (ok, msg) => { if (!ok) errors.push(msg); };
const settle = () => sleep(2200); // the result's rows appear one after another (style.css --t-stagger)
// Saves at points of progress, all with fire as the home sect (the game pays each won stage's first clear on load): 1-1..1-3
// won with cards levelled; 1-1..1-9 won; all of chapter 1 won with the egg shop open; a late account owning every card.
const STAGES = Array.from({ length: 10 }, (_, i) => `1-${i + 1}`);
const won = (n) => Object.fromEntries(STAGES.slice(0, n).map((id) => [id, { stars: [true, false, false], bestSec: 100 }]));
const FIRE = ['crimson_phoenix_banner', 'jade_bamboo_banner', 'cloud_sword_banner', 'frost_tide_banner', 'vajra_stone_banner', 'wandering_archer', 'crimson_phoenix_blade', 'crimson_phoenix_striker', 'crimson_phoenix_control'];
const LV2 = Object.fromEntries(['crimson_phoenix_banner', 'crimson_phoenix_striker', 'crimson_phoenix_control', 'crimson_phoenix_blade', 'wandering_archer', 'ember_imp'].map((id) => [id, { level: 5, xp: 0, dupes: 0 }]));
const home = (more) => ({ v: 7, home: 'fire', owned: FIRE, team: { leader: 'crimson_phoenix_striker', sub: 'crimson_phoenix_control', bench: [] }, ...more });
const MID = home({ campaign: won(3), cards: LV2, castleLevel: 1, coins: 180, gold: 90 });
const NINE = home({ campaign: won(9), cards: LV2, castleLevel: 1, coins: 500, gold: 250 });
const DONE = home({ campaign: won(10), cards: LV2, castleLevel: 1, coins: 640, gold: 320, eggPoints: 40 });
const ALL_CARDS = JSON.parse(readFileSync(fileURLToPath(new URL('../../../docs/data/sects.json', import.meta.url)), 'utf8')).roster.units.map((u) => u.id);
const BIG = home({ campaign: won(10), owned: ALL_CARDS, cards: LV2, coins: 640, gold: 320 });
const toLobby = async (p) => { await p.waitForSelector('.title'); await p.locator('.title').click(); await p.waitForSelector('.lobby-bottom'); await sleep(150); };
const lobbyButtons = (p) => p.locator('.lobby-buttons .mode b').allTextContents();

// 0) Title, the first-run sect pick, lobby, overlays, versus, a loss tip and the pause menu; the clicks from the lobby to
//    each main action.
{
  const { ctx, p } = await open('', 'lobby-fresh');
  await p.waitForSelector('.title');
  await sleep(300);
  await shot(p, '01-title');
  await p.locator('.title').click();
  await p.waitForSelector('.pick-card');
  await sleep(300);
  await shot(p, '59-pick-sect');
  await p.locator('.pick-card[data-home=fire]').hover();
  await sleep(150);
  await shot(p, '59-pick-sect-hover');
  await p.locator('.pick-card[data-home=fire]').click();
  await sleep(150);
  await shot(p, '59-pick-sect-selected');
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('five-sects.profile') ?? '{}').home ?? null) === null, 'a click on a sect only selects it');
  await p.locator('.pick-ok').click();
  await p.waitForSelector('.brief-body');
  await sleep(200);
  await shot(p, '59-pick-then-1-1');
  const owned = await p.evaluate(() => JSON.parse(localStorage.getItem('five-sects.profile')).owned);
  console.log('after the pick: owned', owned.length, owned.join(','));
  check(owned.length === 9, 'a new account owns 9 cards after the pick');
  await p.getByRole('button', { name: 'แผนที่' }).click();
  await p.getByRole('button', { name: 'กลับล็อบบี้' }).click();
  await p.waitForSelector('.lobby-bottom');
  await sleep(150);
  await shot(p, '60-lobby-fresh');
  console.log('fresh lobby:', await p.locator('.cta b').textContent(), '|', (await lobbyButtons(p)).join(', '));
  check((await p.locator('.lobby-buttons .mode').count()) === 3, 'a fresh lobby shows the map, the card log and one locked button');
  await p.locator('.gear').click();
  await sleep(150);
  await shot(p, '61-settings');
  await p.keyboard.press('Escape');
  check((await p.locator('.overlay').count()) === 0, 'Esc closes the settings');
  await p.locator('.profile-chip').click();
  await sleep(150);
  await shot(p, '62-profile');
  await p.locator('.overlay .close').click();
  // next stage: the primary, then เข้าสู่ศึก on the briefing (2 clicks), then the versus screen.
  await p.locator('.cta').click();
  await p.getByRole('button', { name: 'เข้าสู่ศึก' }).click();
  await p.waitForSelector('.versus');
  await sleep(200);
  await shot(p, '67-versus-stage');
  await p.keyboard.press('Enter');
  check(await p.evaluate(() => window.__flow.screen) === 'match', 'any key skips the versus screen');
  await p.waitForFunction(() => window.__game?.s, null, { timeout: 5000 });
  console.log('clicks lobby -> next stage: 2');
  // Esc with no card picked pauses: the sim must not step while the menu is open.
  await sleep(500);
  await p.keyboard.press('Escape');
  await p.waitForSelector('.modal.pause');
  const t0 = await p.evaluate(() => window.__game.s.tick);
  await sleep(700);
  const t1 = await p.evaluate(() => window.__game.s.tick);
  check(t0 === t1, `the sim stepped while paused (${t0} -> ${t1})`);
  await shot(p, '68-pause');
  await p.locator('.pause-mute').click();
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('five-sects.profile')).settings.muted === true), 'mute in the pause menu is saved');
  await p.keyboard.press('Escape');
  await sleep(300);
  check((await p.evaluate(() => window.__game.s.tick)) > t1, 'Esc resumes the match');
  // Leaving ศึกปราบ asks first (the match will not count); Esc in the box cancels and the menu stays.
  await p.keyboard.press('Escape');
  await p.locator('.pause-quit').click();
  await p.waitForSelector('.overlay.confirm');
  await sleep(150);
  await shot(p, '68-quit-confirm');
  await p.keyboard.press('Escape');
  check((await p.locator('.overlay.confirm').count()) === 0 && (await p.locator('.modal.pause').count()) === 1, 'Esc in the quit confirm cancels it and keeps the pause menu');
  await p.locator('.pause-quit').click();
  await p.locator('.confirm-yes').click();
  await p.waitForSelector('.lobby-bottom');
  // mute: the gear, then the sound toggle (2 clicks); the pause menu muted it, so this turns it back on.
  const muted = () => p.evaluate(() => JSON.parse(localStorage.getItem('five-sects.profile')).settings.muted);
  const was = await muted();
  await p.locator('.gear').click();
  await p.locator('[data-set=mute]').click();
  check((await muted()) === !was, 'the settings sound toggle is saved');
  console.log('clicks lobby -> mute: 2; muted', was, '->', await muted());
  await ctx.close();
}
{
  const { ctx, p } = await open('', 'lobby-mid', null, MID);
  await toLobby(p);
  await shot(p, '63-lobby-mid');
  console.log('mid lobby:', await p.locator('.cta b').textContent(), '|', (await lobbyButtons(p)).join(', '));
  check((await p.locator('.mode.locked').count()) === 1, 'the mid lobby shows exactly one locked button');
  // บันทึกการ์ด: owned cards in colour, locked ones greyed with their route.
  await p.locator('[data-go=log]').click();
  await sleep(200);
  await shot(p, '64-card-log');
  const routes = await p.locator('.log-card.locked .route').allTextContents();
  console.log('card log: owned', await p.locator('.log-card.owned').count(), '| routes', [...new Set(routes)].join(' / '));
  await p.locator('.sheet').evaluate((e) => { e.scrollTop = e.scrollHeight; });
  await sleep(150);
  await shot(p, '64-card-log-bottom');
  await p.keyboard.press('Escape');
  await ctx.close();
}
{
  // card level-up: ค่ายฝึก, the card, เลื่อนขั้น (3 clicks).
  const { ctx, p } = await open('', 'lobby-mid-camp', null, { ...MID, cards: { ...LV2, crimson_phoenix_striker: { level: 3, xp: 60, dupes: 0 } } });
  await toLobby(p);
  await p.locator('[data-go=levelUp]').click();
  await p.locator('.camp-card[data-id=crimson_phoenix_striker]').click();
  await p.locator('.level-up').click();
  await sleep(150);
  await shot(p, '66-camp-no-forge');
  console.log('clicks lobby -> card level-up: 3;', await p.locator('.camp-note').textContent());
  await ctx.close();
}
{
  const { ctx, p } = await open('', 'lobby-nine', null, NINE);
  await toLobby(p);
  await shot(p, '69-lobby-before-1-10');
  console.log('lobby before 1-10:', await p.locator('.cta b').textContent(), '|', (await lobbyButtons(p)).join(', '));
  check((await p.locator('.cta').getAttribute('data-cta')) === 'stage', 'before 1-10 the primary is the next stage');
  await p.locator('[data-go=map]').click();
  await p.waitForSelector('.stage-node');
  await sleep(200);
  await shot(p, '51-stage-map-nine');
  check((await p.locator('.stage-node').count()) === 10, 'the stage map has 10 nodes');
  await ctx.close();
}
{
  // ร้านไข่ after 1-10: pick a card, buy it (2 clicks from the lobby), then a training egg.
  const { ctx, p } = await open('', 'egg-shop', null, DONE);
  await toLobby(p);
  await p.locator('[data-go=eggShop]').click();
  await sleep(200);
  await shot(p, '65-egg-shop');
  const buy = p.locator('.shop-grid [data-buy]:not([disabled])').first();
  const bought = await buy.getAttribute('data-buy');
  await buy.click();
  await p.waitForSelector('.overlay.confirm');
  await sleep(150);
  await shot(p, '65-egg-confirm');
  check(!(await p.evaluate((c) => JSON.parse(localStorage.getItem('five-sects.profile')).owned.includes(c), bought)), 'a buy waits for its confirm');
  await p.locator('.confirm-yes').click();
  await sleep(200);
  await shot(p, '65-egg-bought');
  console.log('egg shop: bought', bought, '|', await p.locator('.egg-got').textContent());
  check(await p.evaluate((c) => JSON.parse(localStorage.getItem('five-sects.profile')).owned.includes(c), bought), 'a bought card is owned');
  await p.locator('.chip[data-tab=train]').click();
  await sleep(150);
  await shot(p, '65-egg-train');
  await p.keyboard.press('Escape');
  await ctx.close();
}
{
  const { ctx, p } = await open('', 'lobby-done', null, DONE);
  await toLobby(p);
  await shot(p, '69-lobby-chapter-done');
  console.log('chapter-1 lobby:', await p.locator('.cta b').textContent(), '|', (await lobbyButtons(p)).join(', '));
  check((await p.locator('.cta').getAttribute('data-cta')) === 'ranked', 'after chapter 1 the primary is ranked');
  // ranked: the primary, then เข้าสู่ศึก on the team screen (2 clicks).
  await p.locator('.cta').click();
  await p.getByRole('button', { name: 'เข้าสู่ศึก' }).click();
  await p.waitForSelector('.versus');
  await sleep(200);
  await shot(p, '67-versus-ranked');
  await p.waitForFunction(() => window.__game?.s, null, { timeout: 5000 });
  console.log('clicks lobby -> ranked: 2');
  await ctx.close();
}
{
  // A loss: bots play a while, then our castle falls; the result names one cause and a card that answers it.
  const { ctx, p } = await open('?mode=battle&bot=1&speed=4&seed=2&deck=fire', 'loss', null, DONE);
  await p.waitForFunction(() => window.__game?.s?.tick > 20 * 70, null, { timeout: 60000 });
  await p.evaluate(() => { window.__game.s.castles[0].hp = 0; });
  await p.waitForSelector('.modal.result', { timeout: 20000 });
  await settle();
  await shot(p, '70-loss-tip');
  const tip = await p.locator('.loss-tip p').textContent().catch(() => null);
  console.log('loss:', await p.locator('[data-primary]').textContent(), '|', tip);
  check(tip != null, 'a loss shows a tip');
  check((await p.locator('.loss-tip .tip-deck').count()) === 1, 'the loss tip has a จัดทัพ button');
  check((await p.locator('.modal.result .btn-primary').count()) === 1, 'the result has exactly one primary');
  await ctx.close();
}

// 1) Front screens: the team setup of a young fire account (no bench room yet), then of an account that owns every card: a
//    leader and a bench picked, the dealt hand, a redraw, the filters.
{
  const { ctx, p } = await open('', 'front-new', null, MID);
  await toLobby(p);
  await p.locator('.cta').click();
  await p.getByRole('button', { name: 'จัดทัพ' }).click();
  await p.waitForSelector('.team-card');
  await sleep(200);
  await shot(p, '02-team-owned');
  console.log('team (mid):', await p.locator('.filters .count').first().textContent());
  await ctx.close();
}
{
  const { ctx, p } = await open('', 'front', null, BIG);
  await toLobby(p);
  await p.locator('[data-go=casual]').click();
  await p.waitForSelector('.team-card');
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
  // Hover each card: the tooltip, and enemies it beats (orange ▲) or loses to (purple ▼), with the legend.
  for (let i = 0; i < 7; i++) {
    const b = await p.locator('.card').nth(i).boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + 20);
    await sleep(350);
    await shot(p, `16-counter-hover-${i + 1}`);
  }
  // The cannon: Space arms it, the enemy nearest our castle is the aim, a click fires.
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
  await sleep(250);
  await shot(p, '29-result-reveal');
  await sleep(1950);
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

// 5) ค่ายฝึก from a played-in save: fire cards across the realms, xp for a level-up, coins, gold and egg points.
{
  const LV = { crimson_phoenix_banner: 9, crimson_phoenix_striker: 15, crimson_phoenix_burst: 24, crimson_phoenix_beast: 30, crimson_phoenix_kite: 12, ember_imp: 3 };
  const cards = Object.fromEntries(Object.entries(LV).map(([id, level]) => [id, { level, xp: 0, dupes: 0 }]));
  cards.crimson_phoenix_striker.xp = 170;
  const save = home({ mode: 'casual', owned: [...FIRE, 'crimson_phoenix_burst', 'crimson_phoenix_beast', 'crimson_phoenix_kite', 'ember_imp'], team: { leader: 'crimson_phoenix_striker', sub: 'crimson_phoenix_kite', bench: [] }, cards, coins: 520, gold: 640, eggPoints: 30, castleLevel: 1, campaign: won(10) });
  const { ctx, p } = await open('', 'camp', null, save);
  await toLobby(p);
  await p.locator('[data-go=levelUp]').click();
  await p.waitForSelector('.camp-card');
  await sleep(300);
  await shot(p, '40-camp');
  await p.locator('.level-up').click();
  await sleep(200);
  await shot(p, '41-level-up');
  await p.locator('.slot[data-slot=weapon]').click();
  await p.locator('.slot[data-slot=helm]').click();
  await sleep(1200);
  await shot(p, '42-forge-building');
  await p.locator('[data-town=cannon]').click();
  await p.locator('[data-town=wall]').click();
  await sleep(200);
  await shot(p, '43-town-upgraded');
  console.log('camp note:', await p.locator('.camp-note').textContent());
  await p.getByRole('button', { name: 'กลับ', exact: true }).click();
  await p.locator('[data-go=eggShop]').click();
  await p.locator('.shop-grid [data-buy]:not([disabled])').first().click();
  await p.locator('.confirm-yes').click();
  await sleep(300);
  await shot(p, '44-egg-buy');
  await ctx.close();
  // The same save in a match: realm badges on the hand in ศึกทั่วไป, none in ศึกฝีมือ.
  for (const [mode, name] of [['casual', '45-hand-realms'], ['ranked', '46-hand-ranked']]) {
    const m = await open('?mode=battle&seed=3&deck=fire', name, null, { ...save, mode });
    await m.p.waitForFunction(() => window.__game?.s);
    await sleep(800);
    await shot(m.p, name);
    console.log(name, 'castle hp', await m.p.evaluate(() => window.__game.s.castles.map((c) => c.maxHp).join('/')));
    await m.ctx.close();
  }
}

// 6) ศึกปราบ from a save that has won 1-1 (all stars) and 1-2 (one star): the map, 1-3's briefing, its team screen; then
//    stage 1-2 (waves) by bots at x4, mid-fight once the scripted imps are out, and its result with stars; 1-7's warning
//    before the scripted lion; and 1-1 won for the first time: the new card on the result.
{
  const save = home({ mode: 'casual', campaign: { '1-1': { stars: [true, true, true], bestSec: 74 }, '1-2': { stars: [true, false, false], bestSec: null } } });
  const { ctx, p } = await open('', 'campaign', null, save);
  await toLobby(p);
  await shot(p, '50-lobby-two-won');
  await p.locator('[data-go=map]').click();
  await p.waitForSelector('.stage-node');
  await sleep(200);
  await shot(p, '51-stage-map');
  check((await p.locator('.stage-node.next').getAttribute('data-stage')) === '1-3' && (await p.locator('.play-next').count()) === 1, 'the map marks 1-3 as next and offers it as its primary');
  await p.locator('.stage-node[data-stage="1-3"]').click();
  await p.waitForSelector('.brief-body');
  await sleep(200);
  await shot(p, '52-briefing');
  await p.getByRole('button', { name: 'จัดทัพ' }).click();
  await p.waitForSelector('.team-card');
  await sleep(200);
  await shot(p, '53-team-stage');
  // Esc walks back: team setup -> briefing -> stage map -> lobby.
  const flow = () => p.evaluate(() => window.__flow.screen);
  const walked = [];
  for (let i = 0; i < 3; i++) { await p.keyboard.press('Escape'); await sleep(100); walked.push(await flow()); }
  console.log('Esc from the stage team setup:', walked.join(' -> '));
  check(walked.join() === 'brief,campaign,lobby', `Esc goes back on each full screen (${walked.join()})`);
  await ctx.close();
  const m = await open('?mode=battle&stage=1-2&bot=1&speed=4&seed=3', 'stage-waves', null, save);
  await m.p.waitForFunction(() => window.__game?.s);
  await m.p.waitForFunction(() => window.__game.s.tick >= 20 * 41 && window.__game.s.units.filter((u) => u.card === 'ember_imp' && u.side === 1).length >= 3, null, { timeout: 90000, polling: 'raf' });
  await shot(m.p, '54-stage-waves');
  await m.p.waitForSelector('.modal.result', { timeout: 120000 });
  await settle();
  await shot(m.p, '55-stage-result');
  console.log('stage 1-2 result:', await m.p.locator('.star-row').textContent());
  const buttons = await m.p.locator('.result-actions button').allTextContents();
  console.log('stage result buttons:', buttons.join(' | '));
  check(buttons.length === 4 && buttons.includes('ภาพย้อนหลัง') && buttons.includes('จัดทัพ'), 'every result has the same four buttons, ภาพย้อนหลัง included');
  // ภาพย้อนหลัง works outside ศึกฝีมือ too: the stage match plays back to the same hash.
  await m.p.locator('.replay-btn').click();
  await m.p.waitForSelector('.modal.result', { timeout: 120000 });
  await settle();
  await shot(m.p, '58-stage-replay-end');
  check((await m.p.locator('.modal.result').textContent()).includes('ผลตรงกับ'), 'a stage match replays to the same hash');
  await m.ctx.close();
  const w = await open('?mode=battle&stage=1-7&bot=1&speed=2&seed=3', 'stage-warn', null, save);
  await w.p.waitForSelector('.toast.warn', { timeout: 90000 });
  await sleep(100);
  await shot(w.p, '54-stage-warn');
  console.log('warning:', await w.p.locator('.toast.warn').textContent());
  await w.p.waitForFunction(() => window.__game.s.units.some((u) => u.card === 'golden_lion' && u.side === 1), null, { timeout: 60000, polling: 'raf' });
  await sleep(600);
  await shot(w.p, '54-stage-warn-lion');
  await w.ctx.close();
  let firstClear = false;
  for (const seed of [3, 4, 5, 6]) {
    const f = await open(`?mode=battle&stage=1-1&bot=1&speed=4&seed=${seed}`, 'first-clear', null, home({}));
    await f.p.waitForSelector('.modal.result', { timeout: 120000 });
    await settle();
    firstClear = (await f.p.locator('.new-card').count()) > 0;
    if (firstClear) {
      await shot(f.p, '55-first-clear');
      console.log('first clear of 1-1 (seed', seed, '):', await f.p.locator('.new-card').textContent());
    }
    await f.ctx.close();
    if (firstClear) break;
  }
  check(firstClear, 'a first clear of 1-1 shows its new card');
}

// 7) ศึกฝีมือ by bots at x4: the result with the rank change, then the replay of that match from its record to the end.
{
  const { ctx, p } = await open('?mode=battle&bot=1&speed=4&seed=3&deck=fire', 'ranked', null, home({ mode: 'ranked', campaign: won(10) }));
  await p.waitForSelector('.modal.result', { timeout: 120000 });
  await settle();
  await shot(p, '56-ranked-result');
  console.log('ranked:', await p.locator('.rank-change').textContent());
  await p.locator('.replay-btn').click();
  await p.waitForFunction(() => window.__game?.s?.tick > 600, null, { timeout: 60000 });
  await shot(p, '57-replay');
  await p.waitForSelector('.modal.result', { timeout: 120000 });
  await settle();
  await shot(p, '58-replay-end');
  const text = await p.locator('.modal.result').textContent();
  console.log('replay end:', text);
  if (!text.includes('ผลตรงกับ')) errors.push('ranked replay did not end on the saved hash');
  await ctx.close();
}

// 8) ศึกฝีมือ by hand: ยอมแพ้ is closed before the 60th second, then a confirmed surrender is a loss on the rank, and its
//    replay stops on the surrender tick with the same hash.
{
  const { ctx, p } = await open('?mode=battle&seed=3&deck=fire&speed=4', 'surrender', null, home({ mode: 'ranked', campaign: won(10), rank: { league: 0, div: 3, stars: 1, streak: 2, points: 0 } }));
  await p.waitForFunction(() => window.__game?.s);
  await sleep(300);
  await p.keyboard.press('Escape');
  await p.waitForSelector('.modal.pause');
  await sleep(100);
  await shot(p, '68-surrender-closed');
  check(await p.locator('.pause-quit').isDisabled(), 'ยอมแพ้ is closed before the 60th second');
  console.log('surrender early:', await p.locator('.pause-quit').textContent(), '|', await p.locator('.pause-why').textContent());
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.__game.s.tick >= 20 * 61, null, { timeout: 60000 });
  await p.keyboard.press('Escape');
  await p.locator('.pause-quit').click();
  await p.waitForSelector('.overlay.confirm');
  await sleep(100);
  await shot(p, '68-surrender-confirm');
  await p.locator('.confirm-yes').click();
  await p.waitForSelector('.modal.result');
  await settle();
  await shot(p, '56-surrender-result');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('five-sects.profile')));
  console.log('surrender:', await p.locator('.modal.result h2').textContent(), '| rank', JSON.stringify(saved.rank), '| endTick', saved.lastRanked?.endTick);
  check(saved.rank.streak === 0 && saved.lastRanked?.endTick > 0, 'a surrender counts as a ranked loss and keeps its replay');
  await p.locator('.replay-btn').click();
  await p.waitForSelector('.modal.result', { timeout: 120000 });
  check((await p.locator('.modal.result').textContent()).includes('ผลตรงกับ'), 'the surrendered match replays to the same hash');
  await ctx.close();
}

// 9) The stage on other PC windows: 1080p (x1.5, no bars), 2560x1080 (x1.5 with bars left and right), 1366x768 (x1, bars).
for (const [w, h, k] of [[1920, 1080, 1.5], [2560, 1080, 1.5], [1366, 768, 1]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.addInitScript((t) => localStorage.setItem('five-sects.profile', t), JSON.stringify(MID));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`fit-${w}: ${e.message}`));
  await p.goto(base);
  await toLobby(p);
  await shot(p, `90-fit-${w}x${h}`);
  const r = await p.locator('#app').boundingBox();
  console.log(`fit ${w}x${h}:`, JSON.stringify(r));
  check(Math.abs(r.width - 1280 * k) < 1 && Math.abs(r.height - 720 * k) < 1 && Math.abs(r.x - (w - 1280 * k) / 2) <= 1, `the stage is 1280x720 x${k}, centred, at ${w}x${h}`);
  await ctx.close();
}

await browser.close();
await server.close();
console.log('saved to', out);
if (errors.length) { console.error('console errors:\n' + errors.join('\n')); process.exit(1); }
