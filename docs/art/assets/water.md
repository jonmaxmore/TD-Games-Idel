# ศิษย์วังธาราเหมันต์ · `water`

> ชุดงาน 1 · ตัวละคร · การ์ดนี้สร้างจาก `docs/data` ด้วย `npm run art:brief` (อย่าแก้มือ) · สเปกรวมและวิธีส่งงาน: [art-bible](../art-bible.md)

![mockup water](../mockups/water.png)

_mockup นี้บอกแค่ **สัดส่วนและสี** ไม่ใช่สไตล์สุดท้าย ศิลปินออกแบบรายละเอียดเองตาม art-bible_

| หัวข้อ | รายละเอียด |
|---|---|
| ธาตุ | น้ำ 水 |
| ชื่อ (EN) | Frost Tide Palace |
| บทบาท | slow, freeze, control |
| silhouette | flowing robes, palms forward |
| อาวุธ | palm technique + ribbon |
| สีหลัก | `#4FB3FF` |
| palette | **shared:** `#1A1423` `#F2C9A0` `#C9966E` `#E3B04B` `#D2412F` `#EEF3F8`<br>**water:** `#ABDBFF` `#4FB3FF` `#0C96FF` `#0076CF` `#005596` `#003964` |
| ขนาดเฟรม | 48×64 (pivot ที่เท้า, หันขวา) |
| ท่า | idle 4 · attack 6 · skill 8 · levelUp 6 @ 10 fps |
| ขั้นเลเวล (ของประดับเพิ่ม ไม่เปลี่ยนโครง) | Lv1 ฝ่ามือเหมันต์: slow 30% for 2s<br>Lv2 บัวน้ำแข็ง: freeze 1.2s every 5th hit<br>Lv3 คลื่นไม่สิ้นสุด: wave pushes enemies back 1 tile every 12s |
| ไฟล์ส่ง | `water.aseprite` + `water_idle.png`, `water_attack.png`, `water_skill.png`, `water_levelUp.png` |

## การอ่านภาพในเกม

ชุดพลิ้ว ชายผ้า/แพรไหมลอยตามจังหวะ idle ฝ่ามือยื่นไปข้างหน้ามีแสงฟ้าอ่อน ผมสีอ่อนเป็นจุดจำ
