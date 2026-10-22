# ศิษย์สำนักหงส์เพลิง · `fire`

> ชุดงาน 1 · ตัวละคร · การ์ดนี้สร้างจาก `docs/data` ด้วย `npm run art:brief` (อย่าแก้มือ) · สเปกรวมและวิธีส่งงาน: [art-bible](../art-bible.md)

![mockup fire](../mockups/fire.png)

_mockup นี้บอกแค่ **สัดส่วนและสี** ไม่ใช่สไตล์สุดท้าย ศิลปินออกแบบรายละเอียดเองตาม art-bible_

| หัวข้อ | รายละเอียด |
|---|---|
| ธาตุ | ไฟ 火 |
| ชื่อ (EN) | Crimson Phoenix Sect |
| บทบาท | AoE burn |
| silhouette | wide stance, open fan |
| อาวุธ | fan |
| สีหลัก | `#FF5A1F` |
| palette | **shared:** `#1A1423` `#F2C9A0` `#C9966E` `#E3B04B` `#D2412F` `#EEF3F8`<br>**fire:** `#FF9E7B` `#FF5A1F` `#E53C00` `#B12F00` `#812200` `#561700` |
| ขนาดเฟรม | 48×64 (pivot ที่เท้า, หันขวา) |
| ท่า | idle 4 · attack 6 · skill 8 · levelUp 6 @ 10 fps |
| ขั้นเลเวล (ของประดับเพิ่ม ไม่เปลี่ยนโครง) | Lv1 พัดเพลิง: cone of fire, burn 6 dps 3s<br>Lv2 ขนหงส์กระจาย: burning enemies explode on death (30 dmg r=1)<br>Lv3 เพลิงคืนชีพ: every 20s a phoenix sweeps the path |
| ไฟล์ส่ง | `fire.aseprite` + `fire_idle.png`, `fire_attack.png`, `fire_skill.png`, `fire_levelUp.png` |

## การอ่านภาพในเกม

ยืนกว้าง พัดกางเป็นครึ่งวงกลมสีส้มทอง เป็น silhouette กว้างที่สุดในหกสำนัก
