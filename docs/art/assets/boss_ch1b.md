# ทูตจันทร์โลหิต · `boss_ch1b`

> ชุดงาน 2 · บอส บท 1 wave 20 · การ์ดนี้สร้างจาก `docs/data` ด้วย `npm run art:brief` (อย่าแก้มือ) · สเปกรวมและวิธีส่งงาน: [art-bible](../art-bible.md)

![mockup boss_ch1b](../mockups/boss_ch1b.png)

_mockup นี้บอกแค่ **สัดส่วนและสี** ไม่ใช่สไตล์สุดท้าย ศิลปินออกแบบรายละเอียดเองตาม art-bible_

| หัวข้อ | รายละเอียด |
|---|---|
| ธาตุ | ไฟ 火 |
| ชื่อ (EN) | Blood Moon Envoy |
| กลไก | each phase seals one sect (its disciples deal 0) - player must re-balance |
| palette | **shared:** `#1A1423` `#F2C9A0` `#C9966E` `#E3B04B` `#D2412F` `#EEF3F8`<br>**enemy:** `#8A2A1A` `#5A1820` `#2A0A10` `#3E5A2A` `#6E6A78` `#120A10`<br>**fire:** `#FF9E7B` `#FF5A1F` `#E53C00` `#B12F00` `#812200` `#561700` |
| ขนาดเฟรม | 128×128 |
| ท่า | idle 6 · attack 8 · phaseChange 12 · death 12 @ 12 fps |
| ไฟล์ส่ง | `boss_ch1b.aseprite` + `boss_ch1b_idle.png`, `boss_ch1b_attack.png`, `boss_ch1b_phaseChange.png`, `boss_ch1b_death.png` |

## การอ่านภาพในเกม

ทูตจันทร์โลหิต ฮู้ด หน้ากากทอง จันทร์แดงด้านหลัง แต่ละเฟสผนึกหนึ่งสำนัก: จันทร์เปลี่ยนเป็นสีธาตุที่ถูกผนึก
