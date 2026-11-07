// Thai has no spaces between words, so a browser may wrap a name like กระบี่ในใจ mid-word. Each word goes in a
// no-wrap span; lines then break only between words.
const seg = new Intl.Segmenter('th', { granularity: 'word' });

export const wordRuns = (text: string) => [...seg.segment(text)].map((s) => ({ text: s.segment, word: !!s.isWordLike }));

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
