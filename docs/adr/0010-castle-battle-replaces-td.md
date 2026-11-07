# ADR 0010: ศึกชิงเมืองแทน tower defense ทั้งหมด

- Status: accepted
- Date: 2026-11-07
- Supersedes: ส่วน TD ของ [ADR 0005](0005-shadow-siege-two-worlds.md) (บุก–ตั้งรับ) และทุกเอกสารที่ถือ TD เป็นแกนเกม
- Details: [SPEC-castle-battle](../specs/SPEC-castle-battle.md), [reference-castle-battle](../design/reference-castle-battle.md), `docs/data/battle.json`, `packages/sim/src/battle.ts`

## Context
- เจ้าของเกมตัดสิน (2026-11-07) ว่าแกนเกมเป็น **ศึกชิงเมือง** แนวเดียวกับ 城とドラゴン เอาเฉพาะกลไก ชื่อ ภาพ และตัวเลขเป็นของเราเอง
- ต้นแบบใน `packages/sim/src/battle.ts` เล่นได้แล้ว: deterministic, บอทสองแบบชนะใกล้ 50% และมี golden
- การเก็บ TD ไว้คู่กันทำให้มีกฎสองชุด ข้อมูลสองชุด และหน้าจอสองแบบที่ต้องดูแล

## Decision
- **ตัด TD ออกทั้งหมด:** `defend.ts` บอท TD เทสต์และ golden ของ TD `sim:measure` หน้าจอวางศิษย์ และข้อมูลที่ TD ใช้อย่างเดียว (`stages.json`, `maps.json`, `enemies.json`, `items.json > secretArts/manuals`, `economy.json > inRun`)
- **ศึกชิงเมืองเป็นแกนของทุกโหมด** ทั้ง PvE (ศึกกับ AI) และ PvP โหมดเรือธง esports คือ **ศึกชิงเมือง 1v1** ส่วนโหมดบุก–ตั้งรับแบบ TD ยกเลิก
- แอปเปิดที่หน้าแรก → เลือกสำรับ → ศึก → ผล → กลับ
- เก็บไว้: `sects.json` (ห้าธาตุ, สำนัก, roster), `heroes.json`, `economy.json`, `effects.json` (palette), เอฟเฟกต์การต่อสู้ของ client และท่อภาพ PixelLab

## Consequences
- กฎมีชุดเดียวใน `packages/sim` (`battle.ts`) เทสต์ทั้งหมดเร็วขึ้นมาก
- เอกสารเก่าที่ยังพูดถึง TD (เช่น story, maps, pve-economy, SPEC-core, SPEC-front-flow) ต้องอ่านโดยถือ ADR นี้ก่อน และต้องเขียนใหม่ทีละฉบับเมื่อถึงงานส่วนนั้น
- โหมดที่ร่างบน TD (ตีสำนัก, ล่าบอส, หอคอย, ศึกสำนัก) และยุทธ์ผสาน/ปรมาจารย์ต้องออกแบบใหม่บนศึกชิงเมือง
- ด่านเนื้อเรื่อง การได้ฮีโร่ และขั้นตอนเปิดเกมครั้งแรก (ยินยอม PDPA, ด่านสอน, ตั้งชื่อ) ยังไม่มีในหน้าจอใหม่ ต้องทำตาม SPEC ถัดไป
