import { GENERATES, OVERCOMES, type Element, type Wuxing } from './data';

const isWuxing = (e: Element): e is Wuxing => e !== 'yinyang';

// Damage multiplier (percent) of an attacker with the given elements against an enemy element.
// Overcoming x1.5, overcome-by x0.7; with two elements the best one counts.
export function overcomePct(attacker: Element[], target: Element): number {
  let best = 0;
  for (const a of attacker) {
    let pct = 100;
    if (isWuxing(a) && isWuxing(target)) {
      if (OVERCOMES[a] === target) pct = 150;
      else if (OVERCOMES[target] === a) pct = 70;
    }
    if (pct > best) best = pct;
  }
  return best;
}

// True if any neighbour element generates any of the disciple's elements (+15% dmg).
export function isGenerated(own: Element[], neighbours: Element[][]): boolean {
  for (const n of neighbours)
    for (const ne of n)
      for (const oe of own) if (isWuxing(ne) && GENERATES[ne] === oe) return true;
  return false;
}
