import { describe, expect, it } from 'vitest';
import sectsJson from '../../../docs/data/sects.json';

// A card's descTh/descEn is what the player reads to learn what it does. Each mechanic word must be backed by the data key
// the sim acts on (packages/sim/src/battle.ts), so a line can never promise a slow, a stun or a target the card lacks.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Card = any;
const cards: Card[] = (sectsJson as any).roster.units;
const fly = (c: Card) => c.move === 'fly';
const has = (k: string) => (c: Card) => c[k] != null && c[k] !== 0;

// [what, Thai pattern, English pattern, what the card must have for the words to be true]
const RULES: [string, RegExp, RegExp, (c: Card) => boolean][] = [
  ['slow (capture units walk slowly)', /(?<!เ)ช้า/, /slow/i, (c) => has('slowSec')(c) || c.move === 'capture'],
  ['stun', /มึน|แช่แข็ง/, /stun|freezes/i, has('stunSec')],
  ['root', /ตรึง|รัดขา|อยู่กับที่/, /root|bind/i, has('rootSec')],
  ['push', /ผลัก|ถอย/, /push/i, has('pushTiles')],
  ['burn', /ไฟติด|ติดไฟ|จุดไฟ|เผา|ไฟลุก/, /burn|alight/i, (c) => c.dot === 'burn' || has('groundSec')(c)],
  ['poison', /พิษ/, /poison|venom/i, (c) => c.dot === 'poison'],
  ['stacks', /ซ้อน|ชั้น/, /stack/i, (c) => c.dot != null],
  ['splash', /รอบเป้า|ใส่ฝูง|ทั้งฝูง|รอบข้าง|คลุมทุกตัว/, /within [\d.]+ tile|crowd|all around|over all/i, has('splash')],
  ['crit (metal kit)', /คริ/, /crit/i, (c) => c.kit === 'metal'],
  ['ignores armor', /ไม่สนเกราะ/, /armor does not stop|ignor\w* armor/i, (c) => c.pierce === true],
  ['own armor', /กันดาเมจ/, /takes \d+ off/i, has('armor')],
  ['ground targets only', /เฉพาะตัวบนพื้น/, /ground targets only/i, (c) => c.target === 'ground'],
  ['fights walkers and fliers (fliers stop only for fliers)', /ทั้งตัวเดินและตัวบิน|ทั้งตัวบินและตัวบนพื้น/, /walkers and fliers|fliers and walkers|walking or flying/i,
    (c) => c.target === 'ground+air' && !fly(c)],
  ['stops only for fliers', /เฉพาะตัวบิน/, /only for fliers/i, fly],
  ['guards a spot', /(?:ยืน|นั่ง|นอน)เฝ้า|ขวางทาง/, /holds the spot|guards the road|sits on the road/i, (c) => c.move === 'guard'],
  ['heals', /รักษา/, /heal|mend/i, (c) => c.move === 'support'],
  ['aura', /ตีแรงขึ้น|ปลุกใจ|ลับคม/, /hit harder|lifts its strikes/i, (c) => c.ability?.kind === 'aura'],
  ['ward', /คุ้ม/, /shield/i, (c) => c.ability?.kind === 'ward'],
  ['raise', /ลุกขึ้น/, /\brise/i, has('raisePct')],
  ['captures forts', /ปักธง|ไม่ตีป้อม/, /banner|never strikes forts/i, (c) => c.move === 'capture'],
  ['summons several or mid-line (no card does)', /ทีละหลายตัว|โผล่กลางแนว/, /mid-line|several at once/i, () => false],
];
// Words every card with the key must carry, so the player is never left to guess the rule that surprises most.
const MUST: [string, (c: Card) => boolean, RegExp, RegExp][] = [
  ['a flier says it stops only for fliers', fly, /เฉพาะตัวบิน/, /only for fliers/i],
  ['a support says it heals', (c) => c.move === 'support', /รักษา/, /heal|mend/i],
];
const NUMS = (c: Card) => ['splash', 'slowSec', 'rootSec', 'stunSec', 'pushTiles', 'groundSec', 'armor'].map((k) => c[k]).filter((v) => v != null);

describe('card descriptions match the card data', () => {
  for (const c of cards)
    it(c.id, () => {
      const bad: string[] = [];
      for (const [what, th, en, ok] of RULES) {
        if (th.test(c.descTh) && !ok(c)) bad.push(`descTh says ${what}`);
        if (en.test(c.descEn) && !ok(c)) bad.push(`descEn says ${what}`);
      }
      for (const [what, applies, th, en] of MUST) if (applies(c) && !(th.test(c.descTh) && en.test(c.descEn))) bad.push(what);
      const nums = [...c.descTh.matchAll(/([\d.]+) (?:วินาที|ช่อง|แต้ม)/g), ...c.descEn.matchAll(/([\d.]+) (?:s\b|tiles?\b)|takes (\d+) off/g)]
        .map((m) => Number(m[1] ?? m[2]));
      if (/ครึ่งช่อง|half a tile/.test(c.descTh + c.descEn)) nums.push(0.5);
      for (const n of nums) if (!NUMS(c).includes(n)) bad.push(`number ${n} is none of its splash/slow/root/stun/push/ground/armor values`);
      expect(bad, bad.join('; ')).toEqual([]);
    });
});
