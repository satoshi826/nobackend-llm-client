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

export function setHash(next: string) {
  if (location.hash !== next) history.replaceState(null, '', next || location.pathname);
}
