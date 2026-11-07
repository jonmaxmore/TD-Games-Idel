// The player's save: sound and shake settings and the last deck picked. Anything stored that no longer fits the data
// (an old TD save, a renamed card) falls back to defaults instead of a broken screen.
import { DECKS } from './decks';

export interface Profile {
  v: 2;
  deck: string; // a deck choice id (decks.ts)
  settings: Settings;
}

export interface Settings { volume: number; muted: boolean; shake: boolean } // volume 0..100

export function migrate(raw: unknown): Profile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const st = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>;
  const vol = st.volume;
  const deck = DECKS.some((d) => d.id === r.deck) ? (r.deck as string) : DECKS[0]!.id;
  return {
    v: 2,
    deck,
    settings: { volume: typeof vol === 'number' && vol >= 0 && vol <= 100 ? Math.round(vol) : 70, muted: st.muted === true, shake: st.shake !== false },
  };
}

const KEY = 'five-sects.profile';
let memory: string | null = null; // private mode can make localStorage throw; the save then lives for this page only

export function load(): Profile {
  let text = memory;
  try { text = localStorage.getItem(KEY); } catch { /* use memory */ }
  try { return migrate(text ? JSON.parse(text) : null); } catch { return migrate(null); }
}

export function save(p: Profile): void {
  memory = JSON.stringify(p);
  try { localStorage.setItem(KEY, memory); } catch { /* memory only */ }
}
