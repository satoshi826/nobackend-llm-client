// Inertial wheel scrolling, for screens with a mouse or trackpad. A turn of the wheel does not move a scrolling area
// at once: it moves the area's target, and the area eases toward it a little each frame. The area's own scroll
// position is what moves, so sticky headers, IntersectionObserver and the app's own scroll handlers still work.
//
// - Only the wheel is taken over. Touch, keys and the scrollbar stay the browser's; a turn of the wheel starts from
//   wherever they left the area.
// - Which area: the nearest one under the pointer that can still move that way (an area at its end passes the turn
//   on, as the browser does). Sideways turns and pinch zoom (ctrl + wheel) are left to the browser.
// - A position the app sets while an area eases (a list keeping its place as older messages load above) moves the
//   target with it, so the ease never pulls the area back.
// - Easing is frame-rate independent damping, 1 - e^(-λ·dt) with λ = LERP × 60: at 60 fps an area covers LERP of
//   what is left each frame.
// - On while the setting is (Settings → 表示), and never when the system asks for less motion.

import { effect } from '@preact/signals';
import { settings } from '../state/settings';

/** The part of the remaining distance covered each frame at 60 fps */
const LERP = 0.1;
/** Pixels in a line, when the wheel reports lines (Firefox) */
const LINE = 100 / 6;

interface Ease {
  /** Where the area is, in fractions of a pixel */
  position: number;
  target: number;
  /** The position last written, as the area reported it back (a different one means the app moved it) */
  wrote: number | null;
  frame: number;
  last: number;
}

const eases = new WeakMap<Element, Ease>();
const maxOf = (el: Element) => el.scrollHeight - el.clientHeight;
const clamp = (y: number, max: number) => Math.max(0, Math.min(max, y));

/** The nearest area under the pointer that scrolls vertically and can still move by dy */
function areaFor(from: EventTarget | null, dy: number): Element | null {
  for (let el = from instanceof Element ? from : null; el; el = el.parentElement) {
    const max = maxOf(el);
    if (max <= 0) continue;
    const page = el === document.scrollingElement;
    if (!page && !/auto|scroll|overlay/.test(getComputedStyle(el).overflowY)) continue;
    const at = eases.get(el)?.frame ? eases.get(el)!.target : el.scrollTop;
    if (dy < 0 ? at > 0 : at < max - 0.5) return el;
  }
  return null;
}

function tick(el: Element, e: Ease, time: number) {
  const dt = Math.min((time - e.last) / 1000, 0.1);
  e.last = time;
  if (!el.isConnected) {
    e.frame = 0;
    return;
  }
  // Moved by someone else since the last frame: carry the ease along
  if (e.wrote !== null && Math.abs(el.scrollTop - e.wrote) > 1) {
    const by = el.scrollTop - e.wrote;
    e.position += by;
    e.target += by;
  }
  const max = maxOf(el);
  e.target = clamp(e.target, max);
  e.position += (e.target - e.position) * (1 - Math.exp(-LERP * 60 * dt));
  if (Math.abs(e.target - e.position) < 0.5) e.position = e.target;
  el.scrollTop = e.position;
  e.wrote = el.scrollTop;
  e.frame = e.position !== e.target ? requestAnimationFrame((t) => tick(el, e, t)) : 0;
}

function onWheel(ev: WheelEvent) {
  if (ev.defaultPrevented || ev.ctrlKey || !ev.cancelable || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
  const dy = ev.deltaY * (ev.deltaMode === 1 ? LINE : ev.deltaMode === 2 ? innerHeight : 1);
  if (!dy) return;
  const el = areaFor(ev.target, dy);
  if (!el) return;
  ev.preventDefault();
  let e = eases.get(el);
  if (!e) eases.set(el, (e = { position: 0, target: 0, wrote: null, frame: 0, last: 0 }));
  // Not easing: start from where the area is now (keys or the scrollbar may have moved it)
  if (!e.frame) {
    e.position = e.target = el.scrollTop;
    e.wrote = null;
    e.last = performance.now();
    e.frame = requestAnimationFrame((t) => tick(el, e, t));
  }
  e.target = clamp(e.target + dy, maxOf(el));
}

/** Follow the setting for the whole app (once, at startup): the wheel is listened to only while it is on */
export function installSmoothScroll() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  effect(() => {
    if (!settings.value.smoothScroll) return;
    addEventListener('wheel', onWheel, { passive: false });
    return () => removeEventListener('wheel', onWheel);
  });
}
