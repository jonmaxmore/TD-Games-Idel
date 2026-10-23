// Local progress: best stars per stage. Storage can be unavailable (private mode); fail soft.
const KEY = 'five-sects:stars:v1';

export function loadStars(): Record<string, boolean[]> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean[]>; } catch { return {}; }
}

export function saveStars(stageId: string, stars: boolean[]) {
  const all = loadStars();
  const prev = all[stageId] ?? [];
  all[stageId] = stars.map((s, i) => s || !!prev[i]);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
}
