// Thai labels for star conditions in stages.json.
export const STAR_LABEL: Record<string, string> = {
  clear: 'ผ่านด่าน',
  no_life_lost: 'ไม่เสียชีวิตเลย',
  under_3min: 'จบภายใน 3 นาที',
  hold_200_silver: 'จบด้วยเงิน 200 ขึ้นไป',
  max_6_disciples: 'ใช้ศิษย์ไม่เกิน 6 คน',
  use_combo: 'ใช้ยุทธ์ผสาน',
  no_disciple_down: 'ไม่มีศิษย์ล้ม',
};

export const STAGE_TYPE_TH: Record<string, string> = {
  training: 'ลานฝึก', defend: 'ตั้งรับ', assault: 'บุกค่าย', escort: 'คุ้มกัน', siege: 'ปิดล้อม', boss: 'ดวลบอส', puzzle: 'ปริศนา',
};

export const starString = (stars: boolean[] | undefined, n = 3) =>
  Array.from({ length: n }, (_, i) => (stars?.[i] ? '★' : '☆')).join('');
