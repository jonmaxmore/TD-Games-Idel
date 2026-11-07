// Thai writes a name with no spaces, so a browser may break กระบี่ในใจ anywhere inside it. Each space-separated
// chunk (a whole name or label) goes in a no-wrap span; lines then break only at spaces.
export const wordRuns = (text: string) => text.split(/(\s+)/).filter(Boolean).map((t) => ({ text: t, word: !/^\s+$/.test(t) }));

export function nowrapWords<T extends HTMLElement>(e: T, text: string): T {
  e.append(...wordRuns(text).map((r) => {
    if (!r.word) return r.text;
    const s = document.createElement('span');
    s.style.whiteSpace = 'nowrap';
    s.textContent = r.text;
    return s;
  }));
  return e;
}
