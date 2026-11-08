# ตรวจความปลอดภัย: เซิร์ฟเวอร์ศึกกับเพื่อน (pvp-security)

**วันที่:** 2026-11-08 · **ขอบเขต:** `packages/game`, `packages/protocol`, `packages/client/src/net.ts`, `infra/`
**สเปก:** [SPEC-pvp-rooms.md](../../specs/SPEC-pvp-rooms.md) §7 (ที่แก้แล้ว) และ §11 (ก่อนเปิดแรงค์)
**ข้อสรุป:** ข้อที่ขวางการ deploy ห้องเพื่อน (H1–H3, M1, M2) แก้แล้วและมีเทสต์ เหลือ 2 อย่างที่ต้องทำต่อ:
- ticket แบบใช้ครั้งเดียวตาม ADR 0003 เป็นงานของ M1
- ข้อมูลที่ควรซ่อนและการเลือกทัพแบบไม่เห็นกัน ต้องเสร็จก่อนเปิด ranked

**สถานะ**
- **แก้แล้ว** = มีโค้ดและเทสต์ใน `packages/game/test` หรือ `packages/protocol/test`
- **ก่อนแรงค์** = รับได้ในห้องเพื่อน เขียนเป็นข้อกำหนดใน SPEC §11
- **M1** = ทำพร้อม backend จริง (PostgreSQL, Redis, บัญชี)

## ผลตรวจ

| ข้อ | ปัญหา | สถานะ | สิ่งที่ทำ / ที่อยู่ของเทสต์ |
|---|---|---|---|
| H1 | token ส่งเป็นข้อความเปล่าผ่าน `ws://` คนดักฟังใน Wi-Fi สาธารณะเอา token ไปแย่งที่นั่งกลางศึกได้ | แก้แล้ว + M1 | build release ล้มถ้า `VITE_GAME_SERVER` เป็น `ws:` (`vite.config.ts`) และ `net.ts` ปฏิเสธตอนรัน (`wsUrlError`, `protocol.test.ts` "server URL") TLS ตัดที่ proxy (SPEC §7) ส่วน ticket ใช้ครั้งเดียวเป็นงาน M1 |
| H2 | `trustProxy: false` หลัง proxy ทำให้ทุกคนเป็น IP เดียว ส่วน `true` ให้ปลอม IP ได้ และ IPv6 หมุน /64 ได้ไม่จำกัด | แก้แล้ว | `TRUST_PROXY` รับเฉพาะที่อยู่หรือ CIDR (ไม่รับ `/0`) และ `ipKey` นับ IPv6 เป็น /64 (`hardening.test.ts` "addresses") |
| H3 | ไม่มีกำหนดเวลา hello ไม่มี heartbeat ไม่มีเพดาน socket รวม จึงเปิด socket ค้างจนเต็มได้ | แก้แล้ว | hello ใน 5 วินาที, ping ทุก 15 วินาที ไม่ตอบ 2 ครั้งตัด (แล้วเริ่มนับเวลาต่อกลับ), socket รวม 2,000, แขกที่เงียบนอกห้อง 10 นาทีถูกส่งออก (`hardening.test.ts` "sockets") |
| M1 | เดารหัสห้องได้เมื่อหมุน IP ได้ แล้วเข้าไปกวนห้องคนอื่น | แก้แล้ว | งบรหัสผิดรวมทั้งเซิร์ฟเวอร์ 600/นาที, ผิด 5 ครั้งติดกันปิด socket, เจ้าของห้องเตะได้และคนที่ถูกเตะกลับเข้าห้องนั้นไม่ได้, `CODE_LEN` เป็นค่าคงที่ (`rooms.test.ts`, `hardening.test.ts` "rooms") |
| M2 | `hello` ด้วย token เดิมแต่ละครั้งส่งประวัติทั้งศึกใหม่ และไม่จำกัดอัตราเปิด socket จึงใช้ขยายแบนด์วิดท์ได้ | แก้แล้ว | socket ใหม่ต่อ IP 5 ทันที แล้ว 2/วินาที, ต่อกลับต่อ token 3 ทันที แล้ว 1/วินาที, cache ประวัติ frame ที่ serialise แล้วต่อแมตช์ |
| M3 | ข้อมูลเปิดหมด: client คำนวณมือคู่แข่ง ไพ่ที่จะจั่ว และสุ่มในอนาคตได้ | ก่อนแรงค์ | SPEC §11 ข้อ 1: ต้องตัดสินว่าเป็นเกมข้อมูลเปิดหรือซ่อนมือ (ถ้าซ่อนต้องแก้ sim พร้อม spec และ golden) |
| M4 | ผู้มาเยือนเห็นทัพเจ้าของห้องก่อน แล้วเลือกทัพแพ้ทางได้ | ก่อนแรงค์ | SPEC §11 ข้อ 2: เลือกแบบไม่เห็นกัน หรือ commit-reveal |
| L1 | นับ socket ต่อ IP หลัง upgrade การเปิดพร้อมกันหลายอันจึงผ่านเพดานได้ | แก้แล้ว | นับใน `preValidation` ก่อน upgrade และคืนเมื่อ TCP ปิด (`hardening.test.ts` "counts a socket before its upgrade") |
| L2 | ประทับ tick ย้อนหลังได้ถึง 10 tick จึงข้าม input delay ได้ราว 100–150 ms | ก่อนแรงค์ | SPEC §11 ข้อ 3: ใช้ `slack` รายผู้เล่นเป็นสัญญาณกันโกง |
| L3 | ฝ่ายใดส่ง hash ผิดก็ติดธงทั้งแมตช์ได้ | ก่อนแรงค์ | SPEC §11 ข้อ 4: ธงต้องไม่ช่วยฝ่ายที่ยกมัน และบันทึกว่าฝั่งไหนไม่ตรง |
| L4 | เขียนรีเพลย์แบบ sync บล็อก tick ของทุกห้อง และโฟลเดอร์โตไม่จำกัด | แก้แล้ว + M1 | เขียน async เป็นคิว เก็บไม่เกิน `REPLAY_MAX` ไฟล์ (`hardening.test.ts` "writes replays off the tick loop") ส่วนการย้ายไป object storage เป็นงาน M1 |
| L5 | ตั้งเวลา tick ด้วยนาฬิกาจริง เวลาเครื่องกระโดด (NTP) ทำให้ศึกหยุดหรือเร่ง | แก้แล้ว | ใช้ `performance.now()` ในเซิร์ฟเวอร์ (`hardening.test.ts` "match timing ignores a wall-clock step") ส่วน `packages/sim` ยังไม่มีนาฬิกา |
| L6 | ไม่ดู `bufferedAmount` client ที่ไม่อ่านทำให้เซิร์ฟเวอร์เก็บคิวไว้เรื่อย ๆ | แก้แล้ว | เกิน 1 MB ตัด socket แล้วให้ต่อกลับมารับประวัติใหม่ (ข้าม frame ไม่ได้เพราะจะ desync) (`hardening.test.ts` "cuts a client that is not reading") |
| L7 | image ไม่ตรึง digest, มี dev dependency ทั้งหมด, รันผ่าน vite-node, compose ไม่จำกัดสิทธิ์ | แก้แล้ว (ยังไม่ได้ build) | multi-stage + esbuild (`npm run build:server`), runtime มีแค่ dependency ของเซิร์ฟเวอร์ รันด้วย `node`, `node:22.23.4-bookworm-slim` ตรึง digest ที่ Docker Hub แสดง, compose: `cap_drop: ALL`, `no-new-privileges`, `mem_limit`, `pids_limit`, healthcheck |
| L8 | `/health` เปิดสาธารณะและบอกจำนวนห้อง | แก้แล้ว | ตอบแค่ `{ok:true}` (`hardening.test.ts` "/health") |
| I1 | origin ตรวจถูกแล้ว แต่ฟังนอกเครื่องโดยไม่ตั้ง `ORIGINS` ได้ | แก้แล้ว | เซิร์ฟเวอร์ไม่ยอมเริ่มถ้า `HOST` ไม่ใช่ loopback และไม่มี `ORIGINS` (`configFromEnv`, `hardening.test.ts` "refuses to listen") |
| I2 | session fixation | ไม่มีปัญหา | token ที่ไม่รู้จักถูกเพิกเฉยแล้วออกใหม่ และ `?server=` รับเฉพาะ loopback |
| I3 | token ไม่หมุนและอยู่ใน sessionStorage, XSS ขโมยได้ | M1 | ticket ตาม ADR 0003 และ CSP เข้ม (`connect-src` เฉพาะเซิร์ฟเวอร์เกม) |
| I4 | ชื่อหน้าตาคล้ายกันจากอักษรต่างระบบ | รับได้ | ตัวควบคุมและ bidi ถูก `NAME_RE` กันไว้แล้ว |

## วิธีพิสูจน์
- `npx vitest run packages/game packages/protocol`: เทสต์ใหม่อยู่ใน `packages/game/test/hardening.test.ts` (15 ข้อ), `rooms.test.ts` (ข้อรหัสผิด) และ `protocol.test.ts` ("server URL", ข้อความ `kick`)
- image: ลองขั้น runtime นอก Docker แล้ว (`npm ci --omit=dev -w @five-sects/game` ได้ 64 แพ็กเกจ ไม่มี vite หรือ vitest แล้ว `node server.mjs` ตอบ `/health`) และ `docker compose config` ผ่าน
- **ยังไม่ได้ build image จริง** เพราะ Docker daemon ในเครื่องนี้ไม่ได้รัน

## ยังไม่ได้ประเมิน
- ทดสอบโหลดจริง เช่น socket 2,000 อัน หรือการเดารหัสจากหลายพัน /64 พร้อมกัน ตอนนี้มีแค่เทสต์ตรรกะของเพดานด้วยค่าเล็ก
- ค่าที่เหมาะของงบรหัสผิดรวม (600/นาที): ผู้โจมตีใช้งบนี้หมดเพื่อกันคนอื่นเข้าห้องได้ (DoS) แลกกับการกันเดารหัส ต้องดูจากการใช้งานจริง
- การตั้งค่า reverse proxy และใบรับรอง TLS (ยังไม่ได้เลือกโฮสต์)
