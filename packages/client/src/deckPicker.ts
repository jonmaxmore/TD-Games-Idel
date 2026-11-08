// The deck picker (SPEC-deck-budget §8, ux-audit T-1..T-5): the seven hand slots (the basic capturer, fixed; the leader;
// the sub; deck.pick chosen cards), the budget and large-card meters with the reason a team cannot start, and the
// collection grid with filters. A click on a card puts it in the first free slot or takes it out; a right-click (or the
// context-menu key) opens a menu to make it the leader or the sub; a click on the leader or sub slot then on a card does the
// same. A card that cannot go in is dimmed and says why. The team screen and the friend room both use it.
import { battle, battleUnits, loanerRoom, sects } from '@five-sects/sim';
import { cardTip, el, realmBadge } from './battle';
import { portrait } from './board';
import { addPick, autoFill, deckPoints, deckProblem, isBasic, isLoaner, largeOf, pickPool, removePick, setRole, spendOf, type DeckRules, type Step, type Team } from './decks';
import { cardArt } from './sprites';
import { button, setDisabled } from './ui';
import { nowrapWords } from './words';

export const kindOf = (c: string) => battle.kinds.get(battleUnits.get(c)!.kind)!;
export const colorOf = (c: string) => sects.get(battleUnits.get(c)!.sect)?.color ?? '#E3B04B';
const roleLine = (c: string) => { const u = battleUnits.get(c)!, m = battle.moves.get(u.move)!; return `${kindOf(c)} · ${m.roleTh}`; };
function abilityText(c: string, level: number): string | null {
  const u = battleUnits.get(c)!;
  if (!u.ability) return null;
  const a = battle.abilities.get(u.ability.kind)!;
  return `${a.nameTh} Lv${level}: ${a.doesTh.replace('{v}', String(u.ability.lv[level - 1]))}`;
}
// The filter bar: one row of chips per key, 'all' first; a card shows when it matches every key.
type Filter = { kind: string; cost: string; role: string };
const FILTERS: { key: keyof Filter; label: string; opts: [string, string][]; test: (c: string, v: string) => boolean }[] = [
  { key: 'kind', label: 'ชนิด', opts: [...battle.kinds], test: (c, v) => battleUnits.get(c)!.kind === v },
  { key: 'cost', label: 'ปราณ', opts: [1, 2, 3, 4, 5, 6, 7].map((n) => [String(n), String(n)]), test: (c, v) => battleUnits.get(c)!.mana === Number(v) },
  { key: 'role', label: 'บทบาท', opts: [['บุก', 'ตัวบุก'], ['สกัด', 'ตัวสกัด']], test: (c, v) => battle.moves.get(battleUnits.get(c)!.move)!.roleTh === v },
];
const TIP_MS = 250;
type Role = 'leader' | 'sub';
const ROLE_TH: Record<Role, string> = { leader: 'แม่ทัพ', sub: 'รองแม่ทัพ' };

export interface PickerOpts {
  rules: DeckRules;
  team: Team;
  level: (c: string) => number | null; // the card level shown on its face; null hides levels (ศึกฝีมือ: every card at base)
  onChange: (t: Team) => void; // after every edit, with the new team
}
export interface Picker { root: HTMLElement; set: (t: Team) => void; problem: () => string | null; dispose: () => void }

export function deckPicker(o: PickerOpts): Picker {
  const r = o.rules, pool = pickPool(r), room = loanerRoom(r.owned);
  let team = o.team, choose: Role | null = null, menu: HTMLElement | null = null, tipTimer = 0;
  const filter: Filter = { kind: '', cost: '', role: '' };
  const root = el('div', 'deck-picker'), top = el('div', 'deck-top'), slots = el('div', 'deck-slots'), meter = el('div', 'panel deck-meter');
  const msg = el('p', 'deck-msg'), bar = el('div', 'filters'), grid = el('div', 'deck-grid'), tip = el('div', 'card-tip deck-tip');
  msg.setAttribute('role', 'status');
  grid.setAttribute('aria-label', 'การ์ดที่เลือกได้');
  top.append(slots, meter);
  root.append(top, msg, bar, grid, tip);

  const say = (text: string, bad = false) => { msg.textContent = text; msg.classList.toggle('bad', bad); };
  const apply = (s: Step) => {
    if ('why' in s) { say(s.why, true); return; }
    team = s.team;
    say('');
    o.onChange(team);
    show();
  };
  const face = (c: string) => { const f = el('span', 'face'); f.append(cardArt(c) ?? portrait(c)); return f; };
  const lvOf = (c: string) => (c === team.leader ? 3 : c === team.sub ? 2 : 1);

  // the tooltip over (or under, near the top) the card the pointer rests on
  const hideTip = () => { clearTimeout(tipTimer); tip.classList.remove('on'); };
  const hover = (node: HTMLElement, c: string) => {
    node.addEventListener('pointerenter', () => {
      clearTimeout(tipTimer);
      tipTimer = window.setTimeout(() => {
        const u = battleUnits.get(c)!, ab = abilityText(c, lvOf(c)), lent = isLoaner(c, r);
        const extra = [el('p', 'tip-pts', `แต้มทัพ ${deckPoints(c)} · ปราณในศึก ${u.mana}${lent ? ' · ใบยืม (Lv1 ไม่ได้แต้มฝึก)' : ''}`), ...(ab ? [nowrapWords(el('p', 'tip-ab'), ab)] : [])];
        tip.replaceChildren(...cardTip(c, u.perMatch == null ? 'ลงได้ไม่จำกัดต่อศึก' : `ลงได้ ${u.perMatch} ครั้งต่อศึก`, extra));
        const box = root.getBoundingClientRect(), k = box.width / root.offsetWidth, n = node.getBoundingClientRect();
        const x = (n.left + n.width / 2 - box.left) / k, above = (n.top - box.top) / k, below = (n.bottom - box.top) / k;
        const up = above > 190;
        tip.classList.toggle('below', !up);
        tip.style.left = `${Math.max(160, Math.min(root.offsetWidth - 160, x))}px`;
        tip.style.top = `${up ? above - 8 : below + 8}px`;
        tip.classList.add('on');
      }, TIP_MS);
    });
    node.addEventListener('pointerleave', hideTip);
  };

  // ---- the menu a right-click opens on a card ----
  const closeMenu = () => { menu?.remove(); menu = null; };
  function openMenu(c: string, x: number, y: number) {
    closeMenu();
    hideTip();
    const m = el('div', 'deck-menu panel');
    m.setAttribute('role', 'menu');
    m.setAttribute('aria-label', battleUnits.get(c)!.nameTh);
    const item = (text: string, s: Step | null, run: () => void) => {
      const b = button(text, () => { closeMenu(); run(); }, 'ghost', 'sm');
      b.setAttribute('role', 'menuitem');
      if (s && 'why' in s) setDisabled(b, s.why);
      m.append(b);
      return b;
    };
    m.append(nowrapWords(el('b'), battleUnits.get(c)!.nameTh));
    for (const role of ['leader', 'sub'] as Role[]) {
      const s = team[role] === c ? { why: `เป็น${ROLE_TH[role]}อยู่แล้ว` } : setRole(team, role, c, r);
      item(`ตั้งเป็น${ROLE_TH[role]}`, s, () => apply(s));
    }
    if (team.picks.includes(c)) item('เอาออกจากทัพ', null, () => apply({ team: removePick(team, c) }));
    else if (c !== team.leader && c !== team.sub) { const s = addPick(team, c, r); item('ใส่ในทัพ', s, () => apply(s)); }
    const box = root.getBoundingClientRect(), k = box.width / root.offsetWidth;
    m.style.left = `${Math.min(root.offsetWidth - 220, (x - box.left) / k)}px`;
    m.style.top = `${Math.min(root.offsetHeight - 170, (y - box.top) / k)}px`;
    root.append(m);
    menu = m;
    m.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  const onDown = (e: PointerEvent) => { if (menu && !menu.contains(e.target as Node)) closeMenu(); };
  // Esc closes the menu, then leaves the leader/sub choice, before the screen's own Esc (a capture listener).
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || (!menu && !choose)) return;
    e.stopImmediatePropagation();
    if (menu) closeMenu(); else { choose = null; say(''); show(); }
  };
  addEventListener('pointerdown', onDown, true);
  addEventListener('keydown', onKey, true);

  const clickCard = (c: string) => {
    if (choose) { const role = choose, s = setRole(team, role, c, r); choose = null; apply(s); if ('why' in s) show(); return; }
    if (team.picks.includes(c)) apply({ team: removePick(team, c) });
    else if (c === team.leader || c === team.sub) say(`ใบนี้เป็น${c === team.leader ? 'แม่ทัพ' : 'รองแม่ทัพ'} · คลิกขวาที่การ์ดอื่นหรือคลิกช่องด้านบนเพื่อเปลี่ยน`);
    else apply(addPick(team, c, r));
  };

  // ---- the seven slots ----
  function slot(label: string, c: string | null, cls: string, onclick: (() => void) | null, why: string): HTMLElement {
    const s = el(onclick ? 'button' : 'div', `deck-slot ${cls}${c ? '' : ' empty'}`);
    if (s instanceof HTMLButtonElement) { s.type = 'button'; s.onclick = onclick; }
    s.title = why;
    s.append(el('span', 'slot-label', label));
    if (!c) { s.append(el('span', 'slot-empty', 'ว่าง')); return s; }
    s.dataset.id = c;
    s.style.borderColor = colorOf(c);
    const lv = o.level(c);
    s.append(face(c), nowrapWords(el('b'), battleUnits.get(c)!.nameTh));
    if (!isBasic(c)) s.append(el('span', 'pts', String(deckPoints(c))));
    if (lv != null && !isLoaner(c, r)) s.append(realmBadge(lv));
    if (isLoaner(c, r)) s.append(el('em', 'loan', 'ยืม'));
    hover(s, c);
    return s;
  }
  const meterRow = (label: string, n: number, max: number, cls: string) => {
    const row = el('div', `meter ${cls}${n > max ? ' over' : ''}`), track = el('span', 'track'), fill = el('span', 'fill');
    fill.style.width = `${Math.min(100, (n / max) * 100)}%`;
    track.append(fill);
    row.append(el('span', 'meter-label', label), el('b', 'meter-num', `${n}/${max}`), track);
    return row;
  };

  const chips = FILTERS.map((f) => {
    const row = el('div', 'chips');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', f.label);
    row.append(el('span', 'chip-label', f.label));
    for (const [v, name] of [['', 'ทั้งหมด'] as [string, string], ...f.opts]) {
      const b = button(name, () => { filter[f.key] = v; show(); }, 'ghost', 'sm', 'chip');
      b.dataset.f = `${f.key}:${v || 'all'}`;
      row.append(b);
    }
    bar.append(row);
    return row;
  });
  const count = el('small', 'count');
  bar.append(count);

  function show() {
    const t = team, basic = battle.hand.basic.get(battleUnits.get(t.leader)?.sect ?? '') ?? null;
    const pickSlots = Array.from({ length: battle.deck.pick }, (_, i) => {
      const c = t.picks[i] ?? null;
      return slot(`ช่อง ${i + 1}`, c, 'pick', c ? () => apply({ team: removePick(team, c) }) : () => say('คลิกการ์ดด้านล่างเพื่อใส่ช่องว่าง'), c ? 'คลิกเพื่อเอาออก' : 'ช่องว่าง');
    });
    const roleSlot = (role: Role) => {
      const s = slot(ROLE_TH[role], t[role], `${role}${choose === role ? ' choosing' : ''}`, () => {
        choose = choose === role ? null : role;
        say(choose ? `เลือก${ROLE_TH[role]}: คลิกการ์ดด้านล่าง (Esc ยกเลิก)` : '');
        show();
      }, `คลิกแล้วเลือกการ์ดด้านล่างเพื่อเปลี่ยน${ROLE_TH[role]}`);
      s.setAttribute('aria-pressed', String(choose === role));
      return s;
    };
    slots.replaceChildren(slot('ยึดป้อม', basic, 'basic', null, 'ธงยึดป้อมของสำนักแม่ทัพ อยู่ในมือให้เองและไม่นับแต้ม'), roleSlot('leader'), roleSlot('sub'), ...pickSlots);

    const problem = deckProblem(t, r), lent = t.picks.filter((c) => isLoaner(c, r)).length;
    const auto = button('จัดให้', () => {
      const next = autoFill(team, r);
      apply(next.picks.length === battle.deck.pick ? { team: next } : { why: 'แม่ทัพคู่นี้จัดมือให้ถูกกติกาไม่ได้ เปลี่ยนแม่ทัพหรือรอง' });
    }, 'secondary', 'sm', 'auto-btn');
    auto.title = 'เลือก 4 ใบที่แต้มสูงสุดที่ยังอยู่ในงบให้';
    const clear = button('ล้างช่องเลือก', () => apply({ team: { ...team, picks: [] } }), 'ghost', 'sm', 'clear-btn');
    setDisabled(clear, t.picks.length === 0 ? 'ยังไม่ได้เลือกการ์ด' : null);
    const status = el('p', `deck-status${problem ? ' bad' : ' ok'}`, problem ?? 'ทัพถูกกติกา พร้อมเข้าศึก');
    status.setAttribute('role', 'status');
    const acts = el('div', 'row meter-acts');
    acts.append(auto, clear);
    meter.replaceChildren(
      meterRow('แต้มทัพ', spendOf(t), r.budget, 'budget'),
      meterRow('ตัวใหญ่', largeOf(t), battle.hand.maxLarge, 'large'),
      ...(room > 0 ? [meterRow('ใบยืม', lent, room, 'loan')] : []),
      status, acts,
    );

    FILTERS.forEach((f, i) => { for (const b of Array.from(chips[i]!.querySelectorAll<HTMLElement>('.chip'))) b.classList.toggle('on', b.dataset.f === `${f.key}:${filter[f.key] || 'all'}`); });
    const shown = pool.filter((c) => FILTERS.every((f) => !filter[f.key] || f.test(c, filter[f.key])));
    count.textContent = `แสดง ${shown.length} จาก ${pool.length} ใบ`;
    grid.replaceChildren(...shown.map((c) => tile(c)));
    if (shown.length === 0) grid.append(el('p', 'dim deck-none', 'ไม่มีการ์ดที่ตรงตัวกรอง กด "ทั้งหมด" เพื่อดูทุกใบ'));
  }
  function tile(c: string): HTMLElement {
    const u = battleUnits.get(c)!, t = team;
    const role = c === t.leader ? 'leader' : c === t.sub ? 'sub' : t.picks.includes(c) ? 'picked' : '';
    // a full hand refuses every card alike (said on the click); only a reason of this card's own dims it
    const blocked = role || choose || t.picks.length >= battle.deck.pick ? null : addPick(t, c, r);
    const why = blocked && 'why' in blocked ? blocked.why : null;
    const b = el('button', `deck-card kind-${u.kind}${role ? ` ${role}` : ''}${why ? ' no-fit' : ''}`);
    b.type = 'button';
    b.dataset.id = c;
    b.style.borderColor = colorOf(c);
    b.setAttribute('aria-pressed', String(role !== ''));
    b.setAttribute('aria-label', `${u.nameTh} แต้มทัพ ${deckPoints(c)}${why ? ` · ${why}` : ''}`);
    b.title = why ?? (role === 'picked' ? 'คลิกเพื่อเอาออก · คลิกขวาตั้งเป็นแม่ทัพหรือรอง' : role ? '' : 'คลิกเพื่อใส่ทัพ · คลิกขวาตั้งเป็นแม่ทัพหรือรอง');
    const lv = o.level(c), lent = isLoaner(c, r);
    b.append(face(c), el('span', 'cost', String(u.mana)), el('span', 'pts', String(deckPoints(c))), nowrapWords(el('b'), u.nameTh), el('small', '', roleLine(c)));
    if (lv != null && !lent) b.append(realmBadge(lv));
    const tag = role === 'leader' ? 'แม่ทัพ' : role === 'sub' ? 'รอง' : role === 'picked' ? 'ในทัพ' : lent ? 'ยืม' : '';
    if (tag) b.append(el('em', lent && !role ? 'loan' : '', tag));
    if (lent && role === 'picked') b.append(el('em', 'loan second', 'ยืม'));
    b.onclick = () => clickCard(c);
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); const n = b.getBoundingClientRect(); openMenu(c, e.clientX || n.left + n.width / 2, e.clientY || n.top + n.height / 2); });
    hover(b, c);
    return b;
  }

  show();
  return {
    root,
    set: (t) => { team = t; choose = null; closeMenu(); say(''); show(); },
    problem: () => deckProblem(team, r),
    dispose: () => { hideTip(); closeMenu(); removeEventListener('pointerdown', onDown, true); removeEventListener('keydown', onKey, true); },
  };
}
