// One tooltip for the whole app, drawn by the app (the browser's own, from `title`, is slow, ignores the keyboard and
// does not look like the app). Nothing on screen hides what it is, without each component asking for it:
// - a control with no visible text (an icon button) shows its name, its aria-label
// - text cut off with an ellipsis, or clamped to some lines, shows in full, and only while it is cut off
// - data-tip="…" on an element adds an explanation where one is wanted beyond its name
// Where: below what it names (above when there is no room); a cut-off text in a narrow column marked data-tip-beside
// (the sidebar) shows beside the column instead, level with its row
// Shown after 0.4 s of hover (at once when moving from one to the next), at once on keyboard focus; gone on a press,
// a scroll, Esc or leaving. Not on touch, which has no hover. Hidden from screen readers: names and full texts are
// already read from the page.

const DELAY = 400;
/** After one hides, the next shows at once within this long (moving along a row of buttons) */
const GRACE = 300;
const GAP = 6;
const EDGE = 8;

const CONTROL = 'button, a[href], input, select, [role="button"], [role="switch"], [role="tab"], [role="menuitem"], [role="separator"]';

let bubble: HTMLDivElement | null = null;
let anchor: Element | null = null;
let timer = 0;
let hiddenAt = 0;

/** Whether the element's own text is cut off (an ellipsis on one line, or lines clamped) */
function cutOff(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const style = getComputedStyle(el);
  if (style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) return true;
  return style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '' && el.scrollHeight > el.clientHeight + 1;
}

/** What the element under the pointer (or focused) should say, from it up to the nearest that says something */
function tipFor(from: EventTarget | null): { el: Element; text: string; cut: boolean } | null {
  for (let el = from instanceof Element ? from : null; el && el !== document.body; el = el.parentElement) {
    const explicit = el.getAttribute('data-tip');
    if (explicit) return { el, text: explicit, cut: false };
    if (cutOff(el)) return { el, text: (el as HTMLElement).innerText.trim(), cut: true };
    if (el.matches(CONTROL)) {
      const label = el.getAttribute('aria-label');
      // A control with words on it says them itself, a text field its placeholder
      return label && !el.textContent?.trim() && !el.getAttribute('placeholder') ? { el, text: label, cut: false } : null;
    }
  }
  return null;
}

function show(t: { el: Element; text: string; cut: boolean }) {
  if (!t.el.isConnected || !t.text) return;
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.className = 'tooltip panel';
    bubble.setAttribute('role', 'tooltip');
    bubble.setAttribute('aria-hidden', 'true');
    document.body.append(bubble);
  }
  bubble.textContent = t.text;
  bubble.style.left = '0px';
  bubble.style.top = '0px';
  bubble.dataset.shown = '';
  const r = t.el.getBoundingClientRect();
  const w = bubble.offsetWidth;
  const h = bubble.offsetHeight;
  const place = (left: number, top: number) => {
    bubble!.style.left = `${Math.round(Math.max(EDGE, Math.min(innerWidth - w - EDGE, left)))}px`;
    bubble!.style.top = `${Math.round(Math.max(EDGE, Math.min(innerHeight - h - EDGE, top)))}px`;
  };
  // Cut-off text in a narrow column (data-tip-beside: the sidebar): beside the column, level with the row, so it
  // covers neither the other rows nor the row's own buttons
  const column = t.cut ? t.el.closest('[data-tip-beside]') : null;
  if (column) {
    const c = column.getBoundingClientRect();
    if (c.right + GAP + w <= innerWidth - EDGE) return place(c.right + GAP, r.top + r.height / 2 - h / 2);
  }
  // Else below (above when there is no room): a cut-off text's full text starts where it starts, a control's name
  // is centred on it
  const top = r.bottom + GAP + h <= innerHeight - EDGE ? r.bottom + GAP : r.top - h - GAP;
  place(t.cut ? r.left - 9 : r.left + r.width / 2 - w / 2, top);
}

function hide() {
  clearTimeout(timer);
  if (anchor && bubble?.dataset.shown !== undefined) hiddenAt = performance.now();
  anchor = null;
  if (bubble) delete bubble.dataset.shown;
}

function onOver(e: PointerEvent) {
  if (e.pointerType === 'touch') return;
  const t = tipFor(e.target);
  if (t?.el === anchor) return;
  const showing = bubble?.dataset.shown !== undefined;
  hide();
  if (!t) return;
  anchor = t.el;
  if (showing || performance.now() - hiddenAt < GRACE) show(t);
  else timer = window.setTimeout(() => show(t), DELAY);
}

function onOut(e: PointerEvent) {
  if (anchor && !(e.relatedTarget instanceof Node && anchor.contains(e.relatedTarget))) hide();
}

function onFocus(e: FocusEvent) {
  const el = e.target;
  if (!(el instanceof Element) || !el.matches(':focus-visible')) return;
  const t = tipFor(el);
  hide();
  if (!t) return;
  anchor = t.el;
  show(t);
}

/** Turn it on for the whole app (once, at startup) */
export function installTooltips() {
  addEventListener('pointerover', onOver, true);
  addEventListener('pointerout', onOut, true);
  addEventListener('focusin', onFocus, true);
  addEventListener('focusout', hide, true);
  addEventListener('pointerdown', hide, true);
  addEventListener('scroll', hide, true);
  addEventListener('keydown', (e) => e.key === 'Escape' && hide(), true);
}
