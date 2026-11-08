# QA ตัวละครและการแสดงข้อมูล (branch claude/exciting-clarke-fu97gf, HEAD c6c0db8)

วันที่ 2026-11-08 · ขอบเขต: ตัวละครทั้ง 59 ใบ (สไปรต์ การ์ด ตัวบนสนาม) และข้อความ/ตัวเลขที่แสดงเทียบกับ `docs/data/*.json` และค่าที่ sim ใช้จริง · เอกสารนี้หาและพิสูจน์บั๊กเท่านั้น ยังไม่ได้แก้โค้ด

## สรุป

- **P0 2 ข้อ · P1 8 ข้อ · P2 10 ข้อ** (รวม 20)
- ตัวละครทั้ง 59 ใบ **ไม่มีสไปรต์บนสนามเลย (0/59)** และมีภาพการ์ดแค่ **1/59** (`crimson_phoenix_striker`) ที่เหลือเป็นภาพวาดด้วยโค้ดชั่วคราว (procedural) ที่หน้าตาซ้ำกัน: 59 ใบมี portrait ต่างกันแค่ **50 แบบ** มีกลุ่มที่เหมือนกันทุกพิกเซล 4 กลุ่ม (รวม 13 ใบ)
- ค่า HP/ตี ที่ tooltip ในศึกและหน้าจัดทัพแสดง **ไม่ตรงกับที่ sim ใช้จริง 63/63 ตัวที่ลง** ในศึกทั่วไป/ศึกปราบ (แสดงค่าฐาน แต่ sim คิดเลเวล อุปกรณ์ และสกิล)
- ข้อความในหน้าจอทั้งหมดที่สแกน (tooltip 58 ใบ, บันทึกการ์ด, ร้านไข่, ค่ายฝึก, จัดทัพ, ปะทะ, บรีฟด่าน, หน้าแรก, เลือกสำนัก) **ไม่มี undefined / NaN / null / id อังกฤษ** และไม่พบชื่อจากนิยายกิมย้ง/โกวเล้ง
- พฤติกรรมใน sim (120 แมตช์บอต): ตัวบินไม่หยุดตีตัวพื้นเอง, ตัวยึดยึดป้อมได้ (534/536 ครั้งที่มีตัวยึดยืนอยู่), ไม่มีตัวไหนหลุดนอกเส้นทาง ส่วนที่ผิดอยู่ที่การวาดและข้อความ ไม่ใช่กฎ

## วิธีทดสอบ (ทำซ้ำได้)

สคริปต์อยู่ใน scratchpad (ไม่ได้ใส่ใน repo): `/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/`

1. `cd packages/client && npx vite --port 5288 --strictPort` (รันค้างไว้)
2. `node /tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/sheet.cjs`: เรนเดอร์ทั้ง 59 ใบด้วยโค้ดเกมจริง (`board.ts` portrait/figure + `Board.render` จริง + `sprites.cardArt`) เป็น contact sheet และ `out/cards.json` (fingerprint ของ portrait)
3. `node /tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/hud.cjs`: เปิด `?mode=battle&deck=<6 ใบ>` 9 รอบ (ครบ 54 ใบที่ไม่ใช่ธง) ด้วยเซฟที่ทุกใบเป็น Lv20 ศึกทั่วไป วางเมาส์ที่การ์ดทุกใบ เก็บข้อความ tooltip แล้วลงทุกใบ (เติมปราณ) อ่าน HP/ตี ที่ sim ใช้จริงจาก `window.__game.s.units`
4. `node /tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/screens.cjs`: หน้าแรก, เลือกสำนัก, ล็อบบี้, บันทึกการ์ด, ร้านไข่, ค่ายฝึก (Lv30), จัดทัพ (ทั่วไป/ฝีมือ), ปะทะ, บรีฟด่าน 1-10 และสแกนข้อความทุกหน้า
5. `node /tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/fx.cjs`: เงาตอนตายและเงาเล็งของตัวใหญ่ + บอตสู้บอต x4
6. `npx vite-node /tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/behave.ts` (จาก root repo): บอต 120 แมตช์ผ่าน sim จริง ตรวจพฤติกรรมตามคำบรรยาย

ภาพหลักฐานทั้งหมดอยู่ที่ `/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/`

---

## P0

### P0-1 ไม่มีสไปรต์ตัวละครเลย: ทุกใบเป็นภาพชั่วคราววาดด้วยโค้ด
- **หลักฐาน**: `packages/client/public/sprites/manifest.json` = `{"board": {}, "card": ["crimson_phoenix_striker"]}` และ `public/sprites/card/` มีไฟล์เดียว แต่ `art/pixellab.json` วางแผนตัวละคร (character 96px) และการ์ด (128px) ไว้ครบ 59 ใบ แปลว่ายังไม่ได้รันหรือรันไม่จบ (`npm run art:pixellab`)
- ผลคือ `boardSprite()` คืน null ทุกใบ บนสนามจึงใช้ `drawFigure`/`drawBeast` (`board.ts:705-827`) ตลอด ศิษย์ทุกคนเป็นตุ๊กตาแบบเดียวกัน (หมวกดำ ชุดสีสำนัก) ต่างกันแค่ของในมือ 1-3 พิกเซล
- **ภาพ**: `/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/contact-sheet-59.png` (คอลัมน์: การ์ดอาร์ต | portrait ฝั่งเรา | ฝั่งศัตรู | บนสนามฝั่งเรา | บนสนามฝั่งศัตรู)
- **ทำซ้ำ**: เปิดเกม ดูการ์ดใดก็ได้ที่ไม่ใช่ "ศิษย์ขนหงส์เจาะ" จะเห็น "no art" (contact sheet) และในมือเป็นตุ๊กตา procedural
- **ไฟล์**: `public/sprites/manifest.json`, `tools/art/pixellab.mjs` (plan/manifest), `sprites.ts:34-45`

### P0-2 HP/ตี ใน tooltip ในศึกและหน้าจัดทัพแสดงค่าฐาน แต่ sim ใช้ค่าตามเลเวล อุปกรณ์ และสกิล
- **หลักฐาน**: `/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/hud-rows.json`: เซฟ Lv20 ศึกทั่วไป ลงครบ 63 ตัว **ไม่ตรงทั้ง 63** เช่น
  - `golden_lion` (แม่ทัพ): tooltip HP 1725 · ตี 61 → sim HP 3520 · ตี 95 (เลเวล +57% และกายแกร่ง +30%)
  - `vajra_stone_guardian` (แม่ทัพ): 1233/39 → 2515/61
  - `crimson_phoenix_striker`: 267/25 → 419/39
  - `crimson_phoenix_banner`: 120/7 → 188/10
- หน้าจัดทัพก็แสดงค่าฐาน (`HP 1725 · ตี 61`) ขณะที่ค่ายฝึกบอกว่า Lv30 คือ `HP 3225 · ตี 114` สองหน้าจอจึงบอกตัวเลขของการ์ดใบเดียวกันไม่ตรงกัน
- **ภาพ**: `/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/tip-batch0-leader.png` (tooltip หงส์อสูร HP 1680 ทั้งที่ป้าย Lv20), `/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/summoned-batch0.png`, `/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/s07-team-hover-lion.png`
- **ทำซ้ำ**: เซฟที่การ์ด Lv>1 → ศึกทั่วไป → วางเมาส์ที่การ์ดในมือ → เทียบกับ HP ของตัวที่ลง (หรือ `__game.s.units`)
- **ไฟล์**: `battle.ts:66` (`u.hp`/`u.dmg` ควรเป็น `cardStats(u, progress)` บวกสกิล hp), `main.ts:193` (describe ของหน้าจัดทัพ). ศึกฝีมือ (normalized) แสดงถูกเพราะใช้ค่าฐานอยู่แล้ว

## P1

### P1-1 ป้ายขั้น "Lv20 แก่นทอง" ทับหน้าตัวละครในการ์ดบนมือทุกใบ
- `style.css:265` `.card .realm { position:absolute; top:36px }` ตกตรงหน้า/ลำตัวของ portrait (กรอบหน้า 76px)
- **ภาพ**: `/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/zoom-hand.png`, `/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/bot-frame-3.png` · ทำซ้ำ: ศึกทั่วไปหรือศึกปราบ (ศึกฝีมือไม่มีป้ายจึงไม่เห็น)

### P1-2 หน้าจัดทัพ (โหมดหลายใบ) ตัดภาพเหลือแค่หมวก ดูไม่ออกว่าตัวไหน
- `style.css:231` `.team-cards.many .team-card .face { height: 44px }` กับ canvas portrait สูง 90px และมีป้ายขั้นซ้อนอีกชั้น
- **ภาพ**: `/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/s07-team-casual.png` (แถวการ์ดเห็นแค่หมวกกับป้าย Lv30) · ค่ายฝึก `style.css:285-287` ก็ตัดภาพเหมือนกัน (`/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/s06-camp.png`)

### P1-3 portrait ซ้ำกันทุกพิกเซล 4 กลุ่ม 13 ใบ และขนาดใหญ่/กลางดูไม่ออกในการ์ด
- fingerprint ใน `/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/cards.json`: 59 ใบมี 50 แบบ
  - `cloud_sword_striker = cloud_sword_burst = cloud_sword_stacker = cloud_sword_elder`
  - `frost_tide_striker = frost_tide_burst = frost_tide_stacker = frost_tide_naga`
  - `vajra_stone_striker = vajra_stone_burst = vajra_stone_guardian`
  - `crimson_phoenix_beast = crimson_phoenix_kite`
- สาเหตุ: `drawFigure` เลือกของในมือจาก move/kit เท่านั้น (`board.ts:723-734`) และ `portrait()` (`board.ts:830-837`) ไม่ขยายตัว large ตัวใหญ่ราคา 7 จึงเหมือนตัวกลางราคา 4 ทั้งในมือ ในบันทึกการ์ด และในร้านไข่

### P1-4 รูปร่างไม่ตรงกับตัวละคร: สัตว์/ยักษ์วาดเป็นคน ตัวขี่ไม่มีพาหนะ และ kind ผิด
- `sects.json` ไม่ได้ใส่ `body` ให้ `crimson_phoenix_beast` (หงส์อสูร), `frost_tide_naga` (นาคา), `jade_bamboo_warden` (ยักษ์ไผ่), `vajra_stone_guardian` (รูปปั้นทวารบาล) จึงตกไปที่ `human` (`data.ts:87`) และวาดเป็นคนตัวโต ส่วนหงส์อสูรมี "ปีก" เป็นขีดเทา 2 ขีด (`board.ts:709`)
- ตัวขี่ (`jade_bamboo_crane`, `vajra_stone_hawk`, `frost_tide_swallow`, `crimson_phoenix_kite`, `cloud_sword_rider`) เป็นคนลอย ไม่มีนก ว่าว หรือกระบี่ใต้เท้า
- `crimson_phoenix_beast` และ `frost_tide_naga` ไม่มี `kind` จึงเป็น "ศิษย์" ตัวกรองชนิด "สัตว์ปีศาจ" ในหน้าจัดทัพจึงไม่แสดงหงส์อสูรเพลิงชาด และ info บอก "หงส์อสูรเพลิงชาด · ศิษย์" (`/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/screen-texts.json` team)
- **ภาพ**: contact sheet แถว 8, 17, 35, 44 และ 9, 18, 27, 36, 45

### P1-5 เงาตอนตายและเงาเล็งของตัวใหญ่ถูกวาดครึ่งขนาด และตัวบินตายบนพื้น
- `board.ts:424` (ghost) และ `board.ts:403` (aim preview) เรียก `figure()` ที่ 1x และไม่บวกความสูงตอนบิน ขณะที่ตัวจริงวาด 2x (`board.ts:613,627`) ตัวใหญ่จึงหดลงครึ่งหนึ่งตอนตาย และตอนเล็งลงก็ดูเป็นตัวเล็ก
- **ภาพ**: `/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/fx-ghost-aim.png` (สิงห์ทองตอนยังอยู่ / เงาตอนตาย / เงาเล็ง)

### P1-6 สกิล (ability) แสดงผิดหรือไม่แสดง
- หน้าจัดทัพใช้ระดับ `แม่ทัพ 3 / รอง 2 / อื่น 1` ตายตัว (`main.ts:192`) ไม่ดู `progression.abilityAt = 30` ที่ sim ใช้ (`battle.ts cardLevel`): เซฟ Lv30 แสดง "สิงห์ทองพิทักษ์ ... **กายแกร่ง Lv1: HP เพิ่ม 10%**" แต่ sim ให้ Lv3 (+30%) (`/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/screen-texts.json` team)
- tooltip ในศึก บันทึกการ์ด ร้านไข่ และค่ายฝึก ไม่แสดงสกิลเลย และ HP ในค่ายฝึกไม่รวมกายแกร่ง (`campScreen.ts:69`)

### P1-7 ไม่มีที่ไหนแสดงคำอธิบายเต็ม (descTh) และร้านไข่ไม่บอกข้อมูลการ์ด
- `descTh` ทั้ง 59 ใบไม่ได้ใช้ใน client (grep ไม่พบ) ผู้เล่นเห็นแค่ `tagTh` บรรทัดเดียว
- ไม่มีที่ไหนแสดงผลเชิงกลไก (ระยะ, ความเร็วตี, ชะลอ/มึน/รัด/ผลัก, เกราะ, ทะลุเกราะ, ไฟ/พิษ)
- ร้านไข่: ไทล์มีแค่ราคา ชื่อ และชั้น ไม่มี HP/ตี/บทบาท/คำอธิบาย และไม่มี tooltip (`collectionView.ts:24-30`; มีแค่บันทึกการ์ดที่ตั้ง `title` = tagTh ที่ `:43`) ผู้เล่นจึงต้องจ่ายแต้มไข่ 35-60 โดยไม่รู้ว่าการ์ดทำอะไร (`/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/s05-egg-shop.png`)

### P1-8 เมื่อสไปรต์มาจริง ขนาดเล็ก/กลาง/ใหญ่จะเท่ากันบนสนาม
- ตัวละครทุกตัวใน `art/pixellab.json` มีขนาด 96 ไม่ว่าการ์ดจะเป็น small หรือ large และ `Board.blit` วาด 1:1 ไม่สนใจ `big` (`board.ts:624-626`) ตอนนี้ยังไม่เห็นเพราะไม่มีสไปรต์ (P0-1) แต่จะเห็นทันทีที่สร้างสไปรต์ (ดราก้อนจะเท่านักธนู) และ HP bar ใช้ `12 * big` ที่ไม่ตรงกับความกว้างสไปรต์

## P2

1. **สีกระสุนตาม kit ไม่ใช่ตามสำนัก** (`board.ts:254`): `crimson_phoenix_control` "พ่นไฟ" แต่ยิงลูกสีฟ้า (kit water), `crimson_phoenix_striker` "ขนหงส์เพลิง" ยิงสีเงิน (kit metal), `crimson_phoenix_stacker` ยิงสีเขียว (kit wood)
2. **ชื่อทัพผิดเมื่อแม่ทัพไม่มีสำนัก** (`decks.ts:13`): ถ้าให้นักธนูพเนจร (sect yinyang) เป็นแม่ทัพจะได้ "ทัพหอกระจกไท่จี๋" ซึ่งเป็นสำนักที่ไม่มีในเกม ส่วนสัตว์เทพ/ปีศาจเป็นแม่ทัพจะได้ชื่อสำนักตามธาตุ เช่น สิงห์ทอง → "ทัพสำนักกระบี่เมฆา"
3. **ตัวหนุน (support) มีบทบาท "บุก"** (`battle.json moves.support.role`): ตัวกรองบทบาทและป้ายในมือเรียกหมอ/สวดมนต์ว่าตัวบุก
4. **descTh อ้างกลไกที่ sim ไม่มี** (ตอนนี้ไม่แสดงในเกม แต่ถ้าเปิดแสดงตาม P1-7 จะผิดทันที): `crimson_phoenix_support`/`jade_bamboo_support` "เร่งตีเร็วขึ้น ส่องตัวล่องหน" (ไม่มีทั้งสองอย่าง; ของไฟเป็นปลุกใจตีแรงขึ้น ของไม้ไม่มีสกิล), `jade_bamboo_stacker` "พิษลามเมื่อตาย" (ไม่มีใน `battle.ts`), `crimson_phoenix_stacker` "แรงขึ้นตามกฎสำนัก" (ไม่มีกฎสำนักในศึก), `crimson_phoenix_control` "ชะงัก" (มีแค่ชะลอ), `storm_dragon` "ชาไปทั้งตัว" (มีแค่ชะลอ)
5. **เขามังกรลาวาถูกตัด** ใน portrait: หัวอยู่ y=0-3 ของ canvas แต่ `portrait()` เริ่มครอปที่ y=2 (`board.ts:821,837`) (`/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/s01-title.png`)
6. **ชื่อการ์ดในค่ายฝึกถูกตัดท้าย** เช่น "ศิษย์พันกระบี่ร่", "ศิษย์กระบี่ขวาง" (`/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/s06-camp.png`)
7. **สไตล์ภาพปนกัน**: การ์ดอาร์ตใบเดียว (ภาพวาดรายละเอียดสูง) อยู่ข้างตุ๊กตา 8 บิต และล้นกรอบ (`style.css:73`) (`/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/zoom-hand.png`)
8. **ตีกันกระจุกอ่านไม่ออก**: ตอนตีกันที่ป้อม HP bar ตัวเลขดาเมจ และตัวละครสองฝ่ายซ้อนกันหมด (`/tmp/claude-0/-home-user-TD-Games-Idel/84142eea-8b64-561d-9be0-1ffc9e119210/scratchpad/qa-chars/out/bot-frame-3.png`) `spot()` กระจายตำแหน่งแค่ ±6/±4 หน่วย (`board.ts:173-175`)
9. **มังกรเมฆอัสนี (`storm_dragon`, ตัวบิน) ทำดาเมจวงกว้างโดนตัวพื้น 163 ครั้งใน 120 แมตช์**: ข้อความ "ข้ามแนวพื้น" และกฎ "ตัวบินหยุดสู้เฉพาะตัวบิน" ทำให้ผู้เล่นเข้าใจว่าตีตัวพื้นไม่ได้ (splash ใน sim ตีทุกตัวที่ตีได้รอบเป้า) ควรตัดสินใจว่าตั้งใจหรือไม่ แล้วเขียนข้อความให้ตรง
10. **ตัวสกัดถูกผลักไกลเกิน leash** (`jade_bamboo_control` ห่างจุดลง 5.14 ช่อง, leash 4): น่าจะเกิดจากการผลักของคลื่น/ปืนใหญ่ เป็นข้อสังเกต ไม่ใช่บั๊กชัด

## สิ่งที่ตรวจแล้วถูกต้อง
- ชื่อไทย ราคา บทบาท ขนาด จำนวนครั้งที่ลงได้ (`perMatch`) และ ▲▼ (counters/classesOf) ใน tooltip ตรงกับ `sects.json`/`battle.json` ครบ 58 ใบที่ตรวจ (ยกเว้น HP/ตี ตาม P0-2)
- สีขอบการ์ด = สีสำนักใน `sects.json`; ศัตรูหันซ้ายและสีขอบแดง; ตัวบินลอยสูงจากเงา 8 หน่วย
- ตัวบินไม่เคยหยุดตีตัวพื้นเอง (0 ครั้ง ยกเว้น splash ตาม P2-9), ตัวที่ตีอากาศไม่ได้ไม่เคยตีตัวบิน, ไม่มีตัวไหนหลุดนอกเส้นทาง, การยึดป้อม 534/536 ครั้งมีตัวยึดอยู่ (อีก 2 ครั้งตัวยึดน่าจะตายในเทิกเดียวกัน)
- ไฟ/พิษ/มึน/ภูมิต้านการควบคุม มีเครื่องหมายบนหัว (`board.ts:637-652`)
- ไม่มี undefined/NaN/id อังกฤษ/ชื่อจากนิยาย ในข้อความที่สแกน

## ตารางการ์ดทั้ง 59 ใบ

"procedural" = วาดด้วยโค้ดใน `board.ts` ไม่มีไฟล์สไปรต์ ทุกใบไม่มีสไปรต์บนสนาม (`sprites/board/<id>/*.png`)

| # | card id | ชื่อไทย | sect/size/move/body | สไปรต์ที่ใช้จริง (board / card) | ปัญหา |
|---|---|---|---|---|---|
| 1 | `crimson_phoenix_striker` | ศิษย์ขนหงส์เจาะ | fire/medium/march/human | procedural `drawFigure` (human) / `sprites/card/crimson_phoenix_striker.png` | ไม่มีสไปรต์ PixelLab; มีการ์ดอาร์ต (สไตล์ต่างจากตัวอื่น) แต่ไม่มีสไปรต์บนสนาม; กระสุนสีเงิน (kit metal) |
| 2 | `crimson_phoenix_burst` | ศิษย์พัดเพลิง | fire/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 3 | `crimson_phoenix_control` | ศิษย์กำแพงเพลิง | fire/medium/guard/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; "พ่นไฟ" แต่กระสุนสีฟ้า (kit water) |
| 4 | `crimson_phoenix_stacker` | ศิษย์ถ่านเพลิง | fire/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 5 | `crimson_phoenix_support` | ศิษย์เตาหลอม | fire/medium/support/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 6 | `crimson_phoenix_banner` | ศิษย์ถือธงเพลิง | fire/small/capture/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 7 | `crimson_phoenix_blade` | ศิษย์กระบี่ถ่านแดง | fire/small/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 8 | `crimson_phoenix_beast` | หงส์อสูรเพลิงชาด | fire/large/fly/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; หงส์อสูรแต่วาดเป็นคนใส่ชุดแดงตัวโต + ปีกเทา 2 ขีด; kind=ศิษย์; portrait ซ้ำกับ crimson_phoenix_kite |
| 9 | `crimson_phoenix_kite` | ศิษย์ว่าวเพลิง | fire/medium/fly/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; ว่าวเพลิงไม่มีว่าว; portrait ซ้ำกับ crimson_phoenix_beast |
| 10 | `jade_bamboo_striker` | ศิษย์ลูกดอกเป่า | wood/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 11 | `jade_bamboo_burst` | ศิษย์ใบไผ่ปลิว | wood/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 12 | `jade_bamboo_control` | ศิษย์เถาวัลย์ | wood/medium/guard/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 13 | `jade_bamboo_stacker` | ศิษย์ขลุ่ยพิษ | wood/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 14 | `jade_bamboo_support` | ศิษย์หมอยาหุบไผ่ | wood/medium/support/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 15 | `jade_bamboo_banner` | ศิษย์ถือธงไผ่ | wood/small/capture/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 16 | `jade_bamboo_blade` | ศิษย์กระบี่ใบหนาม | wood/small/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 17 | `jade_bamboo_warden` | ผู้พิทักษ์ไผ่พันปี | wood/large/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; ยักษ์ไผ่แต่วาดเป็นคนชุดเขียว |
| 18 | `jade_bamboo_crane` | ศิษย์ขี่กระเรียนหยก | wood/medium/fly/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; ขี่กระเรียนแต่ไม่มีกระเรียน (คน + ปีก 2 ขีด) |
| 19 | `cloud_sword_banner` | ศิษย์ถือธงเมฆา | metal/small/capture/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 20 | `cloud_sword_blade` | ศิษย์กระบี่ฝึกหัด | metal/small/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 21 | `cloud_sword_striker` | ศิษย์ปราณกระบี่ | metal/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; portrait ซ้ำกับ cloud_sword_burst, cloud_sword_stacker, cloud_sword_elder |
| 22 | `cloud_sword_burst` | ศิษย์พันกระบี่ร่วง | metal/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; portrait ซ้ำกับ cloud_sword_striker, cloud_sword_stacker, cloud_sword_elder |
| 23 | `cloud_sword_control` | ศิษย์กระบี่ขวางทาง | metal/medium/guard/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 24 | `cloud_sword_stacker` | ศิษย์กระบี่ประหาร | metal/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; portrait ซ้ำกับ cloud_sword_striker, cloud_sword_burst, cloud_sword_elder |
| 25 | `cloud_sword_support` | ศิษย์ลับกระบี่ | metal/medium/support/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 26 | `cloud_sword_elder` | ผู้อาวุโสกระบี่ผ่าฟ้า | metal/large/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; ตัวใหญ่แต่ portrait เหมือน striker/burst/stacker; portrait ซ้ำกับ cloud_sword_striker, cloud_sword_burst, cloud_sword_stacker |
| 27 | `cloud_sword_rider` | ศิษย์เหินกระบี่ | metal/medium/fly/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; ยืนบนกระบี่แต่ไม่มีกระบี่ใต้เท้า |
| 28 | `frost_tide_banner` | ศิษย์ถือธงธารา | water/small/capture/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 29 | `frost_tide_blade` | ศิษย์กระบี่น้ำค้างแข็ง | water/small/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 30 | `frost_tide_striker` | ศิษย์ฝ่ามือเหมันต์ | water/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; portrait ซ้ำกับ frost_tide_burst, frost_tide_stacker, frost_tide_naga |
| 31 | `frost_tide_burst` | ศิษย์ระลอกคลื่น | water/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; portrait ซ้ำกับ frost_tide_striker, frost_tide_stacker, frost_tide_naga |
| 32 | `frost_tide_control` | ศิษย์ม่านวารี | water/medium/guard/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 33 | `frost_tide_stacker` | ศิษย์บัวน้ำแข็ง | water/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; portrait ซ้ำกับ frost_tide_striker, frost_tide_burst, frost_tide_naga |
| 34 | `frost_tide_support` | ศิษย์หมอน้ำพุ | water/medium/support/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 35 | `frost_tide_naga` | นาคาธาราเหมันต์ | water/large/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; นาคาแต่วาดเป็นคน; kind=ศิษย์; portrait ซ้ำกับ frost_tide_striker, frost_tide_burst, frost_tide_stacker |
| 36 | `frost_tide_swallow` | ศิษย์เหินนางแอ่นหมอก | water/medium/fly/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; ขี่นางแอ่นแต่ไม่มีนก |
| 37 | `vajra_stone_banner` | ศิษย์ถือธงศิลา | earth/small/capture/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 38 | `vajra_stone_blade` | ศิษย์พลองหินฝึกหัด | earth/small/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 39 | `vajra_stone_striker` | ศิษย์ฝ่ามือวัชระ | earth/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; portrait ซ้ำกับ vajra_stone_burst, vajra_stone_guardian |
| 40 | `vajra_stone_burst` | ศิษย์พลองสะท้านภู | earth/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; portrait ซ้ำกับ vajra_stone_striker, vajra_stone_guardian |
| 41 | `vajra_stone_control` | ศิษย์ระฆังทอง | earth/medium/guard/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 42 | `vajra_stone_stacker` | ศิษย์กายเหล็ก | earth/medium/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 43 | `vajra_stone_support` | ศิษย์สวดมนต์ | earth/medium/support/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 44 | `vajra_stone_guardian` | ทวารบาลศิลา | earth/large/march/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; รูปปั้นทวารบาลแต่วาดเป็นคน; portrait ซ้ำกับ vajra_stone_striker, vajra_stone_burst |
| 45 | `vajra_stone_hawk` | ศิษย์ขี่เหยี่ยวผา | earth/medium/fly/human | procedural `drawFigure` (human) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; ขี่เหยี่ยวแต่ไม่มีเหยี่ยว |
| 46 | `wandering_archer` | นักธนูพเนจร | yinyang/small/march/archer | procedural `drawFigure` (archer) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 47 | `ember_imp` | ภูตไฟจิ๋ว | fire/small/march/imp | procedural `drawBeast` (imp) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 48 | `shade_hound` | สุนัขเงาอสูร | wood/small/march/beast | procedural `drawBeast` (beast) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 49 | `blood_bat` | ค้างคาวโลหิต | water/medium/fly/wing | procedural `drawBeast` (wing) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 50 | `mirage_fox` | จิ้งจอกมายา | wood/medium/guard/beast | procedural `drawBeast` (beast) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 51 | `corpse_puppeteer` | นักเชิดศพ | earth/medium/march/ghoul | procedural `drawFigure` (ghoul) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 52 | `venom_toad` | คางคกพิษยักษ์ | wood/large/guard/mass | procedural `drawBeast` (mass) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 53 | `earth_wyrm` | หนอนมังกรดิน | earth/large/march/serpent | procedural `drawBeast` (serpent) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 54 | `cloud_crane` | กระเรียนเมฆา | metal/medium/fly/wing | procedural `drawBeast` (wing) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 55 | `jade_tortoise` | เต่าหยกค้ำฟ้า | water/large/guard/shell | procedural `drawBeast` (shell) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 56 | `golden_lion` | สิงห์ทองพิทักษ์ | metal/large/march/beast | procedural `drawBeast` (beast) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 57 | `dawn_qilin` | กิเลนอรุณ | earth/large/support/beast | procedural `drawBeast` (beast) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
| 58 | `lava_dragon` | มังกรลาวาศิลา | fire/large/guard/dragon | procedural `drawBeast` (dragon) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab; เขาบนหัวถูกตัดใน portrait |
| 59 | `storm_dragon` | มังกรเมฆอัสนี | water/large/fly/dragon | procedural `drawBeast` (dragon) / procedural `portrait()` | ไม่มีสไปรต์ PixelLab |
