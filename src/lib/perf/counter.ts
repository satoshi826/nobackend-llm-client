// Counting rendering work for performance measurements (scripts/perf, and `?perf` by hand). Off unless the page is
// opened in perf mode: the perf runner sets window.__PERF__ before the app loads, and `?perf` in the address does the
// same by hand. Then every component render, mount, unmount and commit is counted in window.__perfCounts, by component
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
}

export const perfMode = typeof window !== 'undefined' && (window.__PERF__ === true || new URLSearchParams(location.search).has('perf'));

/** Preact's hooks for its own tools (minified names: before render, commit) */
type Hooks = {
  __r?: (vnode: { type: unknown; __c?: object }) => void;
  __c?: (vnode: unknown, queue: unknown) => void;
  unmount?: (vnode: { type: unknown }) => void;
};

const nameOf = (type: unknown): string => (typeof type === 'function' ? (type as { displayName?: string }).displayName || type.name || 'anonymous' : String(type));

/** Start counting (once, before the app renders) */
export function startPerfCounting() {
  if (window.__perfCounts) return;
  const counts: PerfCounts = { renders: 0, mounts: 0, unmounts: 0, commits: 0, byName: {} };
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
