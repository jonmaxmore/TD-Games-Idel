// The shared HUD parts every screen builds from (ux-audit.md, "ชุดชิ้นส่วนกลาง"): the button set and the confirm box.
// Their look lives in style.css under the matching class names.
import { el } from './battle';

export type Variant = 'primary' | 'secondary' | 'ghost' | 'icon' | 'danger';
export type Size = 'sm' | 'md' | 'lg';

// One button of the set. cls adds a screen's own class (a hook for shots and layout, never a new look).
export function button(text: string, onclick: () => void, variant: Variant = 'secondary', size: Size = 'md', cls = ''): HTMLButtonElement {
  const b = el('button', `btn btn-${variant} btn-${size}${cls ? ` ${cls}` : ''}`, text);
  b.type = 'button';
  b.onclick = onclick;
  return b;
}

// A disabled button keeps its frame and says why it cannot be pressed, as its tooltip and as the line under it when a
// screen shows one (the caller places the returned reason line).
export function setDisabled(b: HTMLButtonElement, why: string | null): void {
  b.disabled = why != null;
  b.title = why ?? '';
  if (why) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
}

export interface Confirm { title: string; body: string; yes: string; no?: string; danger?: boolean }
// A confirm box over host: what happens in plain words, cancel on the left (focused, the safe default), the action on the
// right. Esc or a click outside cancels. Its keys are caught before the screen's own (a capture listener), so Esc here
// never also pauses or leaves the screen under it.
export function confirmBox(host: HTMLElement, c: Confirm, onYes: () => void, onNo: () => void = () => {}): () => void {
  const back = el('div', 'overlay confirm'), sheet = el('div', 'sheet panel'), row = el('div', 'confirm-row');
  back.setAttribute('role', 'alertdialog');
  back.setAttribute('aria-modal', 'true');
  back.setAttribute('aria-label', c.title);
  let closed = false;
  const close = () => { if (closed) return; closed = true; removeEventListener('keydown', onKey, true); back.remove(); };
  const no = button(c.no ?? 'ยกเลิก', () => { close(); onNo(); }, 'ghost', 'md', 'confirm-no');
  const yes = button(c.yes, () => { close(); onYes(); }, c.danger ? 'danger' : 'primary', 'md', 'confirm-yes');
  row.append(no, yes);
  sheet.append(el('h2', '', c.title), el('p', 'confirm-body', c.body), row);
  back.append(sheet);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) { close(); onNo(); } });
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
    onNo();
  }
  addEventListener('keydown', onKey, true);
  host.append(back);
  no.focus();
  return close;
}

// A key typed into a text field belongs to the field: the game's shortcuts (F for full screen) leave it alone.
export const typing = (e: KeyboardEvent): boolean => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox') || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement);
};

// Listeners that live as long as the screen on show: the screen change (main.ts go) aborts them all, so a screen that
// never got its closing key or event leaves nothing behind.
let screen = new AbortController();
export const screenSignal = () => screen.signal;
export function endScreen(): void { screen.abort(); screen = new AbortController(); }
