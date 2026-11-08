// Visual proof of ศึกกับเพื่อน: starts the game server and the client, then two Chromium contexts at 1280x720 play a
// friend room: the lobby button, the room menu, a wrong code, create (the code, copy), join, the guest leaving with Esc and
// coming back, a third player kicked by the host, both teams and ready, the versus screen, a summon from each side in the
// match (the guest plays on the right), the host leaving (a confirmed forfeit) and both result screens; then the lobby
// with no server (the button disabled, in Thai).
//   npm run shots:pvp    -> shots/pvp-*.png. Exits non-zero on a console error, a page crash or a failed check.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const out = fileURLToPath(new URL('../../../shots/', import.meta.url));
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const check = (ok, msg) => { if (!ok) errors.push(msg); };
const PROBE = /^WebSocket connection to 'ws:\/\/(localhost|127\.0\.0\.1):\d+\/v1\/ws' failed/;

const GAME_PORT = 8799;
const game = spawn(`${repo}node_modules/.bin/vite-node`, ['packages/game/src/main.ts'], { cwd: repo, env: { ...process.env, PORT: String(GAME_PORT), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let gameLog = '';
game.stdout.on('data', (d) => { gameLog += d; });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`http://127.0.0.1:${GAME_PORT}/health`)).ok) break; } catch { /* not up yet */ }
  await sleep(100);
}
process.env.VITE_GAME_SERVER = `ws://127.0.0.1:${GAME_PORT}/v1/ws`;
const server = await createServer({ root, server: { port: 5198 }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

const STAGES = Array.from({ length: 10 }, (_, i) => `1-${i + 1}`);
const DONE = { v: 7, home: 'fire', owned: ['crimson_phoenix_banner', 'wandering_archer', 'crimson_phoenix_blade', 'crimson_phoenix_striker', 'crimson_phoenix_control'], team: { leader: 'crimson_phoenix_striker', sub: 'crimson_phoenix_control', bench: [] }, campaign: Object.fromEntries(STAGES.map((id) => [id, { stars: [true, false, false], bestSec: 100 }])) };
async function open(name, url = '', pvpName) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  await ctx.addInitScript(([t, n]) => { localStorage.setItem('five-sects.profile', t); if (n) localStorage.setItem('five-sects.pvp.name', n); }, [JSON.stringify(DONE), pvpName]);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !PROBE.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await p.goto(base + url);
  await p.waitForSelector('.title');
  await p.locator('.title').click();
  await p.waitForSelector('.lobby-bottom');
  return { ctx, p };
}
const shot = (p, name) => p.screenshot({ path: `${out}pvp-${name}.png` });

const A = await open('host', '', 'ผู้กล้าเหนือ');
await A.p.waitForSelector('.pvp-btn:not([disabled])', { timeout: 5000 });
await shot(A.p, '01-lobby');
await A.p.locator('.pvp-btn').click();
await A.p.waitForSelector('.create-btn');
await shot(A.p, '02-menu');
await A.p.locator('.pvp-code').fill('zzz-zzz');
await A.p.locator('.join-btn').click();
await A.p.waitForFunction(() => document.querySelector('.pvp-error')?.textContent?.includes('ไม่พบห้อง'), null, { timeout: 5000 });
await shot(A.p, '03-wrong-code');
await A.p.locator('.create-btn').click();
await A.p.waitForSelector('.room-code');
const code = (await A.p.locator('.room-code').textContent()).trim();
console.log('room code', code);
check(/^[2-9A-HJKMNP-TW-Z]{6}$/.test(code), `room code ${code} uses the unambiguous alphabet`);
await A.p.locator('.copy-btn').click();
await sleep(200);
check((await A.p.evaluate(() => navigator.clipboard.readText())) === code, 'copy puts the code on the clipboard');
await shot(A.p, '04-room-waiting');

const B = await open('guest', '', 'ศิษย์ใต้');
await B.p.waitForSelector('.pvp-btn:not([disabled])', { timeout: 5000 });
await B.p.locator('.pvp-btn').click();
await B.p.locator('.pvp-code').fill(code.toLowerCase());
await B.p.locator('.pvp-code').press('Enter');
await B.p.waitForSelector('.room-code');
await A.p.waitForFunction(() => document.querySelector('.pvp-seat.side1 .pvp-who')?.textContent?.includes('ศิษย์ใต้'), null, { timeout: 5000 });
await shot(A.p, '05-room-host-sees-guest');
await B.p.keyboard.press('Escape'); // the guest leaves with Esc
await A.p.waitForSelector('.pvp-seat.side1 .pvp-wait', { timeout: 5000 });
await B.p.waitForSelector('.create-btn');
// A third player joins; the host sends them out (confirmed) and they cannot come back to this room.
const K = await open('kicked', '', 'คนแปลกหน้า');
await K.p.waitForSelector('.pvp-btn:not([disabled])', { timeout: 5000 });
await K.p.locator('.pvp-btn').click();
await K.p.locator('.pvp-code').fill(code);
await K.p.locator('.join-btn').click();
await A.p.waitForSelector('.pvp-seat.side1 .kick-btn', { timeout: 5000 });
check(await B.p.locator('.kick-btn').count() === 0, 'only the host sees the kick button');
await A.p.locator('.kick-btn').click();
await A.p.waitForSelector('.overlay.confirm');
await shot(A.p, '05b-room-kick-confirm');
await A.p.locator('.overlay.confirm .confirm-yes').click();
await A.p.waitForSelector('.pvp-seat.side1 .pvp-wait', { timeout: 5000 });
await K.p.waitForFunction(() => document.querySelector('.pvp-error')?.textContent?.includes('เจ้าของห้อง'), null, { timeout: 5000 });
await shot(K.p, '05c-kicked');
await K.p.locator('.pvp-code').fill(code);
await K.p.locator('.join-btn').click();
await sleep(500);
check(await K.p.locator('.room-code').count() === 0, 'a kicked player cannot join the room again');
await K.ctx.close();
await B.p.locator('.pvp-code').fill(code);
await B.p.locator('.join-btn').click();
await B.p.waitForSelector('.room-code');
await B.p.locator('.pvp-team select').first().selectOption('vajra_stone_guardian');
await A.p.waitForFunction(() => document.querySelector('.pvp-seat.side1')?.textContent?.includes('แม่ทัพ'), null, { timeout: 5000 });
await A.p.locator('.ready-btn').click();
await B.p.waitForFunction(() => document.querySelector('.pvp-seat.side0 .pvp-ready.on'), null, { timeout: 5000 });
await shot(B.p, '06-room-guest-host-ready');
await B.p.locator('.ready-btn').click();
await Promise.all([A.p.waitForSelector('.pvp-vs'), B.p.waitForSelector('.pvp-vs')]);
await shot(A.p, '07-versus-host');
await shot(B.p, '07-versus-guest');

// The match: each side summons its first card at its own castle gate (the guest's gate is the far end of the road).
for (const [P, d] of [[A.p, 0], [B.p, 1e9]]) {
  await P.waitForFunction(() => window.__game?.s?.tick > 30, null, { timeout: 10000 });
  await P.locator('.hud-bottom .card').first().click();
  const pt = await P.evaluate((x) => window.__pathClient(x), d);
  await P.mouse.move(pt.x, pt.y);
  await P.mouse.click(pt.x, pt.y);
}
await A.p.waitForFunction(() => window.__game.s.units.filter((u) => u.side === 0).length > 0 && window.__game.s.units.filter((u) => u.side === 1).length > 0, null, { timeout: 10000 });
await sleep(1500);
const ticks = await Promise.all([A.p, B.p].map((P) => P.evaluate(() => window.__game.s.tick)));
console.log('ticks host/guest', ticks.join('/'));
check(Math.abs(ticks[0] - ticks[1]) < 10, 'both clients are within half a second of each other');
await shot(A.p, '08-match-host');
await shot(B.p, '08-match-guest');
await A.p.keyboard.press('Escape');
await A.p.waitForSelector('.modal.pause');
await shot(A.p, '09-menu-no-pause');
const t0 = await A.p.evaluate(() => window.__game.s.tick);
await sleep(500);
check((await A.p.evaluate(() => window.__game.s.tick)) > t0, 'the online menu does not pause the match');
await A.p.locator('.pause-quit').click();
await A.p.waitForSelector('.overlay.confirm');
await shot(A.p, '09b-forfeit-confirm');
await A.p.locator('.overlay.confirm .confirm-yes').click();
await Promise.all([A.p.waitForSelector('.pvp-result', { timeout: 10000 }), B.p.waitForSelector('.pvp-result', { timeout: 10000 })]);
await sleep(2200); // the result's rows appear one after another (style.css --t-stagger)
await shot(A.p, '10-result-host-forfeit');
await shot(B.p, '10-result-guest-win');
check((await B.p.locator('.pvp-result h2').textContent()).includes('ชนะ'), 'the guest wins when the host leaves');
check((await A.p.locator('.pvp-result h2').textContent()).includes('พ่ายแพ้'), 'the host loses by leaving');
for (const P of [A.p, B.p]) check((await P.locator('.pvp-result .btn-primary').count()) === 1, 'the friend result has exactly one primary');
check(await A.p.locator('.hud-top .ctl').getByText('x1').isHidden(), 'an online match has no speed button');
await B.p.getByRole('button', { name: 'ศึกกับเพื่อนอีกครั้ง' }).click();
await B.p.waitForSelector('.create-btn');
await A.ctx.close(); await B.ctx.close();

// No server: the button says so in Thai and cannot be clicked.
const C = await open('offline', `?server=${encodeURIComponent('ws://127.0.0.1:1/v1/ws')}`);
await C.p.waitForSelector('.pvp-btn.offline', { timeout: 5000 });
await C.p.locator('.pvp-btn').hover();
await shot(C.p, '11-lobby-no-server');
check(await C.p.locator('.pvp-btn').isDisabled(), 'with no server the button is disabled');
console.log('offline button:', await C.p.locator('.pvp-btn').textContent(), '|', await C.p.locator('.pvp-btn').getAttribute('title'));
await C.ctx.close();

await browser.close();
await server.close();
game.kill('SIGTERM');
console.log('server log lines:', gameLog.split('\n').filter((l) => l.includes('"msg"')).length);
console.log('saved to', out);
if (errors.length) { console.error('errors:\n' + errors.join('\n')); process.exit(1); }
