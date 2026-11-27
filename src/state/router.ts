// URL hash routes (#/c/<id> for conversations, #/f/<id> for files, ...). Features register theirs,
// so restoring the page after a reload does not need to know every kind of screen.
export interface Route {
  pattern: RegExp;
  open(match: RegExpExecArray): Promise<void> | void;
}

const routes: Route[] = [];

export function registerRoute(r: Route) {
  routes.push(r);
}

/** Open whatever the hash names (pass the hash read before anything resets it) */
export async function restoreRoute(hash = location.hash) {
  for (const r of routes) {
    const m = r.pattern.exec(hash);
    if (m) {
      await r.open(m);
      return;
    }
  }
}

/** The address without its hash: the query stays (`?perf` keeps perf mode's own data) */
const withoutHash = () => location.pathname + location.search;

export function setHash(next: string) {
  if (location.hash !== next) history.replaceState(null, '', next || withoutHash());
}

/** A new place the browser's Back returns from (e.g. a folder opened in the Files tab), not a change of the current one */
export function pushHash(next: string) {
  if (location.hash !== next) history.pushState(null, '', next || withoutHash());
}

// Back and Forward open what the hash they land on names (tests run without a window)
if (typeof window !== 'undefined') window.addEventListener('popstate', () => void restoreRoute(location.hash));
