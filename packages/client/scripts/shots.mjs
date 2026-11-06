// Visual proof: opens the game in Chromium at 1280x720 (16:9 PC), plays it, and saves screenshots + a video to shots/.
//   npm run shots                 1-1 by hand (place, select), 1-12 played by the bot, and the first-run walkthrough
//                                 (consent → intro → T-0 → sect → name → lobby → stages → reload), all as flow-NN-*.png
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
const base = 'http://localhost:5199/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(url, video) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, ...(video ? { recordVideo: { dir: out, size: { width: 1280, height: 720 } } } : {}) });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${url}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`${url}: ${e.message}`));
  await p.goto(base + url);
  await p.waitForFunction(() => window.__game);
  return { ctx, p };
}

// 1) By hand on 1-1: the opening board, a card picked with its range shown, then a placed disciple selected.
{
  const { ctx, p } = await page('?stage=1-1&sect=fire');
  await sleep(800);
  await p.screenshot({ path: out + '01-start.png' });
  const box = await p.locator('canvas').boundingBox();
  // Find a buildable tile by asking the page, then hover and tap it.
  const spot = await p.evaluate(() => {
    const g = window.__game.s;
    for (let ty = 2; ty < 16; ty++) for (let tx = 1; tx < 10; tx++) if (!g.pathTiles.has(`${tx},${ty}`) && !g.blocked.has(`${tx},${ty}`)) return { tx, ty };
    return null;
  });
  const pt = await p.evaluate(({ tx, ty }) => window.__toScreen(tx, ty), spot);
  await p.mouse.move(box.x + pt.x, box.y + pt.y);
  await sleep(300);
  await p.screenshot({ path: out + '02-aim.png' });
  await p.mouse.click(box.x + pt.x, box.y + pt.y);
  await sleep(300);
  await p.mouse.click(box.x + pt.x, box.y + pt.y);
  await sleep(300);
  await p.screenshot({ path: out + '03-placed-selected.png' });
  await ctx.close();
}

// 2) The bot plays the chapter finale at speed; video plus a frame every few seconds and the result screen.
{
  const { ctx, p } = await page('?stage=1-12&sect=fire&seed=1&bot=1&speed=16', true);
  const fps = [];
  for (let i = 0; i < 14; i++) {
    await sleep(4000);
    fps.push(await p.evaluate(() => window.__game.fps));
    await p.screenshot({ path: out + `1-12-${String(i).padStart(2, '0')}.png` });
    if (await p.evaluate(() => ['won', 'lost'].includes(window.__game.s.phase))) break;
  }
  await sleep(1000);
  await p.screenshot({ path: out + '1-12-result.png' });
  const end = await p.evaluate(() => ({ phase: window.__game.s.phase, wave: window.__game.s.wave, lives: window.__game.s.lives }));
  console.log('1-12 bot:', end, 'fps samples:', fps.join(','));
  await ctx.close();
  const vid = readdirSync(out).find((f) => f.endsWith('.webm'));
  if (vid) renameSync(out + vid, out + '1-12-bot.webm');
}

// 3) First run on a fresh save, recorded: every screen from consent to the lobby, two stages, then a reload.
{
  const dir = out + 'flow-video/';
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: 1280, height: 720 } } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`flow: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`flow: ${e.message}`));
  let n = 0;
  const shot = async (name) => { await sleep(250); await p.screenshot({ path: out + `flow-${String(++n).padStart(2, '0')}-${name}.png` }); };
  const at = async (k) => {
    await p.waitForFunction((k) => window.__flow?.screen.k === k, k, { timeout: 10000 }).catch(() => {});
    const got = await p.evaluate(() => window.__flow?.screen.k);
    if (got !== k) errors.push(`flow: expected screen ${k}, got ${got}`);
  };
  const tap = (name) => p.getByRole('button', { name, exact: true }).first().click();
  const result = async (name) => {
    await p.waitForSelector('.modal h2.won, .modal h2.lost', { timeout: 120000 });
    await shot(name);
  };

  await p.goto(base + '?bot=1&speed=16');
  await at('consent');
  await shot('consent');
  await tap('+10'); await tap('-1');
  await shot('consent-year');
  await tap('เริ่มเล่น');
  await at('intro');
  await shot('intro-1');
  await p.locator('.intro').click({ position: { x: 195, y: 420 } });
  await shot('intro-2');
  await tap('ข้าม');
  await at('battle');
  await shot('loading-tutorial');
  await p.waitForFunction(() => window.__game?.s.stageId === 'T-0');
  await sleep(1500);
  await shot('tutorial');
  await result('tutorial-result');
  await tap('ไปต่อ');
  await at('sectPick');
  await shot('sect-pick');
  await p.locator('.sect-row', { hasText: 'สำนักกระบี่เมฆา' }).click();
  await shot('sect-detail-no-roster');
  await tap('กลับ');
  await p.locator('.sect-row', { hasText: 'สำนักหงส์เพลิง' }).click();
  await at('sectDetail');
  await shot('sect-detail');
  await tap('เข้าสำนักนี้');
  await shot('sect-confirm');
  await tap('ยืนยัน');
  await at('name');
  await shot('name');
  await p.locator('.field').fill('ก');
  await tap('ยืนยัน');
  await shot('name-too-short');
  await tap('สุ่มชื่อ');
  await tap('ยืนยัน');
  await at('lobby');
  await shot('lobby');
  await p.locator('.tabs button', { hasText: 'ศิษย์' }).click();
  await shot('lobby-locked-tab-toast');
  await p.locator('.tabs button', { hasText: 'ศึก' }).click();
  await shot('chapter-map');
  await p.locator('.stage-row', { hasText: 'ลานนาขั้นบันได' }).click();
  await result('1-1-result');
  await tap('ด่านถัดไป');
  await result('1-2-result');
  await tap('กลับลานสำนัก');
  await at('lobby');
  await shot('lobby-after-1-2');
  await p.locator('.tabs button', { hasText: 'ศิษย์' }).click();
  await shot('disciples');
  await p.locator('.tabs button', { hasText: 'ศึก' }).click();
  await shot('chapter-map-after');
  await p.reload();
  await at('lobby');
  await shot('reload-lobby');
  const prof = await p.evaluate(() => window.__flow.profile);
  console.log('flow profile:', JSON.stringify(prof));
  await ctx.close();
  const vid = readdirSync(dir).find((f) => f.endsWith('.webm'));
  if (vid) renameSync(dir + vid, out + 'flow.webm');
  rmSync(dir, { recursive: true, force: true });
}

await browser.close();
await server.close();
console.log('saved to', out);
if (errors.length) { console.error('console errors:\n' + errors.join('\n')); process.exit(1); }
