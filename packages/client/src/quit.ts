// The pause menu's way out of a match (ui-flow.md §2.3, ux-audit.md P0-1). ศึกฝีมือ cannot be left for free: its only way
// out is ยอมแพ้, open from the 60th second, and it counts as a loss. ศึกปราบ and ศึกทั่วไป can be left, after a confirm
// that says the match will not count. A friend-room match (online) can be left at any time after a confirm: the server
// counts it as a forfeit and its end message brings the result, so the 60 s gate does not apply. A replay just stops.
import { TICK_HZ } from '@five-sects/sim';
import type { Confirm } from './ui';

export type QuitKind = 'ranked' | 'casual' | 'online' | 'replay';
export const SURRENDER_AFTER_SEC = 60; // ui-flow.md §2.3; moves to battle.json with the M1 online rules

export interface QuitRule {
  label: string;
  why: string | null; // why the button is closed right now, else null
  confirm: Confirm | null; // asked before leaving, null to leave at once
  surrender: boolean; // leaving ends the match as our loss
}

export function quitRule(kind: QuitKind, tick: number): QuitRule {
  if (kind === 'replay') return { label: 'กลับล็อบบี้', why: null, confirm: null, surrender: false };
  if (kind === 'casual') {
    return { label: 'ออกจากศึก', why: null, surrender: false, confirm: { title: 'ออกจากศึก?', body: 'ศึกนี้จะไม่นับผล และไม่ได้รางวัล', yes: 'ออกจากศึก', no: 'เล่นต่อ', danger: true } };
  }
  if (kind === 'online') {
    return { label: 'ยอมแพ้และออก', why: null, surrender: false, confirm: { title: 'ยอมแพ้และออก?', body: 'ศึกนี้นับเป็นแพ้ เพื่อนชนะทันที', yes: 'ยอมแพ้และออก', no: 'กลับสู่ศึก', danger: true } };
  }
  const left = Math.ceil((SURRENDER_AFTER_SEC * TICK_HZ - tick) / TICK_HZ);
  return {
    label: 'ยอมแพ้', surrender: true,
    why: left > 0 ? `ยอมแพ้ได้หลังวินาทีที่ ${SURRENDER_AFTER_SEC} (อีก ${left} วิ)` : null,
    confirm: { title: 'ยอมแพ้?', body: 'ศึกนี้นับเป็นแพ้ในแรงค์ศึกฝีมือ เหมือนปราสาทแตก', yes: 'ยอมแพ้', no: 'เล่นต่อ', danger: true },
  };
}
