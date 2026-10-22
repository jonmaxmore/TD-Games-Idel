# Blender: ท่อผลิตภาพ และให้ Claude ปั้นงานใน Blender

> ส่วนหนึ่งของ [GDD §3](../GDD.md) · ข้อมูลภาพ (ขนาด, palette) อยู่ใน `docs/data/effects.json > render`

ใช้ Blender สองทาง:
1. **ท่อผลิตภาพ** (`npm run art:build`): ปั้นหรือวางท่าโมเดล 3D แล้วเรนเดอร์ออกมาเป็น sprite pixel art ทุกท่า
   - ได้ไฟล์ PNG และ atlas JSON ที่ใช้ได้ทั้ง Phaser และ Unity
   - รันบนเครื่องไหนก็ได้ที่มี Blender ไม่ต้องเปิดหน้าต่าง
2. **Claude สั่ง Blender** ผ่าน MCP: บนเครื่องที่เปิด Blender อยู่ สั่ง Claude เป็นภาษาธรรมดาได้ เช่น "ปั้นศิษย์สำนักหงส์เพลิง"
   - Claude สร้างโมเดล วัสดุ และท่าทางให้
   - บันทึกเป็น `.blend` แล้วส่งเข้าท่อที่ 1 ได้ทันที

## 1. ท่อผลิตภาพ

```
art/manifest.json        รายการ asset: ขนาด, กลุ่มสี, ท่า + จำนวนเฟรม, ต้นทาง (.blend หรือ proxy)
art/blender/*.blend      โมเดลจริงจากศิลปินหรือจาก Claude (MCP)
tools/blender/build.py   สคริปต์ที่รันใน Blender: เรนเดอร์ → ย่อเป็น pixel → ล็อกสีตาม palette → ขอบ 1px → sprite sheet
tools/blender/build.mjs  หาโปรแกรม Blender แล้วเรียก build.py (ใช้ผ่าน npm run art:build)
packages/client/public/sprites/   ผลลัพธ์ (<id>.png + <id>.json แบบ Phaser JSON-hash)
art/promo/               ภาพโปรโมตความละเอียดสูง (ไม่แปลงเป็น pixel)
```

**วิธีรัน**
```
npm run art:build                 # ทุก asset
npm run art:build -- metal        # เฉพาะ id ที่ระบุ
npm run unity:sync                # คัดลอก sprites (และ data) ไปโปรเจกต์ Unity
```
- ต้องมี Blender 4.x
- บน Windows สคริปต์จะหาใน `C:\Program Files\Blender Foundation` ให้เอง ถ้าติดตั้งไว้ที่อื่นให้ตั้งค่า `BLENDER=พาธ\blender.exe`

**กฎที่สคริปต์บังคับ**
- ขนาดเฟรมมาจาก `effects.json > render` เช่น `characterSprite`, `tile` หรือระบุ `[w, h]` เองใน manifest
- ทุกพิกเซลต้องเป็นสีใน `render.palette` ตามกลุ่มที่ระบุ และไม่มีพิกเซลโปร่งแสงครึ่งๆ
- ขอบ 1px สี `#1A1423` สำหรับตัวละคร
- รันซ้ำได้ไฟล์เดิมทุกไบต์ ทดสอบโดย `tools/blender/atlas.test.ts` ใน `npm test`
- ตัวละครหันขวาอย่างเดียว เอนจินกลับด้านเองเมื่อหันซ้าย

**เพิ่ม asset ใหม่จากไฟล์ .blend**
```json
{ "id": "fire", "kind": "character", "size": "characterSprite", "palette": ["shared", "fire"], "outline": true,
  "source": { "blend": "art/blender/fire.blend", "object": "Rig", "actions": { "idle": "Idle", "attack": "Fan_Attack" } },
  "actions": { "idle": 4, "attack": 6 } }
```
- `object` คือชื่อ object ที่มี animation (มักเป็น armature)
- `source.actions` จับคู่ชื่อท่าในเกมกับชื่อ Action ใน Blender
- สคริปต์ตั้งกล้องและไฟเอง คนปั้นจึงไม่ต้องจัดกล้องในไฟล์

**สถานะตอนนี้:** asset ทั้งหมดใน manifest ยังเป็น **proxy** ที่ประกอบจากรูปทรงพื้นฐาน มีไว้พิสูจน์ว่าท่อทำงานครบวงจร ยังไม่ใช่ภาพจริงของเกม และยังไม่ได้ต่อเข้าเกม จะต่อเมื่อมีภาพจริงและตัดสินขนาด sprite แล้ว

## 2. ให้ Claude สั่ง Blender (MCP)

ใช้ [MCP for Blender](https://github.com/ahujasid/blender-mcp) (ชื่อเดิม `blender-mcp`) ปักเวอร์ชัน **2.1.9** ไว้ใน `.mcp.json` ของ repo
- ใน session cloud จะเชื่อมต่อไม่ได้ เพราะไม่มี Blender เปิดอยู่ เป็นเรื่องปกติ
- ต้องใช้กับ Claude ที่รันบนเครื่องคุณ (Claude Code ในโฟลเดอร์ repo หรือ Claude Desktop)

**ติดตั้งบน Windows (ครั้งเดียว)**
1. ติดตั้ง Blender 4.x จาก blender.org
2. เปิด Command Prompt แล้วติดตั้ง uv: `winget install --id=astral-sh.uv -e` จากนั้นปิดและเปิด Command Prompt ใหม่
3. ติดตั้ง addon: `uvx mcp-for-blender==2.1.9 install-addon`
4. เปิด Blender → **Edit → Preferences → Add-ons** → เปิด **Interface: MCP for Blender**
5. ในหน้าต่าง 3D กด `N` → แท็บ **MCP for Blender** → กด **Start MCP Server** ถ้ายังไม่ได้เริ่ม
6. เลือกตัว Claude ที่จะใช้
   - **Claude Code บนเครื่อง:** เปิด terminal ในโฟลเดอร์ repo (`C:\Users\ooo\FiveSects`) แล้วพิมพ์ `claude` ระบบจะอ่าน `.mcp.json` และถามว่าอนุญาต server `blender` หรือไม่ ให้กดอนุญาต
   - **Claude Desktop:** เพิ่มค่าเดียวกับใน `.mcp.json` (ส่วน `"blender"`) ลงใน `claude_desktop_config.json` แล้วปิดแอปจาก system tray และเปิดใหม่
     - ถ้าขึ้น `spawn uvx ENOENT` ให้ใช้พาธเต็มของ `uvx.exe` (ดูได้จาก `where uvx`)

**ตัวอย่างคำสั่ง**
- "ปั้นศิษย์สำนักหงส์เพลิงตาม GDD §3 แบบ chibi สูง 2.5 หัว ถือพัด ทำท่า Idle กับ Fan_Attack แล้วบันทึกเป็น art/blender/fire.blend"
- "เพิ่ม fire ลง art/manifest.json แล้วรัน npm run art:build -- fire ให้ดูผล"

**ความปลอดภัย**
- เปิด `BLENDER_MCP_SAFE_MODE=1` ไว้แล้ว ทุกสคริปต์ถูกตรวจก่อนรัน และสคริปต์ที่อ่าน/เขียนไฟล์ตรง รันโปรแกรมอื่น หรือใช้เน็ตจะถูกบล็อก
- ปิด telemetry ไว้แล้ว (`DISABLE_TELEMETRY=true`)
- addon เปิด port 9876 ในเครื่อง ใครเข้าถึง port นี้ได้ก็สั่งรันโค้ดใน Blender ได้ ปิด MCP server ใน Blender เมื่อไม่ใช้

## 3. ใช้ร่วมกับ Unity
- **sprite 2D (ทางหลักของเกมนี้):** `npm run unity:sync` คัดลอก PNG และ atlas ไปไว้ที่ `prototypes/unity/Assets/Resources/sprites` ฝั่ง Unity ตั้ง Sprite Mode เป็น Multiple, Filter เป็น Point แล้วตัดเฟรมตาม atlas
- **โมเดล 3D ตรงๆ:** วาง `.blend` ใน `Assets/` ได้เลย Unity จะเรียก Blender ที่ติดตั้งในเครื่องให้แปลงเอง หรือ export เป็น FBX ก็ได้ ใช้กับภาพโปรโมตหรือฉาก cut-in
- **Claude คุมสองโปรแกรมพร้อมกัน:** Claude บนเครื่องเดียวกันเปิด MCP ได้หลายตัว เพิ่ม MCP ของ Unity คู่กับ Blender แล้วสั่งต่อเนื่องได้ เช่น "ปั้นใน Blender → เรนเดอร์ → นำเข้า Unity → วางในฉาก"
  - ตัวเลือก MCP ของ Unity จะเลือกและปักเวอร์ชันเมื่อตัดสินเอนจินแล้ว
