# ต้นแบบ Unity: ศึกห้าสำนัก ด่าน 1-1

ต้นแบบนี้มีไว้**เปรียบเทียบเอนจิน**กับเวอร์ชัน Phaser (`packages/client`) ในงานเดียวกัน ไม่ใช่ตัวเกมหลัก ผลการเทียบจะบันทึกใน [`docs/design/engine-comparison.md`](../../docs/design/engine-comparison.md)

## ในโปรเจกต์มีอะไร

| ส่วน | ไฟล์ | คืออะไร |
|---|---|---|
| กฎเกม (C#) | `Assets/Scripts/Sim/` | พอร์ตของ `packages/sim` (ตั้งรับ) ไม่พึ่ง UnityEngine (`noEngineReferences`) |
| ข้อมูลเกม | `Assets/Resources/data/*.json` | สำเนาจาก `docs/data` (อัปเดตด้วย `npm run unity:sync` ที่ root ของ repo) |
| หน้าเกม | `Assets/Scripts/Game/` | สร้างกล้อง พื้น ตัวละคร pixel และ HUD จากโค้ดทั้งหมด ไม่มี prefab |
| ทดสอบความตรงกัน | `Assets/Editor/Tests/ParityTests.cs` + `golden-*.json` | เล่นรีเพลย์ที่สร้างจาก TypeScript แล้วเทียบ hash ทุก 100 tick |
| เมนูช่วย | `Assets/Editor/FiveSectsMenu.cs` | สร้าง scene, Build WebGL, Build Android |

เล่นได้: วาง / อัปเกรด / ขายศิษย์กระบี่, 6 waves, ศัตรูชั้นยอด, คัมภีร์ยุทธ์ (เลือกอัตโนมัติ), ดอกเบี้ย, ดาว
ไม่มี: บุกค่าย, ไม้ตาย (กฎมีแต่ไม่มีปุ่ม), สำนักอื่นในด่านนี้, เสียง

## ขั้นตอน (ประมาณ 20–40 นาที รวมติดตั้ง)

1. **ติดตั้ง** Unity Hub แล้วติดตั้ง **Unity 6 LTS (6000.0.58f2 ขึ้นไป)** พร้อมโมดูล **WebGL Build Support** (และ **Android Build Support** ถ้าจะวัด APK)
2. **เปิดโปรเจกต์:** Unity Hub → Add → เลือกโฟลเดอร์ `prototypes/unity`
   - ครั้งแรกจะใช้เวลาสักพัก Unity สร้าง `Library/` และ `ProjectSettings/` ให้เอง
   - ถ้าขึ้นถามเรื่อง Input System / restart ให้กด **Yes**
   - ถ้าเวอร์ชันไม่ตรงกับที่ติดตั้ง ให้เลือกเปิดด้วย 6000.0.x ที่มี
3. **ทดสอบความตรงกันของกฎเกม:** Window → General → **Test Runner** → EditMode → Run All
   - ต้องผ่าน 3 เทสต์: `MatchesTypeScriptGolden(1-1)`, `MatchesTypeScriptGolden(T-1)`, `HashLayoutMatchesTypeScript`
   - ถ้าไม่ผ่าน ให้คัดลอกข้อความ error ทั้งหมดส่งกลับมา (บอกว่าเริ่มต่างกันที่ tick ไหน)
4. **เล่น:** เปิด `Assets/Scenes/Main.unity` (สร้างให้อัตโนมัติ หรือเมนู **Five Sects → Create Main Scene**) แล้วกด **Play**
   - แตะช่องหญ้าข้างทาง → เลือกสำนักเพื่อวาง
   - แตะศิษย์ → อัปเกรด/ขาย
   - มุมขวาล่างแสดง fps และเวลา boot
5. **Build WebGL:** เมนู **Five Sects → Build WebGL** → ได้โฟลเดอร์ `Builds/WebGL`
   ```bash
   npx serve prototypes/unity/Builds/WebGL     # แล้วเปิด URL ที่แสดงบนคอมและมือถือ (วง Wi-Fi เดียวกัน)
   ```
6. **(เลือกได้) Build Android:** เมนู **Five Sects → Build Android APK** → `Builds/Android/five-sects.apk`

## ภาษาไทย
ฟอนต์ที่มากับ Unity ไม่มีอักษรไทย HUD จึงเป็นภาษาอังกฤษโดยปริยาย ถ้าต้องการภาษาไทย ให้วางไฟล์ `Sarabun-Regular.ttf` (Google Fonts, OFL) ไว้ที่ `Assets/Resources/Fonts/` แล้ว HUD จะเปลี่ยนเป็นไทยเอง ขนาดฟอนต์จะถูกนับรวมใน build ด้วย ซึ่งเป็นส่วนหนึ่งของการเทียบ

## ค่าที่ต้องวัดแล้วส่งกลับมา

| ค่า | วัดอย่างไร |
|---|---|
| ผล Test Runner | ผ่าน / ไม่ผ่าน (ถ้าไม่ผ่านส่ง error) |
| ขนาด WebGL | ขนาดรวมโฟลเดอร์ `Builds/WebGL/Build` (MB) |
| เวลาโหลดบนคอม | เปิด DevTools → Network → Disable cache → รีโหลด → เวลาจนเห็นด่าน |
| เวลาโหลดบนมือถือ | เปิด URL บนมือถือ จับเวลาจนเห็นด่าน |
| fps | ตัวเลขมุมขวาล่าง ตอนมีศัตรูเยอะ (wave 5–6) บนคอมและมือถือ |
| ขนาด APK | ขนาดไฟล์ `five-sects.apk` (ถ้า build) |
| ความรู้สึก | ทำงานกับ editor สะดวกกว่า Phaser ไหม, ภาพคมไหม, กระตุกไหม |

## Build จาก command line (ไม่บังคับ)
```bash
"<path-to-Unity>" -batchmode -quit -projectPath prototypes/unity -executeMethod FiveSectsMenu.BuildWebGL -logFile -
"<path-to-Unity>" -batchmode -quit -projectPath prototypes/unity -runTests -testPlatform EditMode -testResults results.xml
```
