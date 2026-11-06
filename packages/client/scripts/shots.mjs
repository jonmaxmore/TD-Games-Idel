// Visual proof: opens the game in Chromium at phone size, plays it, and saves screenshots + a video to shots/.
//   npm run shots                 1-1 by hand (place, select) and 1-12 played by the bot
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...(video ? { recordVideo: { dir: out, size: { width: 390, height: 844 } } } : {}) });
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
  const { ctx, p } = await page('?stage=1-12&sect=fire&seed=1&bot=1&speed=8', true);
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

await browser.close();
await server.close();
console.log('saved to', out);
if (errors.length) { console.error('console errors:\n' + errors.join('\n')); process.exit(1); }
