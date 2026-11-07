// Checks docs/data/pve.json (SPEC-core §5, §7) and prints the derived numbers the design docs quote.
//   node tools/economy/check.mjs
// Fails (exit 1) if an item has no source or no sink, names an unknown system, a PvP system feeds PvE power,
// gacha rates do not add to 100, or the economy.json gacha/currencies disagree with pve.json.
import { readFileSync } from 'node:fs';

const read = (f) => JSON.parse(readFileSync(new URL(`../../docs/data/${f}.json`, import.meta.url), 'utf8'));
const P = read('pve');
const E = read('economy');
const errors = [];
const fail = (m) => errors.push(m);

// ---------- items: every source and sink is a known system, none empty ----------
const systems = P.systems;
const powerSinks = new Set(['level_up', 'level_gate', 'hero_star', 'disciple_star', 'enhance', 'enhance_protect', 'skill_level', 'guild_tech']);
for (const it of P.items) {
  if (!it.sources?.length) fail(`${it.id}: no source`);
  if (!it.sinks?.length) fail(`${it.id}: no sink`);
  for (const s of [...(it.sources ?? []), ...(it.sinks ?? [])]) if (!systems[s]) fail(`${it.id}: unknown system ${s}`);
  // Two worlds (ADR 0005): an item earned in PvP must not be spendable on PvE power, and the PvP shop sells cosmetics only.
  const fromPvp = it.sources.some((s) => systems[s]?.world === 'pvp');
  const pvpOnly = it.sources.every((s) => systems[s]?.world === 'pvp');
  if (pvpOnly && it.sinks.some((s) => powerSinks.has(s) || !systems[s]?.cosmeticOnly)) fail(`${it.id}: PvP-earned item reaches a non-cosmetic sink`);
  if (fromPvp && it.sinks.some((s) => powerSinks.has(s))) console.log(`note: ${it.id} is earned partly in PvP and spent on PvE power`);
}
const used = new Set(P.items.flatMap((i) => [...i.sources, ...i.sinks]));
const idle = Object.keys(systems).filter((s) => !used.has(s));
if (idle.length) console.log(`systems no launch item touches (fine if they consume heroes or gear): ${idle.join(', ')}`);

// economy.json currencies must be launch items or explicitly deferred.
const itemIds = new Set(P.items.map((i) => i.id));
const deferred = new Set(P.deferredItems.season1);
for (const c of E.currencies) if (!itemIds.has(c.id) && !deferred.has(c.id)) fail(`economy.json currency ${c.id} is neither a launch item nor deferred`);
for (const [from, o] of Object.entries(P.overflow)) {
  if (from.startsWith('_')) continue;
  if (!itemIds.has(from) || !itemIds.has(o.to)) fail(`overflow ${from} -> ${o.to}: unknown item`);
}

// ---------- enhancement: cost per slot to +20 ----------
const EH = P.enhance;
let prevP = 1, cum = 0, charms = 0;
const rows = [];
for (const L of EH.levels) {
  if (L.p > prevP) fail(`enhance +${L.to}: rate rises`);
  prevP = L.p;
  const G = Math.ceil(2 / L.p);                                     // misses before the guaranteed success
  const tries = L.p === 1 ? 1 : (1 - (1 - L.p) ** G) / L.p;          // expected attempts with pity
  const stones = tries * EH.stonesPerTargetLevel * L.to;
  cum += stones;
  if (L.dropOnFail) charms += tries - 1;                             // one charm per miss keeps the level
  rows.push([L.to, L.p, G, tries, stones, cum]);
}
console.log('\nEnhance (per slot, ward charm on every miss from +16):');
console.log(' to     p   pity   tries   stones   cumulative');
for (const [to, p, G, t, s, c] of rows) if ([5, 10, 15, 16, 18, 20].includes(to))
  console.log(`+${String(to).padEnd(3)} ${p.toFixed(2).padStart(5)} ${String(p === 1 ? '-' : G).padStart(5)} ${t.toFixed(2).padStart(7)} ${s.toFixed(0).padStart(8)} ${c.toFixed(0).padStart(11)}`);
const slots = P.power.gear.slotsPerPosition * P.power.gear.positions;
console.log(`all ${slots} slots to +20: ${Math.round(cum * slots).toLocaleString()} forge stones, ${Math.round(charms * slots)} ward charms`);

// ---------- gacha ----------
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
console.log('\nGacha:');
for (const b of P.gacha.banners) {
  const sum = Object.values(b.rates).reduce((a, x) => a + x, 0);
  if (Math.abs(sum - 100) > 1e-9) fail(`${b.id}: rates add to ${sum}`);
  if (b.spark && b.pity > b.spark) fail(`${b.id}: pity after spark`);
  const p = b.rates.legendary / 100;
  const perLegendary = (1 - (1 - p) ** b.pity) / p;
  let line = `${b.id.padEnd(14)} legendary every ${perLegendary.toFixed(1)} pulls (${(100 / perLegendary).toFixed(2)}% with pity)`;
  if (b.featuredShare > 0) {
    // First featured copy from zero: 50/50 on each legendary, pity resets per legendary, spark at b.spark guarantees it.
    const runs = 20000, got = [];
    for (let r = 0; r < runs; r++) {
      let n = 0, sincePity = 0;
      for (;;) {
        n++; sincePity++;
        if (n >= b.spark) break;
        if (rnd() < p || sincePity >= b.pity) { sincePity = 0; if (rnd() < b.featuredShare) break; }
      }
      got.push(n);
    }
    got.sort((a, c) => a - c);
    const mean = got.reduce((a, x) => a + x, 0) / runs;
    // Long run: spark points never reset on a featured win, so every b.spark pulls add one copy on top.
    let copies = 0, sincePity = 0;
    const longPulls = 2_000_000;
    for (let n = 1; n <= longPulls; n++) {
      sincePity++;
      if (rnd() < p || sincePity >= b.pity) { sincePity = 0; if (rnd() < b.featuredShare) copies++; }
      if (n % b.spark === 0) copies++;
    }
    const thb = (pulls) => Math.round((pulls * b.costSingle) / P.gacha.jadePerTHB);
    line += `\n               featured first copy: mean ${mean.toFixed(1)} pulls (~${thb(mean)} THB), median ${got[runs / 2]}, worst ${b.spark} (~${thb(b.spark)} THB)`;
    line += `\n               featured copies long run: ${(longPulls / copies).toFixed(1)} pulls each (~${thb(longPulls / copies)} THB)`;
  }
  console.log(line);
}
const heroWeekly = P.gacha.banners.find((b) => b.id === 'hero_weekly');
if (E.gacha.costSingle !== heroWeekly.costSingle || E.gacha.costTen !== heroWeekly.costTen) fail('economy.json gacha price differs from pve.json hero_weekly');
if (E.gacha.pity?.legendaryAt !== heroWeekly.pity || E.gacha.spark?.every !== heroWeekly.spark) fail('economy.json pity/spark differ from pve.json hero_weekly');
const freePulls = E.currencies.find((c) => c.id === 'jade').f2pWeekly / heroWeekly.costSingle;
console.log(`free player: ${freePulls.toFixed(0)} pulls a week from jade alone`);

// ---------- power at the launch caps ----------
const pw = P.power;
const level = 1 + pw.level.perLevel * (pw.level.max - 1);
const hero = pw.rarity.legendary * (1 + pw.heroStars.perStar * pw.heroStars.max);
const free = 1 + pw.discipleStars.perStar * pw.discipleStars.max;
const gear = (1 + pw.gear.slotsPerPosition * pw.gear.baseByRarity.legendary * (1 + pw.gear.perEnhanceLevel * 20)) * pw.gear.maxSubstatMult;
const skill = 1 + pw.skill.perLevel * (pw.skill.max - 1);
const guild = 1 + pw.guildTech.perLevel * pw.guildTech.max;
console.log(`\nPvE caps: level x${level.toFixed(2)} · legendary 10* x${hero.toFixed(2)} vs free 5* x${free.toFixed(2)} · gear+20 x${gear.toFixed(2)} · skill x${skill.toFixed(2)} · guild x${guild.toFixed(2)}`);
console.log(`full launch build vs fresh account: x${(level * hero * gear * skill * guild).toFixed(0)}`);

if (errors.length) { console.error('\nFAIL\n' + errors.map((e) => '  ' + e).join('\n')); process.exit(1); }
console.log('\nOK');
