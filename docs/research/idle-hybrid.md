# วิจัย: ทิศทาง Idle + TD/RTS สำหรับศึกห้าสำนัก

> วันที่ 22 ต.ค. 2026 · สถานะ: **ข้อมูลประกอบการตัดสินใจ ยังไม่ใช่การตัดสินใจ** · ไม่ได้แก้ `docs/data`, `packages/sim` หรือเอกสารอื่น
> โจทย์จากเจ้าของเกม: ให้เกมไปทาง idle มากขึ้น แบบ AFK Journey, MapleStory: Idle RPG และ Legend of Mushroom: Rush แต่ยังมีรส TD/RTS และต้อง "ใหม่กว่าตลาด" ไม่ใช่โคลน Arknights
> เกี่ยวข้อง: [GDD](../GDD.md) §5.4–5.6 · [sect-allegiance](../design/sect-allegiance.md) · [SPEC-front-flow](../specs/SPEC-front-flow.md) · [market-players](market-players.md) · [design-review](design-review.md)

## วิธีอ่าน

**ป้ายความน่าเชื่อถือของแหล่ง:**
- **[ทางการ]** ประกาศของผู้พัฒนาหรือผู้จัดจำหน่าย, หน้าร้านค้า, งบการเงิน
- **[analytics]** Sensor Tower, AppMagic, Appfigures, Mobileindex, GameAnalytics หรือสื่ออุตสาหกรรมที่อ้างข้อมูลเหล่านี้ (PocketGamer.biz, MobileGamer.biz, Naavik, Deconstructor of Fun, GameRefinery)
- **[บล็อก]** บล็อกการตลาด, คู่มือเกม, รีวิวผู้เล่น, บทวิเคราะห์ที่ไม่บอกที่มาของข้อมูล

**ป้ายเนื้อหา:**
- **[ข้อมูล]** มีแหล่งอ้างอิง
- **[อนุมาน]** ความเห็นของผู้เขียนจากข้อมูล
- **ไม่พบ** หาไม่เจอ และไม่เดาตัวเลขแทน

**ข้อจำกัด:**
- เปิดหน้าเว็บต้นทางไม่ได้ในรอบนี้ เพราะ proxy ปฏิเสธการเชื่อมต่อ ตัวเลขทั้งหมดมาจากผลค้นหาที่สรุปหน้าเว็บนั้นอีกที
- ตัวเลขที่จะใช้ตัดสินใจลงทุนต้องเปิดตรวจกับต้นฉบับก่อน
- ตัวเลขรายได้จาก Sensor Tower และ AppMagic เป็นค่าประมาณ IAP บน App Store + Google Play เท่านั้น ไม่รวมรายได้โฆษณา, เว็บช็อป และสโตร์ Android ในจีน
- บางแหล่งรายงานแบบ gross บางแหล่งแบบ net ห้ามนำมาเทียบกันตรงๆ

## สารบัญ

0. สรุปสำหรับผู้ตัดสินใจ
1. เกมอ้างอิง: วงจรเล่น, ส่วน idle/active, การหาเงิน, ตัวเลข
2. Idle + TD ที่มีอยู่แล้ว: อะไรอิ่มตัว อะไรยังว่าง
3. หลักที่ได้จากข้อมูล
4. สามทิศทางสำหรับศึกห้าสำนัก
5. คำแนะนำ
6. สิ่งที่ยังไม่รู้และวิธีวัด
7. แหล่งอ้างอิง

---

## 0. สรุปสำหรับผู้ตัดสินใจ

1. **Idle RPG ยังเป็นตลาดใหญ่ แต่เงินมาจากการขายพลัง**
   - [ข้อมูล] MapleStory: Idle RPG ทำรายได้เกิน $100M ภายใน 45 วัน [S3] และราว $164M ภายในประมาณเดือนเม.ย. 2026 [S5]
   - [ข้อมูล] Legend of Mushroom ทำได้ราว $270M ในราว 6 เดือนแรก [S8]
   - [ข้อมูล] Gamigion อ้างว่าแพ็กราคาราว $219 คิดเป็นราว 25% ของรายได้ MapleStory: Idle RPG [S5] (ความน่าเชื่อถือ ต่ำ)
   - [อนุมาน] เกมเราห้ามขายพลังใน PvP ([economy.md](../design/economy.md)) จึงลอกโมเดลรายได้ของ idle RPG มาตรงๆ ไม่ได้ ต้องหาเงินจากความสะดวก เวลา คอสเมติก และ pass
2. **Idle + TD มีอยู่แล้วหลายเกม แต่เป็น PvE ล้วนแทบทั้งหมด**
   - ตัวอย่าง: The Tower, Galaxy Defense, Rush Defense, Idle Hero TD
   - [ข้อมูล] เกมกลุ่มนี้ทำรายได้ระดับกลาง: The Tower ทำสูงสุดราว $220K ต่อสัปดาห์ในสหรัฐฯ และ Galaxy Defense ราว $102K ต่อสัปดาห์ [S20][S21]
   - [ข้อมูล] เกม TD ที่ทำเงินระดับร้อยล้านดอลลาร์เป็นแนว PvP/co-op สุ่มยูนิต (Rush Royale, Random Dice, Lucky Defense) หรือ 4X ที่ใช้ TD เป็นตัวดึงคน (Kingshot)
3. **ช่องว่างที่พบ: TD แบบ idle ที่มีโหมดบุก–ตั้งรับ async**
   - หมายถึงผังป้องกันของเราตั้งรับแทนเราตอนออฟไลน์ และเราวางแผนบุกผังของผู้เล่นอื่น
   - [ข้อมูล] ค้นแล้วไม่พบเกมแบบนี้ที่ออกปี 2024–2026 เกมที่ใกล้สุดคือ Guns Up! Mobile (2022) [S30] ส่วนเกม idle TD ที่พบเป็นเล่นคนเดียวทั้งหมด
   - [ข้อมูล] รูปแบบ "สู้กับเงาของผู้เล่นอื่น" ใช้ได้ผลจริงใน The Bazaar [S31]
   - [อนุมาน] แนวนี้ใช้สิ่งที่เรามีอยู่แล้วโดยตรง คือ sim แบบ deterministic, replay และโหมดเรือธงบุก–ตั้งรับ
   - [อนุมาน] แนวนี้แก้ความเสี่ยงอันดับหนึ่งของเรา คือผู้เล่นออนไลน์ไม่พอให้จับคู่ real-time เพราะ async ไม่ต้องมีคู่ต่อสู้ออนไลน์พร้อมกัน
4. **ข้อเสนอ: ทิศทาง B "ศึกเงาห้าสำนัก"** (§4.2)
   - แกน PvE แบบ idle ใช้วงจรของทิศทาง A (§4.1)
   - ชั้นที่ทำให้ต่างจากตลาดคือบุก–ตั้งรับแบบ async ที่ใช้ค่าพลังเท่ากัน (normalized)
   - ต้องพิสูจน์ด้วย bot และ playtest ก่อน (§6)

## 1. เกมอ้างอิง

### 1.1 AFK Journey (Farlight Games / Lilith, มี.ค. 2024)

| เรื่อง | รายละเอียด | แหล่ง |
|---|---|---|
| วงจรหลัก | Naavik สรุปว่าเกมมี 2 แกน คือ idle RPG กับ team battler โดยฝั่ง idle เน้นการสำรวจโลก 3D แบบ autopilot และยิ่งเล่นไป การสำรวจยิ่งถูกจำกัดด้วยระดับพลัง | [S1] [analytics] |
| Idle กับ active | ส่วน idle: กล่อง AFK Stage สะสมทรัพยากร 12 ชม. ตอนเริ่ม และขยายเป็น 24 ชม. ภายหลัง [S12] · ส่วน active: จัดทีม, Dream Realm (บอสรายวันหมุน 4 ตัว ให้ตีวันละ 5 ครั้ง จัดอันดับตามดาเมจ) [S11] · PocketGamer.biz มองว่าเกมนี้ดัน idle "ไปไว้ข้างหลัง" แล้วเอาการสำรวจและปริศนาขึ้นมาแทน [S2] | [S2] [analytics] · [S11][S12] [บล็อก] |
| Season | ผู้พัฒนาแยกระบบเป็น**ถาวร**กับ**ตามฤดูกาล** ระบบตามฤดูกาลรีเซ็ตทุก season เพื่อคุม power creep ฮีโร่ได้สกิลประจำ season และย้ายเซิร์ฟเวอร์เข้า "district" ใหม่ | [S10] [ทางการ ผ่านเว็บแฟน] |
| รายได้ | IAP $128M และดาวน์โหลด 12M ภายใน 7 เดือน [S1] · lifetime $158.3M (AppMagic, 21 ก.ย. 2024) [S9] · รายได้ต่อเดือน $7M (ก.ค. 2024) → $61.5M (ส.ค. 2024) หลังเปิดเอเชีย (Sensor Tower) [S9b] · ตลาดหลักคือสหรัฐฯ 28% และจีน 22% (2024) [S9] | [analytics] |
| ตัวเลขปี 2025–2026 | **ไม่พบ** ตัวเลขรวมทั่วโลก | — |
| ไทย/SEA | **ไม่พบ** | — |
| Session | **ไม่พบ** | — |

### 1.2 MapleStory: Idle RPG / 메이플 키우기 (Nexon × Able Games, 6 พ.ย. 2025)

| เรื่อง | รายละเอียด | แหล่ง |
|---|---|---|
| วงจรหลัก | ตัวละครสู้อัตโนมัติ ผู้เล่นกระจายค่าสถานะ สุ่มอาวุธ ลงดันเจี้ยน เพิ่ม mastery และตีบวกของ (awakening, promotion, starforce) | [S6] [บล็อก] |
| การหาเงิน | pass รายวันแบบสมัครสมาชิก, gacha ตัวละครและอุปกรณ์, คอสเมติกที่ไม่เพิ่มพลัง [S6] · Gamigion อ้างว่ามีแพ็กแพงกว่า $99.99 และแพ็ก ~$219 คิดเป็นราว 25% ของรายได้ คอสเมติกที่ซื้อด้วยเงินเท่านั้นและมองเห็นได้กลายเป็นเครื่องแสดงสถานะ และรางวัลตามเวลาเล่นช่วยให้เล่นนานขึ้น [S5] | [S6] [บล็อก] · [S5] [บล็อก ไม่บอกที่มาข้อมูล] |
| รายได้ | ดาวน์โหลดเกิน 3M และรายได้เกิน $100M ภายใน 45 วัน เป็นเกม idle RPG ใหม่ที่ทำเงินสูงสุดในปีนั้น (Sensor Tower) [S3] · ราว $164M และติดตั้ง 7.6M (AppMagic ราว เม.ย. 2026) [S5][S5b] · สูงสุดราว $44M ในเดือนที่ 4 และเหลือ $36.6M ในเดือนมี.ค. 2026 [S5b][S5c] · PocketGamer.biz รายงานว่าการเติบโตเริ่มหยุด (ก.พ. 2026) [S5d] | [analytics] |
| เกาหลี | ยอดขายในเกาหลีบนมือถือ: ม.ค. 2026 ₩43.9B, ก.พ. ₩39.1B, มี.ค. ₩45.2B อันดับ 1 สามเดือนติด (Mobileindex) [S4] · Nexon รายงาน MapleStory franchise โต 42% ใน Q1 2026 และ 63% ใน Q2 2026 โดยนับรวมเกมนี้ [S4b] | [analytics] · [ทางการ] |
| **ไทย** | **ไทยคิดเป็น 7.1% ของดาวน์โหลด เป็นอันดับ 4 รองจากเกาหลี 37.8%, สหรัฐฯ 16.9% และไต้หวัน 10.5% แต่ไม่ติดกลุ่มประเทศหลักด้านรายได้** (เกาหลี 67%, สหรัฐฯ 16.6%, ไต้หวัน 7.1%) | [S3] [analytics] |
| Session | **ไม่พบ** | — |

[อนุมาน] คนไทยโหลด idle RPG ที่มี IP แรง แต่จ่ายไม่มาก สอดคล้องกับข้อมูลเดิมที่ว่าไม่มีเกม idle หรือ TD ติดกลุ่มเกมทำเงินในไทย ([market-players](market-players.md) §2.5.4)

### 1.3 Legend of Mushroom และ "Legend of Mushroom: Rush - SEA" (Joy Nice Games)

**ชื่อที่ถูกต้อง:**
- **"Legend of Mushroom: Rush - SEA"** คือเวอร์ชันภูมิภาคเอเชียตะวันออกเฉียงใต้ของ Legend of Mushroom ไม่ใช่เกมใหม่แยกต่างหาก
- จัดจำหน่ายโดย SPARKGAME COMPANY LIMITED มีบน App Store ไทยและฟิลิปปินส์ [S13]
- [ข้อมูล] ชื่อ package Android คือ `com.mxdzz.sea` ส่วนเวอร์ชันโลกคือ `com.mxdzzus.google` [S14][S15]
- ไม่พบประกาศทางการที่อธิบายความสัมพันธ์ระหว่างสองเวอร์ชัน

| เรื่อง | รายละเอียด | แหล่ง |
|---|---|---|
| วงจรหลัก | Deconstructor of Fun บรรยายว่าวงจร "บางมากโดยตั้งใจ": ฆ่าลูกสมุนและบอส เก็บอุปกรณ์ ตีบวกตัวละคร พึ่งการสุ่มหนักและจูงใจให้เล่นยาว ผู้เขียนเปรียบว่าเป็น "สล็อตแมชชีนในคราบ RPG" | [S7] [analytics, guest post] |
| Idle กับ active | ตัวละครสู้เองตลอด ผู้เล่นแตะ "ตะเกียงวิเศษ" เพื่อสุ่มอุปกรณ์ ซึ่งมีตัวนับจำกัดจำนวนครั้ง เควสขึ้นทีละข้อเป็นตัวดึงความสนใจ และระบบ idle เปิดที่เลเวล 16 | [S16][S17] [บล็อก] |
| เทียบกับ AFK Journey | Naavik สรุปว่า LoM เน้นความเรียบง่ายทั้งภาพและเกมเพลย์ แล้วใช้ระบบความก้าวหน้าจำนวนมาก + live ops ถี่เป็นตัวดึงผู้เล่น | [S2] [analytics] |
| รายได้ | IAP ราว $270M ตั้งแต่ พ.ย. 2023 ถึงราว เม.ย. 2024 (Sensor Tower) โดยเกาหลี 39.4% และญี่ปุ่น 30% [S8] · สัปดาห์แรกในญี่ปุ่น $8.5M (Sensor Tower, มี.ค. 2024) [S8b] · สหรัฐฯ ยังทำได้ราว $219.5K ต่อสัปดาห์ช่วง ก.ย. 2025 [S18] | [analytics] |
| **ไทย/SEA** | **เปิด SEA ต้น มี.ค. 2024 ขึ้นอันดับ 1 ยอดดาวน์โหลดทั้ง App Store และ Google Play ในไทยและเวียดนาม รายได้ SEA เกิน $11M ภายใน ส.ค. 2024 โดยไทยและเวียดนามประเทศละมากกว่า 25%** (Sensor Tower SEA 2024) | [S19] [analytics] |
| ดาวน์โหลด SEA | Google Play ราว 4.2M (AppBrain) · App Store ไทยได้ 4.9 ดาวจาก 9.4K ratings | [S14] [บล็อก] · [S13] [ทางการ] |
| ตัวเลขปี 2025–2026 รวมทั่วโลก | **ไม่พบ** | — |

[อนุมาน] Legend of Mushroom เป็นหลักฐานที่ดีที่สุดว่า idle แบบเรียบง่ายขายได้ในไทย (ไทยคิดเป็นกว่า 25% ของรายได้ SEA) แต่ความสำเร็จมาจากการสุ่มพลังแบบสล็อตซึ่งขัดกับหลักของเรา สิ่งที่นำมาใช้ได้คือ "จังหวะแตะเพื่อรับของ" และ live ops ถี่ ไม่ใช่การขายพลัง

### 1.4 เกมอ้างอิงอื่นในกลุ่ม idle/hybrid 2024–2026

| เกม | วงจร / ส่วน idle | ตัวเลข | แหล่ง |
|---|---|---|---|
| **Capybara Go!** (Habby, ปลาย 2024) | roguelike แบบข้อความ กดปุ่มเพื่อผ่าน "วัน" ต้องรอด 60 วันต่อบท เจออีเวนต์สุ่มและเลือกทาง มี AFK rewards และใช้พลังงานที่ฟื้นตามเวลา | $109M lifetime (AppMagic, 10 ก.พ. 2025) เกาหลี 28%, ไต้หวัน 17%, สหรัฐฯ 15% [S22] · ปี 2026 คิดเป็น 12% ของรายได้รวม Habby ซึ่งเกิน $2B (AppMagic ผ่าน Gamigion) [S23] · เคยติด top 10 grossing iOS ในเวียดนามและสิงคโปร์ช่วงเปิดตัว [S24] | [analytics] · [S24] [บล็อก] |
| **Archero 2** (Habby, ปลาย 2024) | action roguelike เล่นรอบสั้นกว่าภาคแรก มี PvP Bo3 และการล่าแบบ passive | $8M ใน 11 วัน (AppMagic) [S25] · เกิน $200M ทั่วโลกช่วงครบรอบปี (Sensor Tower ผ่านแหล่งรอง) [S26] | [analytics] |
| **Whiteout Survival** (Century Games) | 4X ส่งทีมฮีโร่ 5 ตัวไปสู้ "exploration" อัตโนมัติ ได้รายได้ passive ระหว่างไม่อยู่ แต่คิวสร้างและวิจัยที่ว่างคือการเสียเปรียบ จึงต้องกลับมาเช็กบ่อย | ราว $2.1B ในปี 2025 (+45%) และเกิน $4B สะสมถึง ธ.ค. 2025 (Sensor Tower ผ่านแหล่งรอง) | [S27][S28] [บล็อก] · [S29] [analytics ผ่านแหล่งรอง] |
| **Kingshot** (Century Games, ก.พ. 2025) | 4X ที่โฆษณาด้วย TD แต่ตัวเกมจริงเป็นการสร้างเมือง และการต่อสู้ส่วนใหญ่ "ดูอย่างเดียว" | ปีแรก $811.9M gross (AppMagic) [S32] · net เกิน $500M ใน 11 เดือน (Appfigures) [S33] · PocketGamer.biz พาดหัวว่ามี "backlash from whales" [S32] | [analytics] · [S34] [บล็อก] |
| **Rush Royale** (MY.GAMES, 2020) | TD PvP/co-op สุ่มและรวมยูนิต | $500M lifetime และดาวน์โหลด 105M+ (23 มิ.ย. 2026) | [S35] [ทางการ] |
| **Random Dice** (111%, 2019) | TD สุ่มและรวมลูกเต๋า PvP/co-op | ดาวน์โหลด ~21.56M และรายได้ราว ₩328B (~$240M) ถึง มิ.ย. 2026 (สื่อเกาหลีผ่าน Diandian) · Random Dice 2 เปิด ส.ค. 2026 ได้ ~130K ดาวน์โหลดใน 3 วัน | [S36] [analytics ผ่านแหล่งรอง] |
| **Lucky Defense** (111%, พ.ค. 2024) | TD co-op 2 คน เรียกยูนิตแบบสุ่ม รวมยูนิตแบบสุ่ม มีวงล้อสุ่มระหว่าง waves ผู้เล่นติว่าต้องพึ่งดวงและเพื่อนร่วมทีมถ่วง | ~3M ดาวน์โหลดและ ~$20M (ส.ค. 2024) เกาหลี 79.4% ของรายได้ [S37] · ราว 4.6M ดาวน์โหลดและ $47M IAP ในราว 5 เดือน [S38] · IAP เดือน ก.ค. 2024 เกิน $11M เป็นเกม TD ทำเงินอันดับ 2 ของโลกในเดือนนั้น (แหล่งจีน) [S38] | [analytics] |
| **Legion TD 2** (Steam) | TD แข่งขัน: ช่วงวางยูนิตแล้วสู้อัตโนมัติ ส่ง mercenary ไปเลนคู่แข่ง และ mercenary แต่ละตัวเพิ่มรายได้ถาวร (คล้าย "ดอกเบี้ย") | ขายราว 309.5K ชุด ~$4.6M (ประมาณการ Raijin) · ผู้เล่นพร้อมกันเฉลี่ย ~758 (มิ.ย. 2026) · ผู้พัฒนาเคยบอกว่ามีผู้เล่น 10K ต่อวันและ 50K ต่อเดือน (2023) | [S39][S40] [analytics อิสระ] · [S41] [ทางการ ในฟอรัม] |
| **Mechabellum** (Steam) | auto-battler แนว RTS: วางทัพแล้วดูสู้ PvP | ~435.5K ชุด ~$3.9M (Raijin, ก.ค. 2026) · 84% บวกจาก ~19K รีวิว | [S42] [analytics อิสระ] |

**Session ของเกม idle:**
- [ข้อมูล] GameAnalytics (ข้อมูล Q3 2018–Q2 2019 จาก 80K เกม): เกม idle เล่น 5.3 ครั้งต่อวัน ครั้งละราว 8 นาที · กลุ่ม 10% บนเล่น 5.82 ครั้ง ครั้งละ 7 นาที [S43] · กลาง (ข้อมูลเก่า)
- [ข้อมูล] Kolibri Games (ผู้พัฒนา idle) บอกว่า session ของเกมตัวเองยาว 7 นาที เทียบค่าเฉลี่ยหมวด 5.5 นาที และผู้เล่น endgame เปิดเกมราว 9 ครั้งต่อวัน [S44] · ต่ำ-กลาง
- [ข้อมูล] เกม TD หัวแถว (ข้อมูลปี 2020) เล่นวันละราว 130 นาที ([market-players](market-players.md) §3.4) · กลาง
- **ไม่พบ** ข้อมูล session ที่วัดแยกของ AFK Journey, MapleStory: Idle RPG และ Legend of Mushroom

## 2. Idle + TD ที่มีอยู่แล้ว: อะไรอิ่มตัว อะไรยังว่าง

| กลุ่ม | ตัวอย่าง | ผลงาน | สถานะ [อนุมาน] |
|---|---|---|---|
| **Idle TD คนเดียว** (ตั้งป้อมกลาง อัปเกรดไม่จบ) | The Tower, Galaxy Defense: Fortress TD, Rush Defense: idle TD, Idle Hero TD | The Tower: สูงสุด >$220K ต่อสัปดาห์ (US, Q4 2023) [S20] · Galaxy Defense: สูงสุด $102K ต่อสัปดาห์ (US Android, พ.ค. 2025) [S21] · อันดับ 58 grossing ในหมวด strategy ของ Google Play (มี.ค. 2026) [S45] | **อิ่มตัว** มีเกมเข้ามาเรื่อยๆ ได้รายได้ระดับกลาง แข่งด้วยตัวเลขที่โตไม่จบ |
| **TD สุ่ม/รวมยูนิต PvP/co-op** | Rush Royale, Random Dice, Lucky Defense | $500M / ~$240M / ~$47M ใน 5 เดือน (§1.4) | **ผู้นำแน่น** ตลาดอยู่กับเกมเก่าและเกาหลี ผู้เล่นติเรื่องดวง |
| **4X ที่ใช้ TD เป็นตัวดึงคน** | Kingshot, Kingdom Guard | Kingshot $811.9M ปีแรก [S32] · Kingdom Guard ~$3M ต่อเดือนบน Google Play (มี.ค. 2022) [S46] | **ต้องใช้ทุนใหญ่** P2W ชัด และโฆษณาไม่ตรงกับตัวเกม [S34] |
| **Idle RPG + TD จาก IP ใหญ่** | Summoners War: Rush (Com2uS, พ.ค. 2025) | Steam Mixed (161 รีวิว) · Com2uS ไม่ได้ยกเครดิตรายได้ให้เกมนี้ [S47][S48] · **ไม่พบ** ตัวเลขรายได้ | **มีหลักฐานว่าไม่ติดตลาด** IP ใหญ่อย่างเดียวไม่พอ |
| **Roguelite TD แบบ hybrid-casual** | Penguin GO! TD, Abandoned Land | ติด top 200 grossing US ชั่วคราว (พ.ค. 2025) ([market-players](market-players.md) §2.3) | **กำลังมา** hybrid-casual โต +88% YoY (AppMagic 2025) [S49] |
| **TD/auto-battle แข่งขันบน PC** | Legion TD 2, Mechabellum | ~$4–6M lifetime ผู้เล่นพร้อมกันระดับพัน (§1.4) | **ตลาดเฉพาะกลุ่ม** แฟนจริงจังแต่กลุ่มเล็ก |
| **Idle TD ที่มีบุก–ตั้งรับ async (เงา/replay)** | ไม่พบเกมที่ออกปี 2024–2026 · ที่ใกล้สุดคือ Guns Up! Mobile (2022, ฝ่ายหนึ่งตั้งรับ อีกฝ่ายส่งทหาร async) [S30] | **ไม่พบ**ตัวเลข | **ช่องว่าง** (ค้นแบบเร็ว อาจมีเกมที่ค้นไม่เจอ ต้องตรวจซ้ำด้วย AppMagic/GameRefinery) |

**สิ่งที่อิ่มตัวแล้ว [อนุมาน]:**
- **ตัวเลขโตไม่จบแบบ idle** ทุกเกม idle ใช้ ทำได้ดีแค่ไหนก็ไม่ต่างจากคนอื่น
- **การสุ่มยูนิตกลางเกม** เป็นของ Rush Royale และ 111%
- **โฆษณาด้วย TD แต่ตัวเกมเป็น 4X** ผู้เล่นเริ่มรู้ทันและไม่ไว้ใจ [S34]

**สิ่งที่ยังว่าง [อนุมาน]:**
- **ผังป้องกันทำงานแทนเราตอนออฟไลน์ และถูกผู้เล่นจริงทดสอบ**
  - ผู้เล่น idle ได้ความรู้สึกว่า "ระบบทำงานตอนเราไม่อยู่" ซึ่งเป็นความพอใจหลักของ idle
  - แต่สิ่งที่ทำงานแทนเราเป็น**การตัดสินใจ**ของเราเอง ไม่ใช่ตัวเลขที่โตเอง
- **PvP ค่าพลังเท่ากันในเกม idle** ข้อมูลของ AFK Journey (§1.1) แสดงว่าผู้พัฒนาต้องหาวิธีคุม power creep ด้วย season เพราะ PvP ที่พลังขึ้นกับเงินมีปัญหา และ Kingshot เจอแรงต้านจากผู้เล่นที่จ่ายหนัก [S32] แต่ยังไม่มีหลักฐานว่าผู้เล่น idle อยากได้ PvP แบบพลังเท่ากัน (§6)

## 3. หลักที่ได้จากข้อมูล

| # | หลัก | หลักฐาน |
|---|---|---|
| P1 | **Idle คือชั้นที่ดึงให้กลับมาเล่น ไม่ใช่แกนความสนุก** เกมใหม่ที่สำเร็จดัน idle ไปไว้ข้างหลังแล้วใช้สิ่งอื่นเป็นแกน | AFK Journey [S2] · Capybara Go ใช้การเลือก roguelike [S24] |
| P2 | **ใช้ session สั้นแต่เปิดบ่อย** ประมาณ 5–6 ครั้งต่อวัน ครั้งละ 5–8 นาที | [S43][S44] |
| P3 | **ทุกครั้งที่กลับมาต้องมีของให้เก็บทันที** และมีการตัดสินใจเล็กๆ 1 ข้อ | ตะเกียงของ LoM [S16] · กล่อง AFK 12–24 ชม. [S12] · คิวว่างของ Whiteout เป็นแรงให้กลับมา [S28] |
| P4 | **บอสรายวันที่หมุนเวียนและบังคับให้จัดทีมใหม่** ช่วยให้ผู้เล่นตัดสินใจจริงในเกม idle | Dream Realm ของ AFK Journey [S11] |
| P5 | **Season แยกพลังถาวรกับพลังตามฤดูกาล** เพื่อคุม power creep | AFK Journey [S10] |
| P6 | **ตลาดเกาหลี/ไต้หวันจ่ายหนัก ส่วนไทยโหลดเยอะแต่จ่ายน้อยกว่า** | MapleStory: Idle RPG [S3] · LoM SEA [S19] |
| P7 | **โฆษณาต้องตรงกับเกม** ถ้าโฆษณาด้วย TD ตัวเกมต้องเป็น TD จริง | Kingshot [S34] |
| P8 | **รู้สึกว่าแพ้เพราะดวงหรือเพราะเงินคือข้อติหลัก** ทั้งใน TD สุ่มและใน 4X | Lucky Defense [S38b] · Kingshot [S32][S34] |

ข้อมูลภายในที่เกี่ยวข้อง (วัดจาก sim ใน [design-review](design-review.md), [README](README.md) §1):
- [ข้อมูล] ด่าน 20 waves ตอนนี้ใช้ 23–29 นาที
- [ข้อมูล] ผู้เล่นใช้ 80% ของเวลาไปกับการรอ และสั่งการราว 1 ครั้งต่อนาที
- [อนุมาน] ถ้าไปทาง idle จุดอ่อนนี้จะกลายเป็นข้อดีได้ แต่ต้องย้ายการตัดสินใจไปไว้**ก่อน**เริ่มสู้ (จัดผัง) และไว้ที่**จุดหักเห** (บอส, ประตู) แทนการให้ผู้เล่นนั่งดู 25 นาที

## 4. สามทิศทางสำหรับศึกห้าสำนัก

ทั้งสามทิศทางคงเงื่อนไขเดิมไว้:
- เลือกสำนักตอนเริ่มเกม และทุกสำนักมี 5 บทบาทเหมือนกัน ([sect-allegiance](../design/sect-allegiance.md) §3)
- sim แบบ deterministic
- PvP ใช้ค่าพลังเท่ากัน และของที่ซื้อได้ไม่เพิ่มพลังใน PvP
- วีรชนเป็น sidegrade

### 4.1 ทิศทาง A: "ค่ายกลบำเพ็ญ" (Idle Formation TD)

**แนวคิด:** แนวป้องกันของสำนักสู้ waves ไม่รู้จบเองตลอดเวลา เหมือน AFK Stage หรือด่านของ LoM แต่**สิ่งเดียวที่ผู้เล่นทำคือจัดค่ายกล** คือเลือกช่องวาง บทบาท ร่างผสาน และศิษย์สหาย ไม่มีการแตะเพื่อตีบวก

| ช่วงเวลา | ผู้เล่นทำอะไร |
|---|---|
| 30 วินาที | เปิดเกม เก็บปราณและของที่สะสมระหว่างออฟไลน์ (แสดงฉาก "ศิษย์นั่งสมาธิ" ตาม GDD §5.4) แก้ค่ายกล 1 ช่อง แล้วปิด |
| 5 นาที | **ด่านประตู** ทุก 10 ชั้น idle จะเจอบอสที่ "ล็อกกฎ" (ดูดธาตุ, ปิดบทบาท, ศัตรูล่องหน) ต้องเข้าไปเล่น TD แบบ active 3–5 นาทีเพื่อผ่าน ถ้าไม่ผ่าน idle จะติดอยู่ชั้นนั้น |
| รายวัน | บอสรายวันหมุนตามธาตุ คล้าย Dream Realm [S11] ให้ตีวันละ 5 ครั้ง จัดอันดับตามดาเมจ ในกลุ่มผู้เล่นสำนักเดียวกันและในกลุ่มรวม · ลาดตระเวนด่านเนื้อเรื่องที่ผ่านแล้ว |
| รายสัปดาห์ | หอคอยพันชั้น ล่าบอสชุมนุม และงานรีเซ็ตรายสัปดาห์ |

- **ส่วนที่ idle:** ผลิตปราณ, waves ไม่รู้จบ, ลาดตระเวน
- **ส่วนที่ผู้เล่นตัดสินใจ:** ผังค่ายกล, การเลือกคัมภีร์ยุทธ์ (roguelite) ที่ด่านประตู, การจัดทีมสู้บอสรายวัน
- **สำนัก:** กฎประจำสำนักเปลี่ยนวิธีจัดค่ายกล เช่น
  - วัชระศิลาเน้นขวางทาง
  - ไผ่หยกเน้นวางเป็นกลุ่มให้พิษลาม
- **PvP ยุติธรรม:**
  - แยกจาก idle ทั้งหมด PvP ใช้แต่ผังและทักษะ พลัง idle ไม่ถูกนำเข้า
  - เสี่ยงว่าผู้เล่น idle จะไม่สนใจ PvP เลย
- **การหาเงิน:**
  - ขายได้: ขยายเพดานออฟไลน์, เร่งเวลา, บัตรรายเดือน, pass, คอสเมติก
  - ขายพลังได้เฉพาะ PvE ต้องตัดสินใจกับ economy.md ก่อนว่ายอมได้แค่ไหน
- **ความเสี่ยง:**
  - ใกล้กับ The Tower และ Galaxy Defense ที่อิ่มตัวแล้วและทำรายได้ระดับกลาง (§2)
  - "ใหม่กว่าตลาด" ได้แค่ธีมกับระบบสำนัก
- **ข้อมูลรองรับ:** LoM [S7][S19], AFK Journey [S11][S12], GameAnalytics idle [S43] · The Tower [S20] เป็นทั้งหลักฐานสนับสนุนและคำเตือนเรื่องเพดานรายได้
- **ต้นทุนเทคนิค:**
  - ต่ำ ใช้ sim เดิมได้
  - ผลออฟไลน์คิดด้วยสูตรประมาณจากผลของ sim ไม่ต้องรัน 12 ชม. จริง (12 ชม. × 20Hz = 864,000 ticks)

### 4.2 ทิศทาง B: "ศึกเงาห้าสำนัก" (Async Siege: Idle Defense + Planned Attacks)

**แนวคิด:**
- ผู้เล่นแต่ละคนมี**ผังตั้งรับ** (ลานสำนัก) ที่ป้องกันแทนตลอดเวลา รวมตอนออฟไลน์
- ผู้เล่นคนอื่นส่ง**แผนบุก** มาเล่นกับผังนั้นแบบ async
- แผนบุกเลือกได้ว่าจะส่งศัตรูชนิดไหน กี่ระลอก จังหวะไหน และใช้ไม้ตายตอนไหน คล้ายการส่ง mercenary ใน Legion TD 2 [S41b]
- server รันการต่อสู้ด้วย `sim` แล้วทั้งสองฝ่ายดู replay ได้
- เพิ่มชั้น PvE idle ตามทิศทาง A แบบย่อเป็นแกนของผู้เล่นใหม่

| ช่วงเวลา | ผู้เล่นทำอะไร |
|---|---|
| 30 วินาที | เปิดเกม ดู "รายงานศึกเงา": คืนนี้ผังของเรารับการบุก 6 ครั้ง ชนะ 4 ครั้ง ดู replay ช่วงที่แพ้ 10 วินาที แก้ผัง 1 ช่อง แล้วเก็บรางวัล idle |
| 5 นาที | **บุก 1 ครั้ง** ดูผังของคู่แข่ง (เห็นสำนักและบทบาท แต่ไม่เห็นค่าละเอียด) จัดกองบุก 30–60 วินาที ดูผลแบบเร่ง ×3 ราว 1–2 นาที ระหว่างดูกดไม้ตายได้ 1–2 ครั้ง · หรือเล่นด่าน PvE ประตู |
| รายวัน | บุกได้ 5 ครั้ง เหมือนจำนวนครั้งของบอสรายวันใน AFK Journey [S11] · มีภารกิจ "ตั้งรับให้รอด X ครั้ง" · บอสรายวันฝั่ง PvE |
| รายสัปดาห์ | ladder ของ season รีเซ็ตทุกสัปดาห์หรือสองสัปดาห์ · "ศึกสำนัก" ที่ชุมนุมรวมแต้มบุก–รับ · แผนที่ประจำสัปดาห์เปลี่ยนเส้นทางและจุดวาง |

- **ส่วนที่ idle:** ผังตั้งรับทำงานตลอด, ทรัพยากรสะสม, PvE ลาดตระเวน
- **ส่วนที่ผู้เล่นตัดสินใจ:**
  - ฝั่งรับ: ออกแบบผัง เช่น วางกลุ่มต่อต้านศัตรูล่องหน และวางตามความสัมพันธ์ของธาตุ
  - ฝั่งบุก: อ่านผังคู่แข่ง เลือกชนิดศัตรู เลือกจังหวะ ใช้ไม้ตาย
  - การตัดสินใจทั้งหมดเกิด**ก่อน**เริ่มสู้และที่**จุดหักเห** ตรงกับข้อสังเกตใน §3
- **สำนัก:**
  - สำนักกำหนดทั้งสไตล์ตั้งรับและสไตล์บุก เช่น
    - ไฟเผาสะสม เหมาะรับระลอกที่มาเป็นสาย
    - มารยอมเสียชีวิตป้อมเพื่อแลกพลัง เป็นสไตล์เสี่ยงทั้งบุกและรับ
  - จับคู่สำนักกับสำนักได้ 15 คู่ ใช้เกณฑ์ S2 (±3%) จาก sect-allegiance §7 วัดได้ด้วย bot
- **PvP ยุติธรรม:**
  - ladder ใช้ค่าพลังเท่ากันเสมอ ผังเป็นตัวตัดสิน ไม่ใช่เลเวล
  - ทุกการต่อสู้รันบน server ด้วย `sim` client ส่งแค่ input จึงโกงผลไม่ได้
  - replay ของทุกแมตช์เป็นวัตถุดิบสำหรับคลิปและ esports
  - เมื่อถึงเวลา esports ใช้กติกาเดียวกันแบบ real-time ได้ คือโหมดเรือธงบุก–ตั้งรับ 1v1 ใน [esports.md](../design/esports.md)
- **การหาเงิน:**
  - ขายได้: คอสเมติกของผัง (ธีมลานสำนัก, เอฟเฟกต์ตอนชนะ), สกินศิษย์, pass ของ season, บัตรรายเดือนที่เพิ่ม**จำนวนผังที่บันทึกได้**และ**จำนวน replay ที่เก็บได้** (สะดวกขึ้นแต่ไม่เพิ่มพลัง), เร่งเวลาและเพดาน idle ฝั่ง PvE
  - ต้องยอมว่ารายได้ต่อผู้เล่นต่ำกว่า idle RPG ที่ขายพลัง ([market-players](market-players.md) §3.5)
- **ความเสี่ยง:**
  - ผู้เล่น idle อาจไม่อยากถูกบุก ต้องไม่ทำให้แพ้แล้วเสียของ คล้าย shield ของ CoC ให้แค่ได้น้อยลง
  - ผังที่ดีที่สุดอาจกลายเป็นสูตรตายตัวที่ทุกคนลอก ต้องหมุนแผนที่ประจำสัปดาห์และ ban สำนักใน season
  - ค่า server สำหรับรัน sim ทุกการบุก: 5 ครั้งต่อวันต่อผู้เล่น ครั้งละราว 3 นาทีของเวลาในเกม ประมาณได้ แต่ต้องวัดจริง
  - **ยังไม่มีหลักฐาน**ว่าผู้เล่นไทยต้องการแนวนี้ ช่องว่างในตลาดอาจหมายความว่ามีคนลองแล้วล้มก็ได้
- **ข้อมูลรองรับ:**
  - เงาแบบ async ใช้ได้ผล: The Bazaar [S31]
  - วงจรรับ + ส่งศัตรู: Legion TD 2 [S41b]
  - บุก–ตั้งรับ async ใน TD: Guns Up! [S30]
  - คุม power creep ด้วย season: AFK Journey [S10]
  - แรงต้านเมื่อพลังซื้อได้: Kingshot [S32]
  - ตลาด TD PvP: Rush Royale $500M [S35]

### 4.3 ทิศทาง C: "แนวรบยุทธภพ" (Idle Frontier RTS บนเครือข่ายเส้นทาง)

**แนวคิด:**
- แผนที่ภูมิภาคเป็น**เครือข่ายเส้นทาง** (node + ถนนที่แตกแขนง)
- ทัพพรรคมารเดินช้าๆ เป็นชั่วโมงไปตามเส้นทาง
- ผู้เล่นวางกองศิษย์ที่ node, เลือกเปิดหรือปิดทางแยก (ประตู, สะพาน) เพื่อบังคับเส้นทางของศัตรู และเลือกว่าจะป้องกันแนวไหน
- เมื่อทัพถึง node ที่มีกองศิษย์ จะเกิดการต่อสู้ TD ระยะสั้น ซึ่ง sim รันเองหรือผู้เล่นเข้าไปเล่นเองก็ได้
- แนวนี้ตอบโจทย์ "TD เส้นทางที่น่าสนใจกว่าเดิม" โดยตรง เพราะการเลือกเส้นทางเป็นการตัดสินใจหลัก

| ช่วงเวลา | ผู้เล่นทำอะไร |
|---|---|
| 30 วินาที | ดูแผนที่ ทัพไหนใกล้ถึง สลับประตู 1 จุด ส่งกองหนุน |
| 5 นาที | เข้าไปเล่น 1 ศึกที่ node สำคัญเองแบบ active ได้ผลดีกว่าให้ sim รันเอง |
| รายวัน | ทัพใหญ่ 2–3 ระลอกตามเวลา ผู้เล่นเลือกว่าจะเปิดเกมตอนไหน ไม่บังคับเวลา |
| รายสัปดาห์ | ชุมนุมแบ่งแนวรบในแผนที่ร่วม เป็น co-op · ยึดภูมิภาคคืน |

- **ส่วนที่ idle:** ทัพเคลื่อน, ศึกอัตโนมัติ, ผลิตทรัพยากร
- **ส่วนที่ผู้เล่นตัดสินใจ:** การเลือกเส้นทาง, การกระจายกำลัง, เวลา เป็นการตัดสินใจระดับ RTS ที่ช้า
- **สำนัก:**
  - สำนักต่างกันที่การเคลื่อนทัพ เช่น
    - กระบี่เมฆาเคลื่อนเร็ว
    - วัชระศิลาตั้งรับ node ได้นาน
    - กระยาจกมีกองเล็กหลายกอง
  - ในชุมนุมที่มีหลายสำนัก แต่ละสำนักทำหน้าที่ต่างกัน
- **PvP ยุติธรรม:** ทำยากที่สุด แผนที่ร่วมแบบ 4X มักจบที่ใครเล่นนานหรือจ่ายมากกว่า จึงต้องแยก PvP ไปเป็นโหมดค่าพลังเท่ากัน แบบทิศทาง A
- **การหาเงิน:** pass, คอสเมติก, ช่องกองทัพเพิ่ม (ระวังว่าจะกลายเป็นขายพลัง)
- **ความเสี่ยง:**
  - ขอบเขตงานใหญ่ที่สุด ต้องมี UI แผนที่, ระบบเวลาจริง และ server ที่เก็บสถานะต่อเนื่อง
  - ใกล้กับแนว 4X ของ Whiteout และ Kingshot ที่ต้องใช้ทุนการตลาดสูงมาก
  - ทีมเล็กแข่งยาก
- **ข้อมูลรองรับ:**
  - idle exploration + การส่งทีมไปสู้เอง: Whiteout [S28]
  - การสำรวจแบบ autopilot: AFK Journey [S1]
  - 4X ทำรายได้สูงสุดของมือถือ: Whiteout $2.1B [S29], Kingshot [S32]
  - **แต่ไม่พบ** หลักฐานว่าทีมเล็กทำแนวนี้สำเร็จ

### 4.4 เทียบสามทิศทาง

| เกณฑ์ | A ค่ายกลบำเพ็ญ | B ศึกเงาห้าสำนัก | C แนวรบยุทธภพ |
|---|---|---|---|
| ใหม่กว่าตลาด | ต่ำ (ตลาด idle TD อิ่มตัว) | **สูง** (ไม่พบคู่แข่งตรงในปี 2024–26) | กลาง (TD เส้นทางใหม่ แต่โครง 4X มีแล้ว) |
| ความเป็น idle | **สูง** | กลาง-สูง | สูง |
| การตัดสินใจ TD/RTS | กลาง | **สูง** (อ่านคู่แข่งได้) | **สูง** (ระดับ macro) |
| PvP ยุติธรรมและต่อยอด esports | แยกโหมด เชื่อมกันไม่ดี | **ใช้กติกาเดียวกับโหมดเรือธง** | ยาก |
| ต้องมีผู้เล่นออนไลน์พร้อมกัน | ไม่ต้อง | **ไม่ต้อง** (async) | ต้องมีชุมนุมที่ยังเล่นอยู่ |
| ใช้ของที่มีอยู่ (sim, replay) | กลาง | **สูงมาก** | กลาง |
| ขอบเขตงาน | **เล็ก** | กลาง | ใหญ่ |
| เพดานรายได้เมื่อห้ามขายพลัง PvP | กลาง-ต่ำ | กลาง | กลาง (ถ้าไม่ขายพลัง) |
| ความเสี่ยงหลัก | ไม่ต่างจากเกมอื่น | ผู้เล่น idle ไม่ชอบถูกบุก หรือผังตายตัว | ขอบเขตงานและทุน |

## 5. คำแนะนำ

**เสนอทิศทาง B "ศึกเงาห้าสำนัก"** ใช้วงจร idle ของทิศทาง A แบบย่อเป็นทางเข้าของผู้เล่นใหม่ เหตุผล:

1. **เป็นทิศทางเดียวที่ "ใหม่กว่าตลาด" อย่างมีหลักฐาน** ส่วนที่อิ่มตัวคือ idle TD คนเดียวและ TD สุ่มยูนิต (§2) ส่วนที่ไม่พบคู่แข่งคือ idle + บุก–ตั้งรับแบบเงา
2. **ได้ความรู้สึกแบบ idle โดยไม่ต้องขายพลัง** ผู้เล่นได้ความรู้สึกว่าระบบทำงานแทนตอนออฟไลน์ แต่สิ่งที่ทำงานคือผังที่ผู้เล่นออกแบบเอง จึงไม่ขัดกฎ "PvP ซื้อไม่ได้"
3. **แก้ความเสี่ยงอันดับหนึ่ง (จับคู่ไม่ได้)** async ไม่ต้องมีคู่ต่อสู้ออนไลน์พร้อมกัน เป็นทางเข้าโหมดบุก–ตั้งรับที่ทำได้ตั้งแต่ผู้เล่นยังน้อย แล้วค่อยเปิด real-time 1v1 เมื่อเกมแมส ตรงกับลำดับที่อนุมัติใน GDD §1.1
4. **ใช้ของที่สร้างไว้แล้วเต็มที่** sim แบบ deterministic, ระบบ replay, การไม่เชื่อผลจาก client และสำนัก × บทบาท ไม่ต้องสร้างระบบใหม่ขนาด 4X
5. **ตรงกับจังหวะ session ของเกม idle** 30 วินาที (รายงานศึกเงา) และ 5 นาที (บุก 1 ครั้ง) ทำให้เปิดเกมได้ 5–6 ครั้งต่อวัน [S43] และแก้ปัญหาด่านยาว 23–29 นาที (§3)

**ข้อที่ต้องยอมรับ:**
- รายได้ต่อผู้เล่นต่ำกว่า MapleStory: Idle RPG และ LoM มาก เพราะเกมเหล่านั้นขายพลัง [S5][S7]
- ตลาดไทยโหลดเยอะแต่จ่ายน้อยกว่าเกาหลีและไต้หวัน [S3][S19] ถ้าต้องการรายได้ระดับ idle RPG จะต้องเปิดเกาหลี/ไต้หวันเร็ว หรือยอมขายพลังฝั่ง PvE ซึ่งเป็นการตัดสินใจทางธุรกิจของเจ้าของเกม

**ลำดับที่เสนอ (ต้องให้เจ้าของเกมอนุมัติ):**
1. ทำ prototype "ผังตั้งรับ vs กองบุกของ bot" ในด่านเดียว ใช้ 2 สำนักที่กำลังทำอยู่ (ไฟ, พิษ) ตาม sect-allegiance §9
2. วัดด้วย bot ว่ามีผังที่ชนะทุกแผนบุกไหม และสำนักห่างกันเกิน ±3% ไหม
3. playtest ด้วยคน: วงจร 30 วินาที / 5 นาทีสนุกไหม และถูกบุกแล้วรู้สึกแย่ไหม
4. ถ้าผ่าน ค่อยเขียน spec ด้วย `/spec` ลง `docs/specs/` แล้วปรับ GDD

## 6. สิ่งที่ยังไม่รู้และวิธีวัด

| ไม่รู้ | ทำไมสำคัญ | วิธีวัด |
|---|---|---|
| ผู้เล่น idle ไทยชอบถูกบุกหรือไม่ | ถ้าไม่ชอบ ทิศทาง B จะเสีย retention | playtest + คำถามหลังเล่น · ทดสอบแบบ A/B ระหว่าง "แพ้แล้วเสียของ" กับ "แพ้แล้วได้น้อยลง" |
| มีเกม idle + async TD ที่เราค้นไม่เจอหรือไม่ | ช่องว่างอาจเป็นเกมที่ลองแล้วล้ม | ค้นใน AppMagic/GameRefinery feature tags · ดูข้อมูลในจีนผ่าน TapTap |
| Session จริงของ AFK Journey, MapleStory: Idle RPG, LoM | ใช้ตั้งเป้า session ของเรา | **ไม่พบ** ข้อมูลสาธารณะ · ต้องใช้ Sensor Tower Usage Intelligence (มีค่าใช้จ่าย) |
| ผลงานของ AFK Journey และ LoM ในไทยหลังปี 2024 | ใช้ประเมินเพดานรายได้ในไทย | **ไม่พบ** · ต้องใช้ข้อมูลรายประเทศแบบเสียเงิน |
| รายได้ของ Summoners War: Rush | หลักฐานตรงของ idle + TD จาก IP ใหญ่ | **ไม่พบ** |
| ค่า server ของการรัน sim ทุกการบุก | ต้นทุนต่อผู้เล่นต่อวัน | benchmark `packages/sim`: ระยะเวลาต่อแมตช์ × 5 ครั้งต่อผู้เล่นต่อวัน |
| ผังที่ดีที่สุดเกิดเร็วแค่ไหน | ถ้าทุกคนใช้ผังเดียว ทิศทาง B จะน่าเบื่อ | ใช้ bot ค้นหาผังแบบ search/evolution แล้ววัดความหลากหลายของผังที่ชนะ |

## 7. แหล่งอ้างอิง

| ID | แหล่ง | ประเภท |
|---|---|---|
| S1 | [Naavik — Lessons learned from AFK Journey](https://naavik.co/digest/lessons-learned-from-afk-journey/) | analytics |
| S2 | [PocketGamer.biz — Game analysis: the evolution of idle RPG systems](https://www.pocketgamer.biz/game-analysis-the-evolution-of-idle-rpg-systems) | analytics |
| S3 | [Sensor Tower (KR) — MapleStory Idle RPG surpasses $100M in cumulative revenue](https://sensortower.com/ko/blog/maplestory-idle-rpg-surpasses-100-million-in-cumulative-revenue) | analytics |
| S3b | [Sensor Tower — Top 5 idle RPG iOS US Q4 2025](https://sensortower.com/blog/2025-q4-ios-top-5-idle-rpg-units-us-6040bbc2241bc16eb883a0cb) | analytics |
| S4 | [Nate News — MapleStory Idle March revenue ₩45.2B, #1 three months](https://m.news.nate.com/view/20260406n30056) | analytics (Mobileindex ผ่านสื่อ) |
| S4b | [Digital Daily — Nexon H1 2026 record results](https://m.ddaily.co.kr/page/view/2026081317232016567) · [Hankyung — Nexon Q1 2026](https://www.hankyung.com/amp/202605146874g) | ทางการ (ผ่านสื่อ) |
| S5 | [Gamigion — MapleStory: Idle RPG analysis](https://www.gamigion.com/?p=32245) · [Gamigion (2)](https://www.gamigion.com/?p=32132) | บล็อก |
| S5b | [MobileGamer.biz — Data digest: Q1's top earners](https://mobilegamer.biz/data-digest-3bn-playtika-for-sale-q1s-top-earners-easybrain-sett-mistplay-mag-more/) · [AppMagic blog](https://appmagic.rocks/blog/Pictuuureee/?hl=en) | analytics |
| S5c | [MobileGamer.biz — March's top grossing mobile games](https://mobilegamer.biz/marchs-top-grossing-mobile-games-3/) | analytics |
| S5d | [PocketGamer.biz — February 2026 mobile game charts](https://www.pocketgamer.biz/february-2026-mobile-game-charts-have-mobiles-fast-risers-peaked/) | analytics |
| S6 | [CompanionLink — MapleStory Idle review](https://www.companionlink.com/blog/2026/06/maplestory-idle-review-does-it-capture-the-magic-of-the-original-franchise/) · [MMOBomb — MapleStory Idle playtest](https://www.mmobomb.com/nexon-holding-playtest-new-maplestory-idle-mobile-game) | บล็อก |
| S7 | [Deconstructor of Fun — The Magic of 'Legend Of Mushroom'](https://www.deconstructoroffun.com/blog/2024/4/15/the-magic-of-legend-of-mushroom) | analytics (guest post) |
| S8 | [WN Hub — Revenue for Legend of Mushroom neared $300 million](https://wnhub.io/news/finance/item-43484) | analytics (Sensor Tower ผ่านสื่อ) |
| S8b | [Automaton — Legend of Mushroom Japan $8.5M in one week](https://automaton-media.com/en/news/legend-of-mushrooms-massive-japanese-release-makes-8-5-million-in-one-week/) · [Sensor Tower JP](https://sensortower.com/ja/blog/legend-of-mushroom-off-to-a-good-start-in-japan) | analytics |
| S9 | [PocketGamer.biz — AFK Journey surpasses $150 million](https://www.pocketgamer.biz/afk-journey-surpasses-150-million-with-asian-market-dominance) | analytics |
| S9b | [MobileGamer.biz — Data digest: AFK Journey spikes](https://mobilegamer.biz/data-digest-afk-journey-spikes-stillfront-splits-blackouts-buyout-robloxs-wild-ambitions-fresh-market-stats-more/) | analytics |
| S10 | [AFK Journey official news — Talk with Designers: New Season Preview](https://afkjourney-news.farlightgames.com/de/detail/37) · [dotgg — Dev update: solving power creep](https://dotgg.gg/afk-journey/dev-update-new-season-availability-design-solving-power-creep-qa/) | ทางการ / บล็อก |
| S11 | [BlueStacks — AFK Journey game modes](https://www.bluestacks.com/blog/game-guides/afk-2-journey/afkj-game-modes-guide-en.html) · [PowerUp Gaming — Dream Realm guide](https://powerupgaming.co.uk/2024/12/22/afk-journey-dream-realm-guide/) | บล็อก |
| S12 | [Prydwen — AFK Journey tips and tricks](https://prydwen.gg/afk-journey/guides/tips-and-tricks) | บล็อก |
| S13 | [App Store TH — Legend of Mushroom: Rush - SEA](https://apps.apple.com/th/app/legend-of-mushroom-rush-sea/id6473259128) | ทางการ |
| S14 | [AppBrain — Legend of Mushroom: Rush - SEA](https://www.appbrain.com/app/legend-of-mushroom-rush-sea/com.mxdzz.sea) | บล็อก (aggregator) |
| S15 | [Google Play — Legend of Mushroom](https://play.google.com/store/apps/details?id=com.mxdzzus.google&hl=en_US) · [Google Play — Legend of Mushroom: Rush - SEA](https://play.google.com/store/apps/details?id=com.mxdzz.sea&hl=en) | ทางการ |
| S16 | [BlueStacks — Legend of Mushroom tips](https://www.bluestacks.com/blog/game-guides/legend-of-the-mushroom-brave-3000-free-draws/lotmb-tips-tricks-en.html) | บล็อก |
| S17 | [PocketGamer — Legend of Mushroom guide](https://www.pocketgamer.com/legend-of-mushroom/guide/) | บล็อก |
| S18 | [Sensor Tower — Top 5 idle RPG US Q3 2025](https://sensortower.com/blog/2025-q3-unified-top-5-idle%20rpg-revenue-us-6040bbc2241bc16eb883a0cb) | analytics |
| S19 | [Sensor Tower — Southeast Asian mobile game market insights 2024](https://sensortower.com/blog/southeast-asian-mobile-game-market-insights-2024) · [Sensor Tower SEA 2025](https://sensortower.com/blog/southeast-asia-mobile-gaming-2025) | analytics |
| S20 | [Sensor Tower — Top 5 idler games US Q4 2023](https://sensortower.com/blog/2023-q4-unified-top-5-idler%20games-revenue-us-602ae7fb241bc16eb874f8e1) | analytics |
| S21 | [Sensor Tower — Top tower defense games Android US Q2 2025](https://sensortower.com/blog/2025-q2-android-top-5-tower%20defense%20games-revenue-us-6012932d241bc16eb85e0db8) | analytics |
| S22 | [PocketGamer.biz — Capybara Go surpasses $100M](https://www.pocketgamer.biz/habbys-capybara-go-surpasses-100m-in-gross-player-spending) | analytics |
| S23 | [Gamigion — Habby portfolio](https://www.gamigion.com/?p=30038) | บล็อก (อ้าง AppMagic) |
| S24 | [PocketGamer — Capybara Go (Ahead of the Game)](https://www.pocketgamer.com/ahead-of-the-game/capybara-go) · [MuMu — Capybara Go beginner's guide](https://mumuglobal.com/blog/games/capybara-go.html) | บล็อก |
| S25 | [Game World Observer — Archero 2 $8M in 11 days](https://gameworldobserver.com/2025/01/20/archero-2-revenue-8-million-in-11-days-vs-original-game) | analytics (AppMagic) |
| S26 | [iTiger — Sensor Tower Chinese publishers overseas](https://www.itiger.com/news/1143976939) | analytics ผ่านแหล่งรอง |
| S27 | [BlueStacks — Whiteout Survival gameplay guide](https://www.bluestacks.com/blog/game-guides/white-out-survival/wos-gameplay-guide-en.html) | บล็อก |
| S28 | [Orcz — Whiteout Survival review](https://orcz.com/whiteout-survival-review-strategy-survival-and-the-tyranny-of-the-timer/) · [MuMu — Whiteout tips](https://mumuglobal.com/blog/master-whiteout-survival-tips-for-thriving.html) | บล็อก |
| S29 | [Webull — Sensor Tower: Whiteout Survival tops Dec 2025](https://www.webull.com/news/14159596960171008) | analytics ผ่านแหล่งรอง |
| S30 | [DroidGamers — Asynchronous PvP tower defender Guns Up! Mobile](https://www.droidgamers.com/2022/03/31/asychronous-pvp-tower-defender-guns-up-mobile-out-now/) | บล็อก |
| S31 | [Mobalytics — What is The Bazaar](https://mobalytics.gg/the-bazaar/guides/what-is-the-bazaar) · [Mobalytics — The Bazaar review](https://mobalytics.gg/gamebase/reviews/the-bazaar-review) | บล็อก |
| S32 | [PocketGamer.biz — Kingshot's first year: $800m, backlash from whales](https://www.pocketgamer.biz/kingshots-first-year-800m-11-months-of-growth-but-backlash-from-whales) · [MobileGamer.biz — Kingshot hits $1bn](https://mobilegamer.biz/data-digest-epic-layoffs-us-top-grossing-charts-kingshot-hits-1bn-puzzle-analysis-more/) | analytics |
| S33 | [Appfigures — Kingshot hit $500M in under a year](https://appfigures.com/resources/insights/kingshot-500m-revenue-century-games) | analytics |
| S34 | [PocketGamer — Kingshot hands-on (ads)](https://www.pocketgamer.com/kingshot/hands-on/) · [Grand Screen — Kingshot reviews](https://grand-screen.com/games/kingshot/reviews/) | บล็อก |
| S35 | [MY.GAMES — Rush Royale achieves $500M lifetime revenue](https://about.my.games/news/567) | ทางการ |
| S36 | [Diandian — Random Dice / 111%](https://www.diandian.com/en/news/K62Fr6rLzfihMzH8EAp2) · [Inven Global — Random Dice 2 launch](https://labs.invenglobal.com/articles/24703/111-officially-launches-new-title-random-dice-2) | analytics ผ่านแหล่งรอง |
| S37 | [Sensor Tower (KR) — Lucky Defense highest grossing Korean strategy game](https://sensortower.com/ko/blog/Lucky-Defense-has-become-the-highest-grossing-Korean-strategy-game) · [Sensor Tower — State of mobile games in Korea 2024](https://sensortower.com/blog/state-of-mobile-games-in-korea-2024) | analytics |
| S38 | [GameBusiness.jp — Lucky Defense leads Korea 2024 (Sensor Tower)](https://www.gamebusiness.jp/article/2024/11/14/23663.html) · [Baijing](https://www.baijing.cn/article/51336) | analytics ผ่านสื่อ |
| S38b | [Gamigion — Lucky Defense](https://www.gamigion.com/lucky/) · [Backloggd — What the Luck?](https://backloggd.com/games/what-the-luck/) | บล็อก |
| S39 | [Raijin — Legion TD 2](https://raijin.gg/app/469600/Legion_TD_2__Multiplayer_Tower_Defense) | analytics อิสระ |
| S40 | [Steambase — Legion TD 2 player count](https://steambase.io/apps/469600) | analytics อิสระ |
| S41 | [Steam Community — Legion TD 2 developer reply on player numbers](https://steamcommunity.com/app/469600/discussions/0/3421062490359978499) | ทางการ (ฟอรัม) |
| S41b | [Legion TD 2 wiki — Mercenaries](https://legiontd2.wiki.gg/wiki/Mercenaries) | บล็อก (วิกิ) |
| S42 | [Raijin — Mechabellum](https://raijin.gg/app/669330/Mechabellum) | analytics อิสระ |
| S43 | [Game World Observer — GameAnalytics benchmark engagement metrics for idle games](https://gameworldobserver.com/2020/12/22/gameanalytics-names-benchmark-engagement-metrics-idle-games) · [GameRefinery — Hyper-casual vs idle](https://gamerefinery.com/hyper-casual-vs-idle-the-latest-trends-in-mobile-games) | analytics (ข้อมูล 2018–19) |
| S44 | [Kolibri Games — Playing is engaging](https://kolibrigames.com/blog/playing-is-engaging/) | ทางการ (บล็อกผู้พัฒนา) |
| S45 | [AppPricingLab — Galaxy Defense: Fortress TD (Google Play)](https://www.apppricinglab.com/app/google_play/com.cyberjoy.galaxydefense) | บล็อก (aggregator) |
| S46 | [Inderes — Flexion Mobile launches Kingdom Guard](https://www.inderes.fi/en/releases/flexion-mobile-launches-kingdom-guard-from-tap4fun) | ทางการ (อ้าง Sensor Tower) |
| S47 | [Steam — Summoners War: RUSH](https://store.steampowered.com/app/3813590/Summoners_War_RUSH/) · [PocketGamer — Summoners War: Rush launch](https://www.pocketgamer.com/summoners-war-rush/launch/) | ทางการ / บล็อก |
| S48 | [Digital Today — Com2uS 2025 operating profit falls 60%](https://www.digitaltoday.co.kr/cn/view/27922/com2us-2025-operating-profit-falls-60-percent-aims-rebound-with-new-titles-and-global-push) | ทางการ (ผ่านสื่อ) |
| S49 | [GameDev Reports — AppMagic Mobile Games Monetization Report 2025](https://gamedevreports.substack.com/p/appmagic-mobile-games-monetization) · [AppMagic top-10 hybrid-casual Q2'25](https://gamedevreports.substack.com/p/appmagic-top-10-hybrid-casual-games) | analytics |
| S50 | [Wikipedia — AFK Journey](https://en.wikipedia.org/wiki/AFK_Journey) | บล็อก (ข้อมูลพื้นฐาน) |
