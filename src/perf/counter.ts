// Counting rendering work for performance measurements (scripts/perf, and `?perf` by hand). Only in a build made for
// it: the dev server, or a build with VITE_PERF=1 (the perf runner makes one); a release build has no perf mode at all.
// There it is on when the page is opened in perf mode: the perf runner sets window.__PERF__ before the app loads, and
// `?perf` in the address does the same by hand. Then every component render, mount, unmount and commit is counted in window.__perfCounts, by component
// name too (names are kept in development builds only; a production build counts them under minified names).
import { options } from 'preact';

declare global {
  interface Window {
    __PERF__?: boolean;
    __perfCounts?: PerfCounts;
  }
}

export interface PerfCounts {
  /** Component render functions called */
  renders: number;
  /** Components created */
  mounts: number;
  /** Components removed */
  unmounts: number;
  /** Times Preact applied changes to the page */
  commits: number;
  /** Renders by component name */
  byName: Record<string, number>;
  /** Renders by the nearest component above and the component ('Header > Button'): where repeated renders come from */
  byParent: Record<string, number>;
}

/** A build that can measure (decided when it is built, so a release build leaves the perf code out) */
export const PERF_BUILD = import.meta.env.DEV || import.meta.env.VITE_PERF === '1';

export const perfMode = PERF_BUILD && typeof window !== 'undefined' && (window.__PERF__ === true || new URLSearchParams(location.search).has('perf'));

/** Preact's hooks for its own tools (minified names: before render, commit) */
type VNode = { type: unknown; __c?: object; __?: VNode | null };
type Hooks = {
  __r?: (vnode: VNode) => void;
  __c?: (vnode: unknown, queue: unknown) => void;
  unmount?: (vnode: { type: unknown }) => void;
};

const nameOf = (type: unknown): string => (typeof type === 'function' ? (type as { displayName?: string }).displayName || type.name || 'anonymous' : String(type));

/** Start counting (once, before the app renders) */
export function startPerfCounting() {
  if (window.__perfCounts) return;
  const counts: PerfCounts = { renders: 0, mounts: 0, unmounts: 0, commits: 0, byName: {}, byParent: {} };
  window.__perfCounts = counts;
  const o = options as unknown as Hooks;
  const seen = new WeakSet<object>();
  const render = o.__r;
  o.__r = (vnode) => {
    counts.renders++;
    const instance = vnode.__c;
    if (instance && !seen.has(instance)) {
      seen.add(instance);
      counts.mounts++;
    }
    const name = nameOf(vnode.type);
    counts.byName[name] = (counts.byName[name] ?? 0) + 1;
    // The nearest component above (Preact's parent link: '__')
    let up = vnode.__;
    while (up && typeof up.type !== 'function') up = up.__;
    const pair = `${up ? nameOf(up.type) : '(root)'} > ${name}`;
    counts.byParent[pair] = (counts.byParent[pair] ?? 0) + 1;
    render?.(vnode);
  };
  const commit = o.__c;
  o.__c = (vnode, queue) => {
    counts.commits++;
    commit?.(vnode, queue);
  };
  const unmount = o.unmount;
  o.unmount = (vnode) => {
    if (typeof vnode.type === 'function') counts.unmounts++;
    unmount?.(vnode);
  };
}
