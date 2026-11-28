// Shared dialog behaviour for modals, confirm dialogs, the image viewer and the mobile sidebar:
// - only the top-most open dialog handles Esc
// - Tab / Shift+Tab stay inside the dialog
// - everything outside the dialog is made inert while it is open (except live regions such as toasts)
// - focus moves into the dialog ([data-autofocus] first, then the first field, then the first control)
//   and returns to the previously focused element when it closes (through the nearest shown control when that one
//   is hidden). On touch devices it skips unmarked fields (focusing one would bring up the on-screen keyboard)
import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import { touchDevice } from './device';

const stack: HTMLElement[] = [];

/** The element that last lost focus */
let lastBlurred: EventTarget | null = null;
if (typeof document !== 'undefined') document.addEventListener('focusout', (e) => (lastBlurred = e.target), true);

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/** The controls inside el that can take focus now, in Tab order */
export function focusables(el: HTMLElement): HTMLElement[] {
  // Not the tabs of a tab list other than its selected one (tabindex -1: the arrow keys reach them)
  return [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.tabIndex >= 0 && !x.closest('[inert]') && x.getClientRects().length > 0);
}

const FIELD = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])';

function initialTarget(el: HTMLElement): HTMLElement | null {
  const marked = el.querySelector<HTMLElement>('[data-autofocus]');
  if (marked) return marked;
  if (!touchDevice) {
    const field = el.querySelector<HTMLElement>(FIELD);
    if (field) return field;
  }
  const controls = touchDevice ? focusables(el).filter((x) => !x.matches(FIELD)) : focusables(el);
  return controls.find((x) => !x.hasAttribute('data-dialog-close')) ?? controls[0] ?? null;
}

/** Make every sibling along the path from el to <body> inert; returns an undo function */
function inertOutside(el: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sib of Array.from(parent.children) as HTMLElement[]) {
      if (sib === node || sib.inert || sib.hasAttribute('data-live') || sib.hasAttribute('data-dialog-backdrop') || sib.tagName === 'SCRIPT') continue;
      sib.inert = true;
      changed.push(sib);
    }
    node = parent;
  }
  return () => {
    for (const x of changed) x.inert = false;
  };
}

/**
 * Focus el; one shown only while focus is near it (a row's buttons) is hidden once the dialog took focus, so the
 * nearest control that is shown takes it first, and el, now shown, after it
 */
function refocus(el: HTMLElement) {
  el.focus();
  for (let near = el.parentElement; document.activeElement !== el && near && near !== document.body; near = near.parentElement) {
    const first = focusables(near)[0];
    if (!first) continue;
    first.focus();
    el.focus();
    return;
  }
}

export function useDialog(ref: RefObject<HTMLElement | null>, opts: { onClose(): void; active?: boolean }) {
  const active = opts.active ?? true;
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    // A field inside may have focused itself already (autoFocus): then the opener is what had focus before it
    const previous = (el.contains(document.activeElement) ? lastBlurred : document.activeElement) as HTMLElement | null;
    stack.push(el);
    const undoInert = inertOutside(el);
    // Focus after the content has rendered
    const t = setTimeout(() => {
      if (!el.contains(document.activeElement)) initialTarget(el)?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== el) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        opts.onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables(el);
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const cur = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (cur === first || !el.contains(cur))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (cur === last || !el.contains(cur))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      const i = stack.lastIndexOf(el);
      if (i >= 0) stack.splice(i, 1);
      undoInert();
      if (previous && previous.isConnected && !previous.closest('[inert]')) refocus(previous);
    };
    // opts.onClose may change identity every render; the latest one is read through the closure on each key press
  }, [active]);
}
