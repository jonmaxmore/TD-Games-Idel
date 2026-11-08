# ศึกปราบ: ด่าน PvE ทีละด่าน (บท 1–3)

> **เจ้าของตัดสิน 2026-11-08 (ใช้แทนข้อเสนอในเอกสารนี้):** ศึกฝีมือเปิดหลังจบ **บทที่ 1** ไม่ใช่หลัง 3-10 · ไม่มีพลังงาน (stamina) · มีหน้าประชันก่อนศึก ([ui-flow.md](ui-flow.md)) ตัวเลขเวลาและจำนวนการ์ดตอนเปิดศึกฝีมือในเอกสารนี้ต้องคำนวณใหม่


> ส่วนหนึ่งของ [GDD](../GDD.md) · **สถานะ: บทที่ 1 ทำแล้ว** (2026-11-08) 10 ด่านอยู่ใน `docs/data/campaign.json` ตัวเลขที่จูนแล้วต่างจากตาราง §3 (เลเวลศัตรูต่ำลง ปราสาทบอส 120% แทน 150% ปราณผู้เล่น 1-9 และ 1-10 เป็น 16) เหตุผลและผลวัดอยู่ใน [reviews/castle-battle-sects.md](reviews/castle-battle-sects.md) หัวข้อบทที่ 1 แบบ 10 ด่าน บท 2–3 ยังเป็นข้อเสนอ
> **ตอบคำถามเจ้าของ:** "มีระบบ PvE เล่นทีละด่านหรือยัง" **ยังไม่มี** ตอนนี้ PvE มีแค่ศึกทั่วไปกับ AI ที่ใช้ทัพของสำนักถัดไป (`decks.ts > aiTeam`) วิศวกรอีกคนกำลังทำกลไกของบท 1 (ข้อมูลอยู่ใน `docs/data/campaign.json` ที่จะเพิ่ม) เอกสารนี้ออกแบบให้ใช้กับงานนั้นได้ และ §7 บอกสิ่งที่ต้องแก้ในข้อมูลนั้นภายหลัง
> เกี่ยวข้อง: [acquisition.md](acquisition.md) (รางวัลด่านคือเส้นทางได้การ์ด) · [deck-and-realms.md](deck-and-realms.md) §6–§8 · [story.md](story.md) (ชื่อบทและตัวละคร) · [SPEC-castle-battle](../specs/SPEC-castle-battle.md) §9
> **ป้าย:** **[แหล่ง]** · **[คำนวณ]** · **[ความเห็น]** · **NOT FOUND** · **NOT ASSESSED** (ยังไม่ได้วัดด้วย sim)

## 0. สรุปการตัดสินใจ (10 ข้อ)
1. **3 บทแรก บทละ 10 ด่าน** รวม 30 ด่าน ด่านที่ 10 ของทุกบทเป็นบอส
2. **ศึกปราบเป็นทางหลักที่ได้การ์ด** ผ่านครั้งแรกได้การ์ดหรือแต้มไข่ ([acquisition.md](acquisition.md) §6)
3. **หนึ่งด่านสอนหนึ่งเรื่อง** ตามแนว skill atom ของ Dan Cook และด่านก่อนหน้าให้การ์ดที่ด่านถัดไปต้องใช้
4. **บท 1 คือบ้านเกิด** (สำนักที่ผู้เล่นเลือก) สอนกติกาพื้นฐาน 10 อย่าง
5. **บท 2 คือหุบไผ่ในหมอก** (ไม้) สอนสถานะ ตัวสกัด และตัวปรับสนาม (หมอก, จันทร์โลหิต)
6. **บท 3 คือวังน้ำแข็งเหนือ** (น้ำ) สอนการผลัก ความช้า เกราะเทพ มังกร และการเล่นด้วยปราณแบบ PvP ด้วยเหตุนี้จบบท 3 แล้วจึงเปิดศึกฝีมือ
7. **กลไกด่านใช้ชุดที่วิศวกรกำลังทำ:** ปราสาทศัตรูเสียหายหรือเสริม, ศัตรูลงตามเวลาที่เขียนไว้, ปิดปืนใหญ่, ตัวปรับสถานะ (หมอก/จันทร์โลหิต) และ 3 ดาว (ชนะ / ปราสาทเราเหลือ ≥50% / ชนะใน 120 วินาที) มีของใหม่ที่ต้องเพิ่มแค่ 4 อย่าง (§7)
8. **ไม่มีพลังงาน (stamina)** เล่นซ้ำได้ไม่จำกัด รางวัลผ่านครั้งแรกให้ครั้งเดียว ต้นแบบจำกัด 3 ครั้งต่อวันแล้วขายรอบเพิ่มด้วยรูบี **[แหล่ง: TB]** เราไม่ทำ เพราะเป็นการขายการข้ามกำแพงที่ตั้งใจสร้าง (game-design-review §2E) **[ความเห็น]**
9. **ความยากตายตัวและบอกล่วงหน้า:** ไม่มีการปรับความยากตามผู้เล่น (game-design-review §6) แต่ละด่านแสดงเลเวลศัตรูและคะแนนพลังทัพที่แนะนำ ([matchmaking.md](matchmaking.md) §5)
10. **เซิร์ฟเวอร์ต้องยืนยันรีเพลย์ก่อนให้รางวัลผ่านครั้งแรก** เพราะตอนนี้รางวัลคือการ์ด ([matchmaking.md](matchmaking.md) §8)

## 1. PvE ของเกมต้นแบบ (ศึกปราบ 討伐)

| เรื่อง | สิ่งที่พบ | ป้าย |
|---|---|---|
| รูปแบบ | อีเวนต์ราว 1 เดือน เล่นได้ทุกวัน จัดไม่สม่ำเสมอ ปัจจุบันไม่จัดศึกปราบปกติแล้ว เหลือแค่ศึกปราบ SP ตอนคอลแลบหรือมีตัวใหม่ | แหล่ง: [TB], [W] |
| โครงสร้าง | 13 ด่าน บวกด่านแถม ไล่ระดับ 初級 → 中級 → 上級 → 鬼級 → 竜級 → 神級 → 竜神級 → おまけ級 ระดับละ 2 ด่าน (竜神級 1 ด่าน) ด่าน 11–13 กับด่านแถมเพิ่มในวันที่ 8 | แหล่ง: [TB] |
| ผ่านด่าน | ต้องชนะแบบปราสาทแตกเป็นอย่างน้อย ถ้าฆ่าบอสและยึดป้อมครบได้รางวัลมากขึ้น (ดาว ☆1/☆2/☆3) | แหล่ง: [TB], deep §5 |
| จำนวนครั้ง | เล่นฟรีวันละ 3 ครั้ง ทั้งโหมดเดี่ยวและโหมดร่วม จ่าย 100 รูบีเพิ่มได้วันละ 10 ครั้ง ไม่มีพลังงานแบบเกม RPG | แหล่ง: [TB] |
| ลูกอัญเชิญ | เริ่ม 6 ลูก (เล่น 2 คนได้คนละ 3, 3 คนได้คนละ 2) ยึดป้อมแต่ละป้อมครั้งแรกได้ +6 ฟื้น 1 ลูกต่อ 11 วินาที | แหล่ง: [TB] |
| ศัตรู | ศัตรูถูกอัญเชิญทุกครั้งที่ตัวของเราเดินถึงจุดที่กำหนด ใช้ค่าสถานะและแพ้ทางเหมือนตัวปกติ บางตัวต่างจากปกติ | แหล่ง: [TB] |
| คำแนะนำในวิกิ | ยึดป้อมแรกเพื่อเอาลูกอัญเชิญ แล้ววางตัวสกัดใหญ่หน้าปราสาท แล้วค่อย ๆ บุก | แหล่ง: [TB] |
| กลไก | ทรายดูดที่ไหลเป็นช่วง ๆ, หนอนทรายที่ผลักทุกตัว, ต้นไม้ที่ตัวตีป้อมโค่นแล้วล้มทับศัตรู, บ่อที่ตัวเล็กเท่านั้นข้ามได้, ความมืดที่ตะเกียงช่วยให้เห็น, พื้นน้ำแข็ง, ป้อมปลอม, ปืนใหญ่ระยะไกลที่ยิงเป็นรอบ | แหล่ง: [TB], deep §5 |
| รางวัล | ด่านละ 3 ขั้นตามดาว เช่น เหรียญมังกร, CP 100, ตั๋วชุด, รูบี 50, อาหาร ผ่าน 竜神級 ได้หน้าตาชุดหายาก ไม่มีตัวละครเป็นรางวัล | แหล่ง: [TB] |
| ภารกิจเสริม | "ตีเมืองแตกเร็ว" ในด่าน 8/10/12 (เวลาที่ต้องทำกำหนดต่ออีเวนต์) และ "ตีเมืองแตกเฉียดฉิว" (★3 ตอนเหลือเวลา ≤10 วินาที ถ้าเหลือ 0 พอดีได้ ×2) | แหล่ง: [TB] |
| ด่านสอน | "城ドラ入門道場" ศึกปราบสอนเล่น ผ่านครั้งแรกได้รูบีและ CP | แหล่ง: [W] |
| ศึกปราบ SP | ให้ใช้ตัวคอลแลบระหว่างอีเวนต์ รางวัลดีกว่าศึกปราบปกติ (ตั๋วกาชา, รูบี) | แหล่ง: [W], [SD] |
| ห้ามอัญเชิญรอบรูปปั้น | — | NOT FOUND (deep §5) |
| ด่านเนื้อเรื่องถาวรแบบบท | — | NOT FOUND (ต้นแบบมีแต่อีเวนต์) |

**บทเรียนที่เราใช้ [ความเห็น]:**
- **เอามา:**
  - ปราณเริ่มต่ำ แล้วได้เพิ่มเมื่อยึดป้อมครั้งแรก ทำให้ป้อมแรกเป็นเป้าหมายชัด
  - ศัตรูลงเมื่อเราเดินถึงจุดที่กำหนด ซึ่งสอนเรื่องจังหวะได้ดีกว่าการลงตามเวลาอย่างเดียว
  - กลไกสนามทีละอย่าง
  - ดาวที่ผูกกับการยึดป้อมและฆ่าบอส
- **ทำต่าง:**
  - ทำเป็นบทถาวรที่สอนเกม ไม่ใช่อีเวนต์รายเดือน
  - ไม่จำกัดจำนวนครั้ง
  - รางวัลเป็นการ์ด
  - ต้นแบบไม่มีด่านเนื้อเรื่องถาวร ผู้เล่นใหม่จึงต้องไปเรียนในลีก ซึ่งเราไม่ต้องการ

## 2. หลักการออกแบบด่าน
1. **หนึ่งด่าน หนึ่งเรื่องใหม่:** ทุกด่านมีคอลัมน์ "สอน" ข้อเดียว เรื่องอื่นใช้แค่สิ่งที่สอนไปแล้ว
2. **ด่านก่อนหน้าให้เครื่องมือ:** การ์ดที่ด่าน N ให้คือเครื่องมือที่ด่าน N+1 หรือ N+2 ต้องใช้ ด่านจึงออกแบบจากการ์ดที่ผู้เล่นมีแน่นอนได้ ถ้าการ์ดได้จากการสุ่มจะทำแบบนี้ไม่ได้
3. **ตัวแก้มาก่อนตัวที่ถูกแก้:** ก่อนเจอตัวบินมีตัวต้านบินแล้ว ก่อนเจอมังกรมีนักธนูแล้ว ([acquisition.md](acquisition.md) §0 ข้อ 3)
4. **ความยากเป็นคลื่น:** ด่านยาก ตามด้วยด่านพักที่สอนเรื่องใหม่ง่าย ๆ แล้วจบบทด้วยบอส (game-design-review §2G)
5. **ค่อย ๆ เข้าใกล้กติกา PvP:**
   - บท 1 เริ่มปราณ 8–12 และมีโบนัสยึดป้อม
   - บท 2 เริ่ม 20
   - บท 3 ตั้งแต่ 3-4 เริ่ม 30 แบบ PvP (`battle.json > mana.startPvp`) ไม่มีโบนัส
6. **บอกความยากก่อนเข้า:** หน้าด่านแสดงเลเวลศัตรู คะแนนพลังทัพที่แนะนำ การ์ดที่ศัตรูจะลง และกลไกของด่าน (ข้อมูลก่อนตัดสินใจ, SPEC-core)

## 3. บท 1–3

**ความหมายของคอลัมน์:**
- **Lv ศัตรู:** ทุกใบของ AI อยู่เลเวลนี้ ไม่มีอุปกรณ์และเมือง
- **พลังแนะนำ:** คะแนนพลังทัพของ AI = 1000 × (1 + 0.03 × (Lv − 1))² ตามสูตรใน matchmaking.md §5
- **พลังที่คาดว่ามี:** มาจากโมเดลใน acquisition.md §9 **[คำนวณ]**
- **ทั้งหมดเป็นค่าเริ่ม NOT ASSESSED** ต้องจูนด้วยบอทตาม §9
- **ดาว:** ใช้ชุดเดียวกันทุกด่านในบท 1 ตามงานของวิศวกร (★1 ชนะ, ★2 ปราสาทเรา ≥50%, ★3 ชนะใน 120 วินาที) ดาวเฉพาะด่านที่เสนอเพิ่มอยู่ใน §7

### บท 1 บ้านเกิด (สำนักต้นสังกัด) · ศัตรู: โจรภูเขาของราชาโจรร้อยมือ
พลังที่คาดว่ามีตอนเริ่มบท ≈ 1,000 และตอนจบบท ≈ 1,460

| ด่าน | ชื่อ | สอน (skill atom) | กลไก | ศัตรู (สคริปต์) | ปราณเริ่ม / โบนัสป้อม | Lv ศัตรู (พลัง) | ความยาก 1–5 | ได้เมื่อผ่านครั้งแรก |
|---|---|---|---|---|---|---|---|---|
| 1-1 | ธงผืนแรก | ยึดป้อมแล้วเขตอัญเชิญกว้างขึ้น | ปราสาทศัตรู 50%, ปิดปืนใหญ่ | ศิษย์กระบี่ 1 ตัวทุก 30 วินาที | 10 / +5 | 1 (1,000) | 1 | ภูตไฟจิ๋ว |
| 1-2 | ปราณไหล | ปราณฟื้นตามเวลาและเร็วขึ้นช่วงท้าย เก็บปราณก่อนลง | ปิดปืนใหญ่ | ระลอกภูตไฟ 3 ตัว + กระบี่ ที่ 40/80/120 วินาที | 6 / +5 | 1 (1,000) | 1 | ศิษย์ตีวงของบ้าน (`homeRole: burst`) |
| 1-3 | ตั้งด่าน | ตัวสกัดเฝ้าจุดแล้วกลับที่เดิม (`moves.guard`) | ปิดปืนใหญ่ | ศิษย์ฝ่ามือวัชระ 2 ตัว บุกตรงมาที่ 30/60/90/120 วินาที | 10 / +5 | 2 (1,061) | 2 | ศิษย์ซ้อนสถานะของบ้าน (`stacker`) |
| 1-4 | ฝูงภูต | ตัวตีวงต้านฝูง (`counters: swarm`) | ปิดปืนใหญ่ | ภูตไฟจิ๋ว 4 ตัว ทุก 15 วินาที | 10 / +5 | 3 (1,124) | 3 | แต้มไข่ 10 |
| 1-5 | ปืนใหญ่ปราสาท | ยิงปืนใหญ่เองใส่แนวหลังที่บอบบาง | เปิดปืนใหญ่ครั้งแรก | ศิษย์กายเหล็ก (แนวหน้า) + ศิษย์สวดมนต์ (รักษา) อยู่ข้างหลัง | 10 / +5 | 3 (1,124) | 2 | ศิษย์หนุนของบ้าน (`support`) · **เปิดศึกทั่วไป** |
| 1-6 | เงาบนฟ้า | ตัวบินโดนได้เฉพาะตัวต้านบิน | — | ศิษย์ว่าวเพลิง + ค้างคาวโลหิต ที่ 30/70/110 วินาที | 12 / +5 | 4 (1,188) | 3 | ตัวบินของบ้าน (`flier`) |
| 1-7 | ยักษ์ลงเขา | ตัวใหญ่ลงได้ครั้งเดียว และตัวต้านใหญ่ล่ามันได้ | เตือนล่วงหน้า 5 วินาที | สิงห์ทองพิทักษ์ที่ 60 วินาที | 12 / +5 | 4 (1,188) | 3 | แต้มไข่ 10 |
| 1-8 | อ่านทาง | มือเริ่มสุ่ม 4 ใบ, สับมือใหม่, เรืองส้ม/ฟ้าบอกแพ้ทาง | — | AI เล่นเองแบบ paced ด้วยมือผสม | 12 / +5 | 4 (1,188) | 2 | กระเรียนเมฆา |
| 1-9 | ป้อมเหล็ก | ตัวทลายป้อม (`structure`) และชนะแต้มด้วย HP ปราสาท | ปราสาทศัตรู 150% | ศิษย์ระฆังทองเฝ้าป้อมกลาง | 12 / +5 | 5 (1,254) | 4 | แต้มไข่ 10 |
| 1-10 | **บอส: ราชาโจรร้อยมือ** | รวมทุกอย่างของบท | ปราสาทศัตรู 150% | ภูตไฟ 4 ตัวทุก 30 วินาที, สุนัขเงาเป็นฝูง, หนอนมังกรดินที่ 90 วินาที (เตือน 5 วินาที) | 12 / +5 | 6 (1,323) | 5 | **ตัวใหญ่ของบ้าน** (`large`) · ร้านไข่เปิด |

### บท 2 หุบไผ่ในหมอก (ไม้) · ศัตรู: ศิษย์หุบไผ่ที่ไม่ไว้ใจคนนอก และสัตว์ปีศาจในหมอก
พลังที่คาดว่ามีตอนเริ่มบท ≈ 1,460 และตอนจบบท ≈ 1,670

| ด่าน | ชื่อ | สอน | กลไก | ศัตรู (สคริปต์) | ปราณ | Lv ศัตรู (พลัง) | ยาก | ได้ |
|---|---|---|---|---|---|---|---|---|
| 2-1 | หมอกแรก | หมอกลดระยะยิงทุกตัว ตัวยิงไกลได้เปรียบน้อยลง | ตัวปรับ `fog` | ศิษย์กระบี่ใบหนามกับใบไผ่ปลิว | 20 / +5 | 5 (1,254) | 2 | ศิษย์กระบี่ใบหนาม |
| 2-2 | พิษซ้อน | พิษซ้อนชั้นได้ ตัวหนุนรักษาสู้ได้ | — | ศิษย์ขลุ่ยพิษ 3 ตัว + ใบไผ่ปลิว | 20 / +5 | 5 (1,254) | 3 | ศิษย์เถาวัลย์ |
| 2-3 | เถาวัลย์รัด | ตรึงแล้วมีช่วงต้านการคุม (`status.rootImmuneSec`) ส่งตัวยึดเป็นคู่ | — | ศิษย์เถาวัลย์เฝ้าป้อม 1 และ 2 | 20 / +5 | 6 (1,323) | 3 | สุนัขเงาอสูร |
| 2-4 | ล่าธง | ตัวยึดป้อมเป็นเป้าของตัวไล่ตัวยึด (`capture`) ต้องคุ้มกันตัวยึด | — | กระบี่ใบหนามกับสุนัขเงาไล่ธงทุก 20 วินาที | 20 / +5 | 6 (1,323) | 4 | แต้มไข่ 10 |
| 2-5 | จิ้งจอกลวงตา | ตัวสกัดตัวกลางสายบุก (`attacker`) ตัวเล็กและตัวใหญ่ไม่โดนป้ายนี้ และจิ้งจอกแพ้ตัวใหญ่ | — | จิ้งจอกมายา 2 ตัวเฝ้าหน้าป้อม | 20 / +5 | 6 (1,323) | 2 | ศิษย์ลูกดอกเป่า |
| 2-6 | แนวรากไผ่ | ตัวบินข้ามแนวสกัดภาคพื้น | — | ศิษย์เถาวัลย์ 3 ตัวเป็นแนวสกัด ทั้งทัพไม่มีใบที่ตีตัวบินได้ (มีแต่ป้อมกับปราสาท) | 20 / +5 | 7 (1,392) | 3 | จิ้งจอกมายา |
| 2-7 | คืนจันทร์โลหิต | ตั้งรับก่อน แล้วสวนกลับเมื่อปราณฟื้นเร็วช่วงท้าย | ตัวปรับ `blood_moon` (ศัตรูตีแรงขึ้น) | บุกหนักใน 60 วินาทีแรก | 20 / +5 | 7 (1,392) | 4 | ศิษย์ใบไผ่ปลิว |
| 2-8 | สองแม่ทัพ | ความสามารถแม่ทัพ 3 ระดับ (`abilities`) ฆ่าตัวที่ปลุกใจก่อน | — | แม่ทัพศัตรูคือผู้อาวุโสกระบี่ผ่าฟ้า (ปลุกใจระดับ 3) | 20 / +5 | 7 (1,392) | 3 | ศิษย์ขลุ่ยพิษ |
| 2-9 | คางคกยักษ์ | ตัวสกัดใหญ่ ใช้ตัวต้านใหญ่ยิงจากระยะที่ไกลกว่า | — | คางคกพิษยักษ์ลงที่ป้อมกลางตอน 10 วินาที | 20 / +5 | 8 (1,464) | 4 | คางคกพิษยักษ์ |
| 2-10 | **บอส: ศิษย์พี่ซูเฟิง** | รวมเรื่องของบท: ศัตรูใช้กระบี่เมฆาทั้งชุดเหมือนผู้เล่น (ตามจุดหักมุมใน story.md) | `fog` + ปราสาทศัตรู 150% | ผู้พิทักษ์ไผ่พันปีที่ 90 วินาที | 20 / +5 | 9 (1,538) | 5 | **ผู้พิทักษ์ไผ่พันปี** · ร้านไข่เปิดหนุนและตัวบินของไม้ |

### บท 3 วังน้ำแข็งเหนือ (น้ำ) · ศัตรู: นิกายจันทร์โลหิตที่ล้อมวัง
พลังที่คาดว่ามีตอนเริ่มบท ≈ 1,670 และตอนจบบท ≈ 1,910

| ด่าน | ชื่อ | สอน | กลไก | ศัตรู (สคริปต์) | ปราณ | Lv ศัตรู (พลัง) | ยาก | ได้ |
|---|---|---|---|---|---|---|---|---|
| 3-1 | ลมเหนือ | ความช้า (`status.slowPct`) และการเว้นระยะการลง | — | ศิษย์กระบี่น้ำค้างแข็งกับฝ่ามือเหมันต์ | 25 / +5 | 8 (1,464) | 2 | ศิษย์กระบี่น้ำค้างแข็ง |
| 3-2 | คลื่นซัด | การผลักถอย ตัวกลางและตัวใหญ่ไม่ถอย | — | ศิษย์ระลอกคลื่น 2 ตัว | 25 / +5 | 8 (1,464) | 3 | ศิษย์ฝ่ามือเหมันต์ |
| 3-3 | นางแอ่นหมอก | ตัวบินสู้ตัวบิน และตัวต้านบินเป็นชั้น ๆ | — | นางแอ่นหมอก + ค้างคาวโลหิตเป็นระลอก | 25 / +5 | 9 (1,538) | 3 | ค้างคาวโลหิต |
| 3-4 | นาทีสุดท้าย | กติกา PvP เต็ม: ปราณ 30, ฟื้นเร็วขึ้นสามขั้น, ตัดสินด้วยป้อมและปราณ | ไม่มีโบนัสป้อม | AI ตั้งรับจนถึง 120 วินาที แล้วบุกเต็มกำลัง | 30 / 0 | 9 (1,538) | 4 | แต้มไข่ 10 |
| 3-5 | ม่านวารี | จังหวะยึดป้อม (`forts.captureSec`) ตัวสกัดผลักตัวยึดกลับ | — | ศิษย์ม่านวารีเฝ้าป้อม 2 และ 3 | 30 / 0 | 9 (1,538) | 3 | ศิษย์ม่านวารี |
| 3-6 | เกราะเทพ | เกราะเทพลดดาเมจตี แต่ไม่ลดไฟและพิษ (`abilities.ward`) | — | เต่าหยกค้ำฟ้าคุ้มแนวหน้า | 30 / 0 | 10 (1,613) | 4 | ศิษย์ระลอกคลื่น |
| 3-7 | ประตูแตก | ตั้งรับจากเขตประตูเมือง (`homeZoneTiles`) ด้วยตัวสกัดและปืนใหญ่ | **ปราสาทเราเริ่มที่ 60%** (ของใหม่ §7) | บุกเร็วตั้งแต่ 10 วินาที | 30 / 0 | 10 (1,613) | 3 | ศิษย์บัวน้ำแข็ง |
| 3-8 | ศพเดินได้ | ตัวเล็กที่ตายกลายเป็นของศัตรู (`raisePct`) อย่าส่งฝูงไปให้ | — | นักเชิดศพ 2 ตัว | 30 / 0 | 10 (1,613) | 4 | เต่าหยกค้ำฟ้า |
| 3-9 | เงามังกร | นักธนูราคา 1 ปราบมังกร (`counterPct.dragon`) เก็บนักธนูไว้หน้าประตู | เตือนล่วงหน้า 8 วินาที | มังกรเมฆอัสนีที่ 90 วินาที | 30 / 0 | 11 (1,690) | 4 | แต้มไข่ 10 |
| 3-10 | **บอส: แม่ทัพจันทร์โลหิต** | รวมทั้งสามบท | `blood_moon` + ปราสาทศัตรู 150% | นาคาธาราเหมันต์ที่ 60 วินาที, มังกรลาวาศิลาที่ 130 วินาที | 30 / 0 | 12 (1,769) | 5 | **นาคาธาราเหมันต์** · ร้านไข่เปิดหนุนและตัวบินของน้ำ · **เปิดศึกฝีมือ** |

**รางวัลดาวครบบท:** ดู `collection.json > chapterStars` ([acquisition.md](acquisition.md) §11)
- 15 ดาวของแต่ละบทได้แต้มไข่ 10
- 30 ดาว:
  - บท 1 ได้แต้มไข่ 10
  - บท 2 ได้นักเชิดศพ
  - บท 3 ได้มังกรเมฆอัสนี

**ถ้าสำนักต้นสังกัดเป็นไม้หรือน้ำ:** การ์ดของสำนักนั้นในบท 2 หรือ 3 เปลี่ยนเป็นแต้มไข่เท่าราคา ส่วนบอส 2-10 ใช้ทัพของสำนักต้นสังกัดไม่ได้ จึงให้ซูเฟิงใช้ทัพกระบี่เมฆาเสมอ ถ้าผู้เล่นเป็นกระบี่เมฆา ด่านนี้จะเป็นแมตช์กระจก ซึ่งตรงกับเนื้อเรื่องที่เขาเป็นศิษย์พี่ **[ความเห็น]**

## 4. บอส
| บอส | ทำไมยาก | วิธีชนะที่ตั้งใจ | สิ่งที่ห้ามทำ |
|---|---|---|---|
| ราชาโจรร้อยมือ (1-10) | ปราสาท 150% มีฝูงไม่หยุด และมีตัวใหญ่ | ใช้ตัวตีวงกับปืนใหญ่จัดการฝูง และเก็บตัวต้านใหญ่ไว้รอหนอนมังกรดิน | ไม่ต้องใช้การ์ดที่ยังไม่ได้ |
| ศิษย์พี่ซูเฟิง (2-10) | หมอกลดระยะยิง และเขาใช้ทัพครบชุดแบบผู้เล่น | ใช้ตัวบินข้ามแนวสกัด และเก็บตัวต้านใหญ่ไว้รอผู้พิทักษ์ไผ่ | ไม่มีสุ่มที่ทำให้แพ้เอง เพราะ AI ใช้ seed ของด่าน |
| แม่ทัพจันทร์โลหิต (3-10) | ศัตรูตีแรงขึ้น และมีตัวใหญ่สองตัว | ใช้ตัวต้านใหญ่กับนาคา และนักธนูหน้าประตูกับมังกรลาวา | ไม่ต้องมีมังกรเอง |

## 5. เส้นความยาก
- **ในบท:**
  - ด่าน 1–3 ง่าย
  - ด่าน 4 กับ 7 เป็นด่านยากกลางบท
  - ด่าน 5, 8 พัก (สอนเรื่องใหม่ง่าย ๆ)
  - ด่าน 9 ยากก่อนบอส
  - ด่าน 10 เป็นบอส
- **เทียบพลัง:**
  - ด่านปกติ: AI มีพลังราว 85–92% ของพลังที่คาดว่าผู้เล่นมี
  - บอส: ราว 90–93% แต่บวกกลไกปราสาท 150% และการลงตามสคริปต์ **[คำนวณ จากตาราง §3 และ acquisition.md §9]**
- **เป้าที่จะวัด (NOT ASSESSED, §9):**
  - ด่านปกติ: บอทชนะ ≥80%
  - บอส: บอทชนะ 50–70%
  - ★3: บอทได้ 20–40%
  - ผู้เล่นเล่นเฉลี่ย 1.4 / 1.6 / 1.8 ครั้งต่อด่านในบท 1 / 2 / 3 ตามที่โมเดลจังหวะใช้
- **เวลา [คำนวณ]:** บท 1–3 ใช้ราว 3.2 ชั่วโมงที่เล่นจริง (เกือบ 5 วันถ้าเล่นวันละ 40 นาที) และเก็บดาวครบราว 5.6 ชั่วโมง

## 6. เล่นซ้ำและรางวัลซ้ำ
- **เล่นซ้ำ:** ทุกครั้งที่ชนะได้ `matchRewards` เหมือนแมตช์อื่น (แต้มฝึก เหรียญ ทองคำ) จึงใช้ปั๊มเลเวลได้ ไม่มีโบนัสครั้งแรกซ้อน
- **ไม่มีด่านลาดตระเวนแบบ idle:** GDD §5.4 เคยมี แต่เป็นของยุค TD ถ้าจะใช้ต้องออกแบบใหม่บนศึกชิงเมือง และต้องไม่แย่งเวลาจากศึกทั่วไป **[ความเห็น]**

## 7. ใช้กับงานของวิศวกร และสิ่งที่ต้องแก้ใน `campaign.json` ภายหลัง
**ใช้ได้ทันที:** บท 1 ทั้ง 10 ด่านใช้แค่กลไกที่วิศวกรกำลังทำ ได้แก่ ปราสาทศัตรู 50%/150%, ศัตรูลงตามเวลา, ปิดปืนใหญ่ และ 3 ดาวชุดเดียว ยกเว้นข้อ 1 ด้านล่าง

**ต้องเพิ่มหรือแก้ภายหลัง (เรียงตามลำดับที่ต้องใช้):**
1. **ปราณเริ่มและโบนัสป้อมรายด่าน** (`mana.start`, `mana.fortBonus` = ได้เพิ่มเมื่อยึดป้อมแต่ละป้อมครั้งแรก) ต้นแบบใช้แบบนี้ **[แหล่ง: TB]** ถ้ายังไม่มี บท 1 ใช้ `mana.startPvp` 30 ไปก่อน ด่าน 1-2 จะสอนเรื่องปราณได้น้อยลง
2. **รางวัลผ่านครั้งแรก** (`reward`):
   - เป็นการ์ด, `homeRole` (บทบาทของสำนักต้นสังกัด อ่านจาก `collection.json > homeRoleCards`) หรือ `eggPoints`
   - ต้องยืนยันรีเพลย์ก่อนให้
3. **เตือนก่อนศัตรูลง** (`warnSec`) สำหรับตัวใหญ่และมังกร (หลัก "telegraph" ใน game-design-review §2G) ใช้แค่ฝั่ง client ไม่เปลี่ยน sim
4. **ปราสาทของผู้เล่นเริ่มไม่เต็ม** (`playerCastleHpPct`) ใช้ใน 3-7 ตอนนี้วิศวกรทำแค่ปราสาทศัตรู
5. **ศัตรูลงเมื่อเราเดินถึงจุด** (`atDepthPct`) แบบต้นแบบ **[แหล่ง: TB]** ใส่คู่กับ `atSec` ได้ ไม่จำเป็นสำหรับบท 1 แต่ทำให้บท 2–3 สอนเรื่องจังหวะได้ดีขึ้น
6. **ดาวเฉพาะด่าน** (บท 2–3): แทน ★3 "ชนะใน 120 วินาที" ในด่านที่ไม่เกี่ยวกับความเร็ว เช่น
   - 1-1: ชนะเด็ดขาด (ยึดป้อมครบ) ตามดาวของต้นแบบ
   - 1-5: ยิงปืนใหญ่โดน ≥4 ตัว
   - 2-4: ธงไม่ตายเลย
   - 3-4: ชนะแต้ม
   - 3-9: ฆ่ามังกรด้วยนักธนู
7. **AI ของด่านต้องอยู่ใน `packages/sim`** ตอนนี้บอท paced อยู่ใน `packages/sim/test/battleBot.ts` เซิร์ฟเวอร์จึงยังรันซ้ำไม่ได้ ต้องย้ายเป็นโค้ดใน sim (deterministic) พร้อม golden ต่อด่าน
8. **ตัวปรับสนาม 2 แบบ** (`modifiers`):
   - `fog`: ระยะยิงทุกตัว 70% และภาพมืดเกินระยะ
   - `blood_moon`: ศัตรูตีแรง 120%
   - ถ้าวิศวกรตั้งค่าไว้แล้ว ให้ใช้ค่าของวิศวกร

## 8. บล็อก JSON ที่เสนอสำหรับ `docs/data/campaign.json`
- **ชื่อคีย์:** ถ้าวิศวกรตั้งชื่อคีย์ไว้แล้ว ให้ใช้ชื่อของวิศวกร ส่วนตัวเลขกับรางวัลให้ยึดตามบล็อกนี้
- **`enemy`:**
  - ใส่ `leader` กับ `sub` และใส่ใบอื่นใน `cards` (กองสุ่มของ AI)
  - ด่านที่มีแค่ `cards` ใช้มือตายตัว (`fixedHand`)
- **`script`:** ศัตรูลงฟรีเพิ่มจากที่ AI เล่นเอง
  - `atSec` = วินาทีแรกที่ลง, `everySec` = ลงซ้ำทุกกี่วินาที, `count` = จำนวนตัวต่อครั้ง

```json
{
  "_notes": "Campaign ศึกปราบ chapters 1-3 (docs/design/pve-campaign.md). enemyLevel: every AI card's level (no forge, no town). mana: start and fortBonus (mana gained on each fort's first capture by the player). cannon false: the player's cannon is off. enemyCastleHpPct / playerCastleHpPct: starting castle HP as % of battle.json castle.hp. modifier: a key of modifiers. enemy: the AI team (leader, sub, cards = its draw pool; cards only = a fixed hand). script: extra free enemy summons at atSec, repeating everySec, count units each, warnSec = client warning before it lands. reward: first clear only, after the server re-runs the replay: card | homeRole (collection.json homeRoleCards of the player's home sect) | eggPoints. stars: battle-result keys, the same three for every stage until per-stage stars land.",
  "stars": ["win", "ownCastleHp50", "winUnder120s"],
  "modifiers": {
    "fog": { "nameTh": "หมอก", "rangePct": 70 },
    "blood_moon": { "nameTh": "จันทร์โลหิต", "side": "enemy", "dmgPct": 120 }
  },
  "chapters": [
    { "id": 1, "nameTh": "บ้านเกิด", "sect": "home", "stages": [
      { "id": "1-1", "nameTh": "ธงผืนแรก", "teaches": "capture", "enemyLevel": 1, "mana": { "start": 10, "fortBonus": 5 }, "cannon": false, "enemyCastleHpPct": 50, "enemy": { "cards": ["vajra_stone_banner", "vajra_stone_blade"] }, "script": [{ "atSec": 20, "everySec": 30, "card": "vajra_stone_blade", "count": 1 }], "reward": { "card": "ember_imp" } },
      { "id": "1-2", "nameTh": "ปราณไหล", "teaches": "manaRegen", "enemyLevel": 1, "mana": { "start": 6, "fortBonus": 5 }, "cannon": false, "enemy": { "cards": ["vajra_stone_banner", "vajra_stone_blade", "ember_imp"] }, "script": [{ "atSec": 40, "everySec": 40, "card": "ember_imp", "count": 3 }, { "atSec": 40, "everySec": 40, "card": "vajra_stone_blade", "count": 1 }], "reward": { "homeRole": "burst" } },
      { "id": "1-3", "nameTh": "ตั้งด่าน", "teaches": "guard", "enemyLevel": 2, "mana": { "start": 10, "fortBonus": 5 }, "cannon": false, "enemy": { "cards": ["vajra_stone_banner", "vajra_stone_blade", "vajra_stone_striker"] }, "script": [{ "atSec": 30, "everySec": 30, "card": "vajra_stone_striker", "count": 2 }], "reward": { "homeRole": "stacker" } },
      { "id": "1-4", "nameTh": "ฝูงภูต", "teaches": "antiSwarm", "enemyLevel": 3, "mana": { "start": 10, "fortBonus": 5 }, "cannon": false, "enemy": { "cards": ["crimson_phoenix_banner", "ember_imp", "crimson_phoenix_blade"] }, "script": [{ "atSec": 15, "everySec": 15, "card": "ember_imp", "count": 4 }], "reward": { "eggPoints": 10 } },
      { "id": "1-5", "nameTh": "ปืนใหญ่ปราสาท", "teaches": "cannon", "enemyLevel": 3, "mana": { "start": 10, "fortBonus": 5 }, "enemy": { "cards": ["vajra_stone_banner", "vajra_stone_stacker", "vajra_stone_support", "vajra_stone_blade"] }, "script": [{ "atSec": 25, "everySec": 35, "card": "vajra_stone_stacker", "count": 1 }, { "atSec": 27, "everySec": 35, "card": "vajra_stone_support", "count": 1 }], "reward": { "homeRole": "support" }, "unlocks": ["casual"] },
      { "id": "1-6", "nameTh": "เงาบนฟ้า", "teaches": "antiAir", "enemyLevel": 4, "mana": { "start": 12, "fortBonus": 5 }, "enemy": { "cards": ["crimson_phoenix_banner", "crimson_phoenix_kite", "blood_bat", "crimson_phoenix_blade"] }, "script": [{ "atSec": 30, "everySec": 40, "card": "crimson_phoenix_kite", "count": 1 }, { "atSec": 30, "everySec": 40, "card": "blood_bat", "count": 1 }], "reward": { "homeRole": "flier" } },
      { "id": "1-7", "nameTh": "ยักษ์ลงเขา", "teaches": "large", "enemyLevel": 4, "mana": { "start": 12, "fortBonus": 5 }, "enemy": { "leader": "golden_lion", "sub": "vajra_stone_striker", "cards": ["vajra_stone_blade", "vajra_stone_control", "shade_hound", "ember_imp"] }, "script": [{ "atSec": 60, "card": "golden_lion", "count": 1, "warnSec": 5 }], "reward": { "eggPoints": 10 } },
      { "id": "1-8", "nameTh": "อ่านทาง", "teaches": "randomHandAndCounters", "enemyLevel": 4, "mana": { "start": 12, "fortBonus": 5 }, "enemy": { "leader": "frost_tide_striker", "sub": "jade_bamboo_control", "cards": ["frost_tide_blade", "frost_tide_burst", "jade_bamboo_blade", "jade_bamboo_stacker", "blood_bat", "shade_hound"] }, "script": [], "reward": { "card": "cloud_crane" } },
      { "id": "1-9", "nameTh": "ป้อมเหล็ก", "teaches": "structure", "enemyLevel": 5, "mana": { "start": 12, "fortBonus": 5 }, "enemyCastleHpPct": 150, "enemy": { "leader": "vajra_stone_control", "sub": "vajra_stone_stacker", "cards": ["vajra_stone_blade", "vajra_stone_striker", "vajra_stone_burst", "shade_hound"] }, "script": [{ "atSec": 5, "card": "vajra_stone_control", "count": 2 }], "reward": { "eggPoints": 10 } },
      { "id": "1-10", "nameTh": "ราชาโจรร้อยมือ", "teaches": "boss", "boss": true, "enemyLevel": 6, "mana": { "start": 12, "fortBonus": 5 }, "enemyCastleHpPct": 150, "enemy": { "leader": "earth_wyrm", "sub": "shade_hound", "cards": ["ember_imp", "vajra_stone_blade", "vajra_stone_control", "crimson_phoenix_kite", "corpse_puppeteer"] }, "script": [{ "atSec": 30, "everySec": 30, "card": "ember_imp", "count": 4 }, { "atSec": 45, "everySec": 45, "card": "shade_hound", "count": 2 }, { "atSec": 90, "card": "earth_wyrm", "count": 1, "warnSec": 5 }], "reward": { "homeRole": "large" } }
    ]},
    { "id": 2, "nameTh": "หุบไผ่ในหมอก", "sect": "wood", "stages": [
      { "id": "2-1", "nameTh": "หมอกแรก", "teaches": "fog", "enemyLevel": 5, "mana": { "start": 20, "fortBonus": 5 }, "modifier": "fog", "enemy": { "leader": "jade_bamboo_burst", "sub": "jade_bamboo_blade", "cards": ["jade_bamboo_control", "jade_bamboo_striker", "shade_hound", "ember_imp"] }, "script": [], "reward": { "card": "jade_bamboo_blade" } },
      { "id": "2-2", "nameTh": "พิษซ้อน", "teaches": "poisonStacks", "enemyLevel": 5, "mana": { "start": 20, "fortBonus": 5 }, "enemy": { "leader": "jade_bamboo_stacker", "sub": "jade_bamboo_burst", "cards": ["jade_bamboo_blade", "jade_bamboo_support", "shade_hound", "jade_bamboo_striker"] }, "script": [{ "atSec": 20, "everySec": 40, "card": "jade_bamboo_stacker", "count": 3 }], "reward": { "card": "jade_bamboo_control" } },
      { "id": "2-3", "nameTh": "เถาวัลย์รัด", "teaches": "rootAndControlResistance", "enemyLevel": 6, "mana": { "start": 20, "fortBonus": 5 }, "enemy": { "leader": "jade_bamboo_control", "sub": "jade_bamboo_blade", "cards": ["jade_bamboo_burst", "jade_bamboo_stacker", "shade_hound", "ember_imp"] }, "script": [{ "atSec": 3, "card": "jade_bamboo_control", "count": 2 }], "reward": { "card": "shade_hound" } },
      { "id": "2-4", "nameTh": "ล่าธง", "teaches": "escortCapturers", "enemyLevel": 6, "mana": { "start": 20, "fortBonus": 5 }, "enemy": { "leader": "shade_hound", "sub": "jade_bamboo_blade", "cards": ["ember_imp", "jade_bamboo_control", "jade_bamboo_burst", "jade_bamboo_striker"] }, "script": [{ "atSec": 20, "everySec": 20, "card": "jade_bamboo_blade", "count": 1 }, { "atSec": 20, "everySec": 20, "card": "shade_hound", "count": 1 }], "reward": { "eggPoints": 10 } },
      { "id": "2-5", "nameTh": "จิ้งจอกลวงตา", "teaches": "attackerCounter", "enemyLevel": 6, "mana": { "start": 20, "fortBonus": 5 }, "enemy": { "leader": "mirage_fox", "sub": "jade_bamboo_stacker", "cards": ["jade_bamboo_blade", "jade_bamboo_burst", "shade_hound", "jade_bamboo_support"] }, "script": [{ "atSec": 5, "card": "mirage_fox", "count": 2 }], "reward": { "card": "jade_bamboo_striker" } },
      { "id": "2-6", "nameTh": "แนวรากไผ่", "teaches": "flyOverGuards", "enemyLevel": 7, "mana": { "start": 20, "fortBonus": 5 }, "enemy": { "leader": "jade_bamboo_control", "sub": "vajra_stone_stacker", "cards": ["jade_bamboo_blade", "vajra_stone_burst", "vajra_stone_striker", "shade_hound"] }, "script": [{ "atSec": 5, "card": "jade_bamboo_control", "count": 1 }, { "atSec": 8, "card": "jade_bamboo_control", "count": 1 }, { "atSec": 11, "card": "jade_bamboo_control", "count": 1 }], "reward": { "card": "mirage_fox" } },
      { "id": "2-7", "nameTh": "คืนจันทร์โลหิต", "teaches": "defendThenCounter", "enemyLevel": 7, "mana": { "start": 20, "fortBonus": 5 }, "modifier": "blood_moon", "enemy": { "leader": "jade_bamboo_burst", "sub": "jade_bamboo_striker", "cards": ["jade_bamboo_blade", "shade_hound", "ember_imp", "jade_bamboo_stacker"] }, "script": [{ "atSec": 10, "everySec": 15, "card": "shade_hound", "count": 2 }], "reward": { "card": "jade_bamboo_burst" } },
      { "id": "2-8", "nameTh": "สองแม่ทัพ", "teaches": "leaderAbility", "enemyLevel": 7, "mana": { "start": 20, "fortBonus": 5 }, "enemy": { "leader": "cloud_sword_elder", "sub": "jade_bamboo_striker", "cards": ["cloud_sword_blade", "jade_bamboo_burst", "jade_bamboo_control", "cloud_sword_burst"] }, "script": [], "reward": { "card": "jade_bamboo_stacker" } },
      { "id": "2-9", "nameTh": "คางคกยักษ์", "teaches": "largeGuard", "enemyLevel": 8, "mana": { "start": 20, "fortBonus": 5 }, "enemy": { "leader": "venom_toad", "sub": "jade_bamboo_stacker", "cards": ["jade_bamboo_blade", "jade_bamboo_burst", "mirage_fox", "shade_hound"] }, "script": [{ "atSec": 10, "card": "venom_toad", "count": 1, "warnSec": 5 }], "reward": { "card": "venom_toad" } },
      { "id": "2-10", "nameTh": "ศิษย์พี่ซูเฟิง", "teaches": "boss", "boss": true, "enemyLevel": 9, "mana": { "start": 20, "fortBonus": 5 }, "modifier": "fog", "enemyCastleHpPct": 150, "enemy": { "leader": "cloud_sword_elder", "sub": "cloud_sword_striker", "cards": ["cloud_sword_blade", "cloud_sword_burst", "cloud_sword_control", "cloud_sword_stacker", "cloud_sword_support", "cloud_sword_rider"] }, "script": [{ "atSec": 90, "card": "jade_bamboo_warden", "count": 1, "warnSec": 5 }], "reward": { "card": "jade_bamboo_warden" } }
    ]},
    { "id": 3, "nameTh": "วังน้ำแข็งเหนือ", "sect": "water", "stages": [
      { "id": "3-1", "nameTh": "ลมเหนือ", "teaches": "slow", "enemyLevel": 8, "mana": { "start": 25, "fortBonus": 5 }, "enemy": { "leader": "frost_tide_striker", "sub": "frost_tide_blade", "cards": ["frost_tide_control", "frost_tide_stacker", "blood_bat", "ember_imp"] }, "script": [], "reward": { "card": "frost_tide_blade" } },
      { "id": "3-2", "nameTh": "คลื่นซัด", "teaches": "pushback", "enemyLevel": 8, "mana": { "start": 25, "fortBonus": 5 }, "enemy": { "leader": "frost_tide_burst", "sub": "frost_tide_striker", "cards": ["frost_tide_blade", "frost_tide_control", "frost_tide_support", "blood_bat"] }, "script": [{ "atSec": 25, "everySec": 45, "card": "frost_tide_burst", "count": 2 }], "reward": { "card": "frost_tide_striker" } },
      { "id": "3-3", "nameTh": "นางแอ่นหมอก", "teaches": "airVsAir", "enemyLevel": 9, "mana": { "start": 25, "fortBonus": 5 }, "enemy": { "leader": "frost_tide_swallow", "sub": "blood_bat", "cards": ["frost_tide_blade", "frost_tide_striker", "frost_tide_control", "cloud_crane"] }, "script": [{ "atSec": 20, "everySec": 30, "card": "frost_tide_swallow", "count": 1 }, { "atSec": 35, "everySec": 30, "card": "blood_bat", "count": 1 }], "reward": { "card": "blood_bat" } },
      { "id": "3-4", "nameTh": "นาทีสุดท้าย", "teaches": "pvpManaAndTiebreak", "enemyLevel": 9, "mana": { "start": 30, "fortBonus": 0 }, "enemy": { "leader": "frost_tide_control", "sub": "frost_tide_striker", "cards": ["frost_tide_blade", "frost_tide_burst", "frost_tide_stacker", "frost_tide_support", "blood_bat"] }, "script": [{ "atSec": 120, "card": "frost_tide_burst", "count": 2 }, { "atSec": 122, "card": "frost_tide_striker", "count": 2 }], "reward": { "eggPoints": 10 } },
      { "id": "3-5", "nameTh": "ม่านวารี", "teaches": "captureTiming", "enemyLevel": 9, "mana": { "start": 30, "fortBonus": 0 }, "enemy": { "leader": "frost_tide_control", "sub": "frost_tide_blade", "cards": ["frost_tide_striker", "frost_tide_burst", "frost_tide_stacker", "blood_bat"] }, "script": [{ "atSec": 3, "card": "frost_tide_control", "count": 2 }], "reward": { "card": "frost_tide_control" } },
      { "id": "3-6", "nameTh": "เกราะเทพ", "teaches": "wardVsDot", "enemyLevel": 10, "mana": { "start": 30, "fortBonus": 0 }, "enemy": { "leader": "jade_tortoise", "sub": "frost_tide_striker", "cards": ["frost_tide_blade", "frost_tide_burst", "frost_tide_stacker", "frost_tide_support"] }, "script": [{ "atSec": 15, "card": "jade_tortoise", "count": 1, "warnSec": 5 }], "reward": { "card": "frost_tide_burst" } },
      { "id": "3-7", "nameTh": "ประตูแตก", "teaches": "gateDefense", "enemyLevel": 10, "mana": { "start": 30, "fortBonus": 0 }, "playerCastleHpPct": 60, "enemy": { "leader": "frost_tide_striker", "sub": "frost_tide_burst", "cards": ["frost_tide_blade", "shade_hound", "ember_imp", "blood_bat"] }, "script": [{ "atSec": 10, "everySec": 20, "card": "shade_hound", "count": 2 }], "reward": { "card": "frost_tide_stacker" } },
      { "id": "3-8", "nameTh": "ศพเดินได้", "teaches": "raise", "enemyLevel": 10, "mana": { "start": 30, "fortBonus": 0 }, "enemy": { "leader": "corpse_puppeteer", "sub": "frost_tide_striker", "cards": ["frost_tide_blade", "frost_tide_control", "ember_imp", "shade_hound"] }, "script": [{ "atSec": 30, "everySec": 50, "card": "corpse_puppeteer", "count": 1 }], "reward": { "card": "jade_tortoise" } },
      { "id": "3-9", "nameTh": "เงามังกร", "teaches": "dragonCounter", "enemyLevel": 11, "mana": { "start": 30, "fortBonus": 0 }, "enemy": { "leader": "frost_tide_striker", "sub": "frost_tide_control", "cards": ["frost_tide_blade", "frost_tide_burst", "frost_tide_swallow", "blood_bat"] }, "script": [{ "atSec": 90, "card": "storm_dragon", "count": 1, "warnSec": 8 }], "reward": { "eggPoints": 10 } },
      { "id": "3-10", "nameTh": "แม่ทัพจันทร์โลหิต", "teaches": "boss", "boss": true, "enemyLevel": 12, "mana": { "start": 30, "fortBonus": 0 }, "modifier": "blood_moon", "enemyCastleHpPct": 150, "enemy": { "leader": "frost_tide_naga", "sub": "frost_tide_striker", "cards": ["frost_tide_blade", "frost_tide_burst", "frost_tide_control", "frost_tide_swallow", "corpse_puppeteer", "blood_bat"] }, "script": [{ "atSec": 60, "card": "frost_tide_naga", "count": 1, "warnSec": 5 }, { "atSec": 130, "card": "lava_dragon", "count": 1, "warnSec": 8 }], "reward": { "card": "frost_tide_naga" }, "unlocks": ["ranked"] }
    ]}
  ]
}
```

## 9. แผนพิสูจน์ด้วย sim (ยังไม่ได้ทำ: NOT ASSESSED)
1. **ผู้เล่นจำลอง:**
   - บอท paced ใช้ "การ์ดที่คาดว่ามีตอนนั้น" จากโมเดลใน acquisition.md §9
   - ใช้เลเวลตามโมเดล ทั้งแม่ทัพ รอง และเลเวลเฉลี่ยของกองสุ่ม
   - รันสำนักต้นสังกัดครบ 5 แบบ
2. **วัดต่อด่าน 400 seed สลับ seed ของ AI:**
   - % ชนะ ต้องได้ตามเป้าใน §5 ช่วงความเชื่อมั่น 95% ที่ ±5 จุดต้องใช้ราว 380 เกม (game-design-review §3)
   - % ★2 และ % ★3
   - เวลาแมตช์เฉลี่ย
3. **ใช้บอทสองแบบ:**
   - บอท paced
   - บอทบุกเร็ว (`rush`) เพื่อดูว่ามีทางชนะทางเดียวที่ข้ามบทเรียนหรือเปล่า
   - ถ้าบอทบุกเร็วผ่าน ★3 ได้ทุกด่าน แปลว่าด่านไม่ได้บังคับให้ใช้เรื่องที่สอน
4. **เทสต์ "บทเรียนจำเป็น":**
   - ถอดการ์ดที่ด่านก่อนหน้าให้ออก แล้ววัดว่า % ชนะลดลงจริง เช่น 1-4 ไม่มีตัวตีวง หรือ 3-9 ไม่มีนักธนู
   - ถ้าไม่ลด แปลว่าด่านไม่ได้สอนสิ่งที่ตั้งใจ
5. **golden:** ทุกด่านมี golden บอทเจอ AI 1 seed (`npm run sim:golden`)
6. **หลัง soft launch:** วัดจำนวนครั้งที่คนจริงเล่นต่อด่านและจุดที่คนเลิกเล่น แล้วปรับแค่ `enemyLevel` กับ `script` ไม่ปรับความยากตามผู้เล่น

## 10. แหล่งข้อมูล
- **[TB]** seesaawiki 討伐イベント — https://seesaawiki.jp/castle_and_dragon/d/討伐イベント (เปิดได้ 2026-11-08)
- **[W]** Wikipedia ภาษาญี่ปุ่น 城とドラゴン — https://ja.wikipedia.org/wiki/城とドラゴン
- **[SD]** sirodora.com หน้าเริ่มต้น — https://sirodora.com/page-20
- **deep §5** — บันทึกวิจัยเชิงลึกของทีม สรุปไว้ใน [reference-castle-battle.md](reference-castle-battle.md) §1b
- **เปิดไม่ได้:** altema.jp (403), dic.pixiv.net (403), megaman.fandom.com (403), castleanddragon.gorillawiki.jp (403) และ YouTube

## 11. คำถามที่เจ้าของต้องตัดสิน
1. **บทละ 10 ด่าน** 3 บทแรกเล่นจบราว 3 ชั่วโมงที่เล่นจริง เร็วไปหรือช้าไป (เกมต้นแบบมี 13 ด่านต่ออีเวนต์)
2. **ไม่มีพลังงานหรือจำกัดรอบ** ตกลงไหม (ต้นแบบจำกัด 3 รอบต่อวันแล้วขายรอบเพิ่ม)
3. **เปิดศึกฝีมือหลังผ่าน 3-10** หรือให้เปิดเร็วกว่านั้น
4. **บอส 2-10 คือซูเฟิงซึ่งใช้ทัพกระบี่เมฆา** ตามเนื้อเรื่องเดิม ยังจะใช้เนื้อเรื่องนี้อยู่ไหม (story.md เขียนในยุค TD)
5. **บท 4–5** (ไฟ, โลหะ + ดิน) จะทำก่อนเปิดตัว หรือให้ร้านไข่เป็นทางได้การ์ดของสามสำนักนี้ไปก่อน
