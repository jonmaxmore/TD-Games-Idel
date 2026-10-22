import { SECTS, STAGES, TICK_HZ, TILE, type Element } from './data';
import { LAYOUTS, type AssaultLayout, type Pt } from './layouts';
import { pathLength, pointAt, toMilli, within } from './path';
import { rollPct } from './rng';
import type { AssaultState, Command, Member, SimEvent } from './types';

const PARTY: Element[] = ['metal', 'metal', 'metal'];
const MEMBER_HP = 400;
const SPACING = 600;
const SPEED = 40;
const HALT_RANGE = 2 * TILE;
const ATTACK_RANGE = 2500;
const SKILL_RANGE = 3500;
const SKILL_MULT = 3;
const SKILL_COOLDOWN = 8 * TICK_HZ;
const OUTPOST_COOLDOWN = TICK_HZ;
const PILL_RANGE = 600;
const PILL_HEAL_PCT = 30;
const CRIT_PCT = 15;

const layoutOf = (stageId: string): AssaultLayout => {
  const name = STAGES[stageId]?.layout;
  const l = name ? LAYOUTS[name] : undefined;
  if (!l || l.kind !== 'assault') throw new Error(`stage ${stageId} has no assault layout`);
  return l;
};

const centre = ([x, y]: Pt): Pt => [x * TILE + TILE / 2, y * TILE + TILE / 2];

export function createAssault(stageId: string, seed: number): AssaultState {
  const l = layoutOf(stageId);
  const path = toMilli(l.start);
  const [sx, sy] = path[0]!;
  const members: Member[] = PARTY.map((el, i) => ({
    id: i, el, hp: MEMBER_HP, maxHp: MEMBER_HP, dmg: SECTS[el].dmg, cooldown: SECTS[el].cooldown,
    cd: 0, skillCd: 0, x: sx, y: sy,
  }));
  return {
    kind: 'assault',
    stageId,
    tick: 0,
    rng: seed >>> 0,
    route: null,
    d: 0,
    path,
    pathLen: pathLength(path),
    forkAt: pathLength(path),
    members,
    outposts: l.outposts.map((o, i) => {
      const [x, y] = centre(o.at);
      return { id: i, x, y, hp: o.hp, maxHp: o.hp, dmg: o.dmg, cd: 0, route: o.route };
    }),
    pills: l.pills.map(centre),
    phase: 'moving',
    membersLost: 0,
    stars: null,
  };
}

const alive = (s: AssaultState) => s.members.filter((m) => m.hp > 0);
const activeOutposts = (s: AssaultState) =>
  s.outposts.filter((o) => o.hp > 0 && (o.route === 'any' || o.route === s.route));

function nearestOutpost(s: AssaultState, x: number, y: number, r: number) {
  let best: AssaultState['outposts'][number] | null = null;
  let bestD = Infinity;
  for (const o of activeOutposts(s)) {
    const dd = (o.x - x) ** 2 + (o.y - y) ** 2;
    if (dd <= r * r && dd < bestD) { best = o; bestD = dd; }
  }
  return best;
}

function applyCommand(s: AssaultState, c: Command, ev: SimEvent[]) {
  if (c.t === 'route') {
    if (s.route !== null) return;
    const l = layoutOf(s.stageId);
    s.route = c.choice;
    s.path = toMilli([...l.start, ...(c.choice === 'left' ? l.left : l.right), ...l.end]);
    s.pathLen = pathLength(s.path);
    if (s.phase === 'choosing') s.phase = 'moving';
    return;
  }
  if (c.t === 'skill') {
    const m = s.members[c.member];
    if (!m || m.hp <= 0 || m.skillCd > 0) return;
    const o = nearestOutpost(s, m.x, m.y, SKILL_RANGE);
    if (!o) return;
    const dmg = m.dmg * SKILL_MULT;
    o.hp -= dmg;
    m.skillCd = SKILL_COOLDOWN;
    ev.push({ e: 'outpostHit', member: m.id, outpost: o.id, dmg, skill: true });
    return;
  }
  ev.push({ e: 'error', msg: 'command not valid in assault stage' });
}

function finish(s: AssaultState, won: boolean, ev: SimEvent[]) {
  s.phase = won ? 'won' : 'lost';
  const stage = STAGES[s.stageId]!;
  s.stars = stage.stars.map((key) => {
    if (!won) return false;
    if (key === 'clear') return true;
    if (key === 'no_disciple_down') return s.membersLost === 0;
    if (key === 'under_3min') return s.tick <= 3 * 60 * TICK_HZ;
    return false;
  });
  ev.push({ e: 'end', won, stars: s.stars });
}

export function stepAssault(s: AssaultState, commands: Command[]): SimEvent[] {
  const ev: SimEvent[] = [];
  if (s.phase === 'won' || s.phase === 'lost') return ev;
  for (const c of commands) applyCommand(s, c, ev);

  const [lx, ly] = pointAt(s.path, s.d);
  const blocked = activeOutposts(s).some((o) => within(lx, ly, o.x, o.y, HALT_RANGE));
  if (s.route === null && s.d >= s.forkAt) s.phase = 'choosing';
  else s.phase = blocked ? 'fighting' : 'moving';
  if (s.phase === 'moving') s.d = Math.min(s.pathLen, s.d + SPEED);

  s.members.forEach((m, i) => { [m.x, m.y] = pointAt(s.path, Math.max(0, s.d - i * SPACING)); });

  for (let i = s.pills.length - 1; i >= 0; i--) {
    const p = s.pills[i]!;
    if (within(lx, ly, p[0], p[1], PILL_RANGE)) {
      for (const m of alive(s)) m.hp = Math.min(m.maxHp, m.hp + Math.floor((m.maxHp * PILL_HEAL_PCT) / 100));
      s.pills.splice(i, 1);
      ev.push({ e: 'pill', at: p });
    }
  }

  for (const m of alive(s)) {
    if (m.skillCd > 0) m.skillCd--;
    if (m.cd > 0) { m.cd--; continue; }
    const o = nearestOutpost(s, m.x, m.y, ATTACK_RANGE);
    if (!o) continue;
    const crit = rollPct(s) < CRIT_PCT;
    const dmg = crit ? m.dmg * 2 : m.dmg;
    o.hp -= dmg;
    m.cd = m.cooldown - 1;
    ev.push({ e: 'outpostHit', member: m.id, outpost: o.id, dmg, skill: false });
  }

  for (const o of activeOutposts(s)) {
    if (o.cd > 0) { o.cd--; continue; }
    let target: Member | null = null;
    let bestD = Infinity;
    for (const m of alive(s)) {
      const dd = (o.x - m.x) ** 2 + (o.y - m.y) ** 2;
      if (dd <= ATTACK_RANGE * ATTACK_RANGE && dd < bestD) { target = m; bestD = dd; }
    }
    if (!target) continue;
    target.hp -= o.dmg;
    o.cd = OUTPOST_COOLDOWN - 1;
    ev.push({ e: 'memberHit', outpost: o.id, member: target.id, dmg: o.dmg });
    if (target.hp <= 0) { s.membersLost++; ev.push({ e: 'memberDown', member: target.id }); }
  }

  for (const o of s.outposts) if (o.hp <= 0 && o.maxHp > 0) { ev.push({ e: 'outpostDown', outpost: o.id }); o.maxHp = 0; }

  s.tick++;
  if (alive(s).length === 0) finish(s, false, ev);
  else if (s.route !== null && s.d >= s.pathLen) finish(s, true, ev);
  return ev;
}
