# ศิษย์วัดวัชระศิลา · `earth`

> ชุดงาน 1 · ตัวละคร · การ์ดนี้สร้างจาก `docs/data` ด้วย `npm run art:brief` (อย่าแก้มือ) · สเปกรวมและวิธีส่งงาน: [art-bible](../art-bible.md)

![mockup earth](../mockups/earth.png)

_mockup นี้บอกแค่ **สัดส่วนและสี** ไม่ใช่สไตล์สุดท้าย ศิลปินออกแบบรายละเอียดเองตาม art-bible_

| หัวข้อ | รายละเอียด |
|---|---|
| ธาตุ | ดิน 土 |
| ชื่อ (EN) | Vajra Stone Monastery |
| บทบาท | splash, stun, blocker |
| silhouette | broad, bald monk with staff |
| อาวุธ | staff (gun) / iron body |
| สีหลัก | `#C99A4A` |
| palette | **shared:** `#1A1423` `#F2C9A0` `#C9966E` `#E3B04B` `#D2412F` `#EEF3F8`<br>**earth:** `#DEC191` `#C99A4A` `#A97D33` `#836127` `#5F471C` `#402F13` |
| ขนาดเฟรม | 48×64 (pivot ที่เท้า, หันขวา) |
| ท่า | idle 4 · attack 6 · skill 8 · levelUp 6 @ 10 fps |
| ขั้นเลเวล (ของประดับเพิ่ม ไม่เปลี่ยนโครง) | Lv1 ไม้พลองสะเทือนขุนเขา: splash r=1<br>Lv2 ระฆังทอง: can be placed ON the path to block 3 enemies, immune 4s<br>Lv3 ท่วงท่าธรณีไหว: stun all ground enemies in r=2 for 1s every 10s |
| ไฟล์ส่ง | `earth.aseprite` + `earth_idle.png`, `earth_attack.png`, `earth_skill.png`, `earth_levelUp.png` |

## การอ่านภาพในเกม

ไหล่กว้าง หัวโล้น พลองยาวเกินความสูงตัว เป็นตัวที่ "หนัก" ที่สุด ท่า idle ทิ้งน้ำหนักลงพื้น
