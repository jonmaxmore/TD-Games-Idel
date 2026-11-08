// บันทึกการ์ด and ร้านไข่ (collection.json, acquisition.md §6-§7), both overlays over the lobby. The log shows every card:
// owned ones in colour, locked ones greyed with the one route that gives them. The egg shop sells a chosen card for its
// tier's egg points (no rotation, no hatch timer) and training eggs for cards already owned.
import { battleCardIds, battleUnits, chapter, routeOf, sects, shopBlock, tierOf, type Route } from '@five-sects/sim';
import { cardTip, el, realmBadge } from './battle';
import { portrait } from './board';
import { account, buyCard, progressOf, SHOP_WHY } from './camp';
import { setupOf } from './decks';
import { teamOf, type Profile } from './profile';
import { cardArt } from './sprites';
import { button, confirmBox, hoverTip, setDisabled } from './ui';
import { nowrapWords } from './words';

const btn = (text: string, cls: string, onclick: () => void) => { const b = el('button', cls, text); b.onclick = onclick; return b; };
const face = (id: string) => { const f = el('span', 'face'); f.append(cardArt(id) ?? portrait(id)); return f; };

export function routeTh(r: Route): string {
  if (r.kind === 'starter') return 'เริ่มเกม (ทุกคน)';
  if (r.kind === 'home') return 'เริ่มเกม (สำนักต้นสังกัด)';
  if (r.kind === 'stage') return `ผ่านด่าน ${r.stage}`;
  if (r.kind === 'stars') return `ดาว${chapter.nameTh.split(' · ')[0]} ครบ ${r.stars}`;
  return `ร้านไข่ ${r.price} แต้ม · ปราสาท Lv${r.castleLevel}`;
}

// A tile shows its card's full tooltip (cardTip, on the player's current team in the lobby's mode: the account's progress in
// ศึกทั่วไป, base stats in ศึกฝีมือ, with a line that says which) while hovered or focused; tip is the .card-tip inside root.
function tile(id: string, cls: string, p: Profile, root: HTMLElement, tip: HTMLElement, line: () => string): HTMLElement {
  const u = battleUnits.get(id)!, t = el('div', `log-card ${cls} kind-${u.kind}`);
  t.dataset.id = id;
  t.tabIndex = 0;
  hoverTip(root, tip, t, () => {
    const ranked = p.mode === 'ranked';
    const ctx = el('p', 'dim small tip-ctx', ranked ? 'ในศึกฝีมือ: ค่าพื้นฐาน ไม่นับเลเวลและอุปกรณ์' : 'ในศึกทั่วไปกับทัพปัจจุบัน');
    return cardTip(id, setupOf(teamOf(p)), ranked ? null : progressOf(p, Date.now()), line(), [ctx]);
  });
  t.style.borderColor = sects.get(u.sect)?.color ?? '#E3B04B';
  t.append(face(id), el('span', 'cost', String(u.mana)), nowrapWords(el('b'), u.nameTh), el('small', 'tier', tierOf(id).nameTh));
  return t;
}

export function cardLog(p: Profile): HTMLElement {
  const box = el('div', 'card-log'), home = p.home!, tip = el('div', 'card-tip deck-tip');
  box.append(el('p', 'dim small', `มีแล้ว ${p.owned.length}/${battleCardIds.length} ใบ · ใบที่ยังไม่มีบอกทางที่จะได้ · ศึกฝีมือใช้การ์ดทุกใบ ไม่ขึ้นกับว่ามีหรือยัง`));
  const grid = el('div', 'log-grid');
  for (const id of battleCardIds) {
    const has = p.owned.includes(id), r = routeOf(id, home), t = tile(id, has ? 'owned' : 'locked', p, box, tip, () => (has ? `มีแล้ว · ${tierOf(id).nameTh}` : `ยังไม่มี · ได้จาก${routeTh(r)}`));
    if (has) t.append(realmBadge(p.cards[id]!.level));
    else {
      t.append(el('span', 'route', routeTh(r)));
      if (r.kind === 'shop' && r.planned) t.append(el('span', 'planned', `ต่อไป: ${r.planned}`));
    }
    grid.append(t);
  }
  box.append(grid, tip);
  return box;
}

export function eggShop(p: Profile, save: () => void, onChange: () => void): HTMLElement {
  const shop = el('div', 'eggs'), tip = el('div', 'card-tip deck-tip');
  let tab: 'new' | 'train' = 'new', msg = '', bad = false, last: string | null = null;
  function show() {
    const a = account(p);
    const tabs = el('div', 'chips');
    for (const [k, name] of [['new', 'การ์ดใหม่'], ['train', 'ไข่ฝึก (ใบที่มีแล้ว)']] as const) {
      const b = btn(name, `chip${tab === k ? ' on' : ''}`, () => { tab = k; show(); });
      b.dataset.tab = k;
      tabs.append(b);
    }
    const cards = battleCardIds.filter((id) => tierOf(id).eggPoints != null && (tab === 'new' ? !p.owned.includes(id) && routeOf(id, p.home!).kind === 'shop' : p.owned.includes(id)));
    const grid = el('div', 'log-grid shop-grid');
    for (const id of cards) {
      const price = tierOf(id).eggPoints!, t = tile(id, 'shop', p, shop, tip, () => `${tierOf(id).nameTh} · ${price} แต้มไข่`), why = shopBlock(a, id);
      const name = battleUnits.get(id)!.nameTh;
      const buy = () => {
        const res = buyCard(p, id);
        if (typeof res === 'string') { msg = res; bad = true; return show(); }
        save(); last = id; bad = false;
        msg = res.xp > 0 ? `${battleUnits.get(id)!.nameTh} ได้แต้มฝึก +${res.xp}` : `ได้ ${battleUnits.get(id)!.nameTh} เข้าทัพแล้ว`;
        show(); onChange();
      };
      // Egg points are slow to earn and a buy cannot be undone, so it is confirmed with its price and what is left.
      const ask = () => confirmBox(shop.closest('.overlay')?.parentElement ?? shop, {
        title: tab === 'new' ? `ซื้อ ${name}?` : `ฝึก ${name}?`,
        body: `ใช้ ${price} แต้มไข่ · เหลือ ${p.eggPoints - price} แต้ม${tab === 'new' ? ' · ได้การ์ดเข้าทัพทันที' : ` · ได้แต้มฝึก +${tierOf(id).dupeXp}`}`,
        yes: tab === 'new' ? `ซื้อ ${price} แต้มไข่` : `ฝึก ${price} แต้มไข่`,
      }, buy);
      const b = button(tab === 'new' ? `ซื้อ ${price} แต้ม` : `ฝึก ${price} แต้ม`, ask, 'secondary', 'sm', 'buy');
      b.dataset.buy = id;
      setDisabled(b, why ? (why === 'castleLevel' ? `ปราสาทต้องถึง Lv${tierOf(id).eggShopFromCastleLevel} · เลื่อนขั้นการ์ดที่ค่ายฝึกเพื่อขึ้นเลเวลปราสาท` : SHOP_WHY[why]!) : null);
      t.append(b);
      if (why) t.append(el('span', 'route', why === 'castleLevel' ? `ปราสาท Lv${tierOf(id).eggShopFromCastleLevel}` : SHOP_WHY[why]!));
      grid.append(t);
    }
    const head = el('p', 'egg-purse', `แต้มไข่ ${p.eggPoints}`), locked = cards.some((id) => shopBlock(a, id) === 'castleLevel');
    shop.replaceChildren(head, el('p', 'dim small', 'เลือกการ์ดที่อยากได้เอง ราคาตามชั้น สามัญ 10 · ชำนาญ 20 · ยอดฝีมือ 35 · ตำนาน 60 ได้ทันที ไม่ต้องรอฟัก และไม่มีหมุนร้าน'), tabs);
    if (locked) shop.append(el('p', 'shop-lock', 'ชั้นที่สูงกว่าเปิดตามเลเวลปราสาท · ปราสาทขึ้นเมื่อเลื่อนขั้นการ์ดที่ค่ายฝึก (ล็อบบี้ → ค่ายฝึก)'));
    if (cards.length === 0) shop.append(el('p', 'dim', tab === 'new' ? 'ซื้อการ์ดในร้านครบแล้ว ใบที่เหลือได้จากด่าน' : 'ยังไม่มีการ์ดให้ฝึก'));
    shop.append(grid);
    if (msg) {
      const got = el('div', 'egg-got');
      if (last && !bad) got.append(face(last));
      got.append(el('span', bad ? 'bad' : '', msg));
      shop.append(got);
    }
    shop.append(el('p', 'dim small', 'แต้มไข่ได้จากเลเวลปราสาท ด่าน และดาวครบบทเท่านั้น ไม่มีขายด้วยเงินจริง'), tip);
  }
  show();
  return shop;
}
