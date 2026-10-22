// Smoke test: serves the built client with Vite's preview server, loads it in Chromium,
// plays a few seconds of 1-1, 1-3 and the training ground, and fails on any console error.
// Usage: npm run build && npm run smoke  (SMOKE_SHOTS=dir to save screenshots)
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const PORT = 4179;
const shots = process.env.SMOKE_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const server = await preview({ root: fileURLToPath(new URL('..', import.meta.url)), preview: { port: PORT, strictPort: true }, logLevel: 'warn' });

const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-first-run', '--disable-background-networking', '--disable-component-update'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__game?.scene?.isActive('menu'), null, { timeout: 15000 });
  await page.waitForTimeout(500);
  if (shots) await page.screenshot({ path: `${shots}/menu.png` });

  const play = (key, stageId, setup) => page.evaluate(([key, stageId, setup]) => {
    const g = window.__game;
    g.scene.getScenes(true).forEach((s) => s.scene.stop());
    g.scene.start(key, { stageId });
    return new Promise((r) => setTimeout(() => {
      const sc = g.scene.getScene(key);
      sc.speed = 3;
      sc.pending.push(...setup);
      r(null);
    }, 300));
  }, [key, stageId, setup]);

  await play('defend', '1-1', [{ t: 'place', sect: 'metal', tx: 4, ty: 3 }, { t: 'nextWave' }]);
  await page.waitForTimeout(6000);
  if (shots) await page.screenshot({ path: `${shots}/defend-1-1.png` });

  await play('assault', '1-3', []);
  await page.waitForTimeout(4000);
  if (shots) await page.screenshot({ path: `${shots}/assault-1-3.png` });

  const place = [[3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [3, 5], [4, 5], [5, 5], [6, 5]];
  const sects = ['metal', 'water', 'fire', 'earth', 'wood', 'yinyang', 'metal', 'fire', 'water'];
  await play('defend', 'T-1', [...place.map(([tx, ty], i) => ({ t: 'place', sect: sects[i], tx, ty })), { t: 'nextWave' }]);
  await page.waitForTimeout(5000);
  await page.evaluate(() => window.__game.scene.getScene('defend').pending.push({ t: 'cast', art: 'heaven_sword' }));
  await page.waitForTimeout(300);
  if (shots) await page.screenshot({ path: `${shots}/art.png` });
  await page.waitForTimeout(3000);
  const fps = await page.evaluate(() => Math.round(window.__game.loop.actualFps));
  const placed = await page.evaluate(() => window.__game.scene.getScene('defend').s.disciples.length);
  if (placed !== 9) errors.push(`expected 9 disciples placed in training ground, got ${placed}`);
  if (fps < 50) errors.push(`fps ${fps} below 50`);
  if (shots) await page.screenshot({ path: `${shots}/training.png` });
  console.log(JSON.stringify({ fps, errors }));
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) { console.error('console errors:', errors); process.exit(1); }
console.log('smoke ok');
