import type { DefendState } from './types';

// Engine-neutral state fingerprint. Unlike hashState (JSON of the whole state), this string has a
// fixed, documented layout so other implementations (e.g. the Unity C# port) can reproduce it exactly:
//   tick|silver|lives|wave|phase|rng|d<id>,<level>,<cd>,<hits>;...|e<id>,<type>,<hp>,<d>,<elite|->,<stunT>,<slowT>,<burnT>,<poison>;...|<cards,>
// Disciples and enemies are listed in state order. Hash = FNV-1a 32-bit over UTF-16 code units, lowercase hex.
export function canonicalString(s: DefendState): string {
  const ds = s.disciples.map((d) => `d${d.id},${d.level},${d.cd},${d.hits};`).join('');
  const es = s.enemies.map((e) => `e${e.id},${e.type},${e.hp},${e.d},${e.elite ?? '-'},${e.stunT},${e.slowT},${e.burnT},${e.poison};`).join('');
  return `${s.tick}|${s.silver}|${s.lives}|${s.wave}|${s.phase}|${s.rng}|${ds}|${es}|${s.cards.join(',')}`;
}

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const canonicalHash = (s: DefendState) => fnv1a(canonicalString(s));
