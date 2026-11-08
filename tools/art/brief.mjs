// npm run art:brief — writes one card per art asset to docs/art/assets/<id>.md (+ README.md index) from docs/data.
// Cards are generated: edit the data or this file, never the cards. Design docs that link them: docs/art/*.md
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const data = (f) => JSON.parse(readFileSync(new URL(`docs/data/${f}.json`, root), 'utf8'));

// Art spec v1 (docs/art/art-bible.md). The playable client still runs the older 180x320 board until it is migrated.
export const SPEC_V1 = {
  internal: [360, 640], tile: 32, character: [48, 64], boss: [128, 128], projectile: [16, 16], fx: [64, 64], portrait: [64, 64],
};

const ELEMENT_TH = { metal: 'โลหะ 金', wood: 'ไม้ 木', water: 'น้ำ 水', fire: 'ไฟ 火', earth: 'ดิน 土', yinyang: 'หยินหยาง ☯' };

// How the sprite must read in play (gameplay → visual). Bosses also list phase looks.
const READ = {
  metal: 'สูงโปร่ง กระบี่ชูเหนือหัวเห็นชัดทุกเฟรม (เส้นตั้งยาวคือจุดจำ) ชุดขาวเงินห้ามจมกับพื้นหิมะ ใช้เงาฟ้าเทาแยก',
  wood: 'ผอมกว่าสำนักอื่น ถือขลุ่ยขวางลำตัว (เส้นนอน) ใบหน้าครึ่งซ่อนในผม ท่าโจมตีเป่าขลุ่ยแล้วเข็มพุ่ง',
  water: 'ชุดพลิ้ว ชายผ้า/แพรไหมลอยตามจังหวะ idle ฝ่ามือยื่นไปข้างหน้ามีแสงฟ้าอ่อน ผมสีอ่อนเป็นจุดจำ',
  fire: 'ยืนกว้าง พัดกางเป็นครึ่งวงกลมสีส้มทอง เป็น silhouette กว้างที่สุดในหกสำนัก',
  earth: 'ไหล่กว้าง หัวโล้น พลองยาวเกินความสูงตัว เป็นตัวที่ "หนัก" ที่สุด ท่า idle ทิ้งน้ำหนักลงพื้น',
  yinyang: 'นั่งสมาธิลอยเหนือพื้นเล็กน้อย มีไท่จี๋หมุนลอยเหนือหัว ขาวดำตัดกันแรง ถือแส้ปัดฝุ่น',
};

const swatches = (groups, pal) => groups.map((g) => `**${g}:** ${pal[g].map((c) => `\`${c}\``).join(' ')}`).join('<br>');
const anims = (a) => Object.entries(a).filter(([k]) => k !== 'fps').map(([k, n]) => `${k} ${n}`).join(' · ') + ` @ ${a.fps} fps`;

function card({ id, title, batch, kind, element, rows, mockup, notes }) {
  const head = [
    `# ${title} · \`${id}\``,
    '',
    `> ชุดงาน ${batch} · ${kind} · การ์ดนี้สร้างจาก \`docs/data\` ด้วย \`npm run art:brief\` (อย่าแก้มือ) · สเปกรวมและวิธีส่งงาน: [art-bible](../art-bible.md)`,
    '',
  ];
  const mock = mockup
    ? [`![mockup ${id}](../mockups/${id}.png)`, '', '_mockup นี้บอกแค่ **สัดส่วนและสี** ไม่ใช่สไตล์สุดท้าย ศิลปินออกแบบรายละเอียดเองตาม art-bible_', '']
    : [];
  const table = ['| หัวข้อ | รายละเอียด |', '|---|---|', ...(element ? [`| ธาตุ | ${ELEMENT_TH[element]} |`] : []), ...rows.map(([k, v]) => `| ${k} | ${v} |`), ''];
  const note = notes ? ['## การอ่านภาพในเกม', '', notes, ''] : [];
  return [...head, ...mock, ...table, ...note].join('\n');
}

export function cards() {
  const sects = data('sects'), fx = data('effects'), heroes = data('heroes');
  const pal = fx.render.palette, A = fx.animations;
  const [cw, ch] = SPEC_V1.character, [bw, bh] = SPEC_V1.boss;
  const out = [];
  const deliver = (id, actions) => `\`${id}.aseprite\` + ${Object.keys(actions).filter((k) => k !== 'fps').map((k) => `\`${id}_${k}.png\``).join(', ')}`;

  for (const s of sects.sects) {
    out.push({
      id: s.element, title: `ศิษย์${s.nameTh}`, batch: 1, kind: 'ตัวละคร', element: s.element, mockup: true, notes: READ[s.element],
      rows: [
        ['ชื่อ (EN)', s.name], ['บทบาท', s.role], ['silhouette', s.silhouette], ['อาวุธ', s.weapon],
        ['สีหลัก', `\`${s.color}\``], ['palette', swatches(['shared', s.element], pal)],
        ['ขนาดเฟรม', `${cw}×${ch} (pivot ที่เท้า, หันขวา)`], ['ท่า', anims(A.disciple)],
        ['ขั้นเลเวล (ของประดับเพิ่ม ไม่เปลี่ยนโครง)', s.skills.map((k) => `Lv${k.lvl} ${k.nameTh}: ${k.effect}`).join('<br>')],
        ['ไฟล์ส่ง', deliver(s.element, A.disciple)],
      ],
    });
  }
  for (const [el, f] of Object.entries(fx.sects)) {
    out.push({
      id: `fx-${el}`, title: `เอฟเฟกต์ธาตุ${ELEMENT_TH[el]}`, batch: 3, kind: 'VFX', element: el,
      rows: [
        ['กระสุน', `${f.projectile} (${SPEC_V1.projectile.join('×')})`], ['ตอนโดน', `${f.impact} (${SPEC_V1.fx.join('×')})`],
        ['สถานะบนศัตรู', f.status], ['particle สูงสุด', f.particles], ['palette', swatches(['shared', el], pal)],
        ['ไฟล์ส่ง', `\`fx-${el}.aseprite\` + \`fx-${el}_projectile.png\`, \`fx-${el}_impact.png\`, \`fx-${el}_status.png\``],
      ],
    });
  }
  for (const c of sects.comboTechniques.items) {
    out.push({
      id: `combo-${c.id}`, title: `ยุทธ์ผสาน: ${c.nameTh}`, batch: 6, kind: 'ตัวละครร่างผสาน', element: c.from[0],
      notes: `ร่างผสานของศิษย์ ${c.from.map((e) => ELEMENT_TH[e]).join(' + ')}: ใช้โครงของสำนักแรก เพิ่มสีและของประดับจากสำนักที่สอง`,
      rows: [['ชื่อ (EN)', c.name], ['ผล', c.effect], ['palette', swatches(['shared', ...c.from], pal)], ['ขนาดเฟรม', `${cw}×${ch}`], ['ท่า', anims(A.disciple)]],
    });
  }
  for (const g of sects.grandmasters.items) {
    out.push({
      id: `gm-${g.id}`, title: `ปรมาจารย์: ${g.nameTh}`, batch: 6, kind: 'ตัวละครพิเศษ + cut-in',
      notes: 'มีภาพ cut-in หมึกจีนเต็มจอ 0.8 วิ (ดู vfx-design) และ sprite ในสนามขนาดบอส',
      rows: [['ชื่อ (EN)', g.name], ['รวมจาก', g.from.map((e) => ELEMENT_TH[e]).join(' + ')], ['ผล', g.effect], ['ขนาดเฟรม', `${bw}×${bh} + cut-in 360×200`]],
    });
  }
  for (const h of heroes.heroes) {
    out.push({
      id: h.id, title: `วีรชน: ${h.nameTh}`, batch: 6, kind: `วีรชน ${h.rarity}`, element: h.sect,
      notes: 'sidegrade ของศิษย์สำนักเดียวกัน: โครงตัวและขนาดเท่ากัน ต่างที่ชุด/อาวุธ/ท่าสกิล ห้ามดูแรงกว่าจนผู้เล่นเข้าใจว่าซื้อพลัง',
      rows: [['ชื่อ (EN)', h.name], ['ความต่างในเกม', h.sidegrade], ['palette', swatches(['shared', h.sect], pal)], ['ขนาดเฟรม', `${cw}×${ch} + portrait ${SPEC_V1.portrait.join('×')}`], ['ท่า', anims(A.disciple)]],
    });
  }
  const files = Object.fromEntries(out.map((c) => [`${c.id}.md`, card(c)]));
  const index = ['# การ์ด asset ทั้งหมด', '', '> สร้างด้วย `npm run art:brief` · สเปกและลำดับจ้าง: [art-bible](../art-bible.md)', '',
    '| ชุดงาน | id | ชื่อ | ประเภท | mockup |', '|---|---|---|---|---|',
    ...[...out].sort((a, b) => a.batch - b.batch).map((c) => `| ${c.batch} | [\`${c.id}\`](${c.id}.md) | ${c.title} | ${c.kind} | ${c.mockup ? `[ภาพ](../mockups/${c.id}.png)` : '-'} |`), ''];
  files['README.md'] = index.join('\n');
  return files;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = fileURLToPath(new URL('docs/art/assets/', root));
  mkdirSync(dir, { recursive: true });
  const files = cards();
  for (const [f, md] of Object.entries(files)) writeFileSync(dir + f, md);
  console.log('wrote', Object.keys(files).length, 'files to docs/art/assets');
}
