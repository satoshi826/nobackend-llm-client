// When a fetch is redirected: the fetch page follows a redirect without asking only while it stays on the same site,
// or goes to a site the user chose not to be asked about for this mode; any other is asked about like a new address.
// (An open redirect on a remembered site would otherwise take whatever the model put in the address to any site.)
import { fetchableUrl } from '../src/lib/fetcher/protocol';

/** Redirects followed in one fetch, asked about or not */
export const MAX_REDIRECTS = 5;

/**
 * What to do with a redirect from `from` to `location` (null: the browser hides where it leads, as it does for a
 * direct fetch): follow it, ask about the address first (null: ask without knowing it), or refuse it (not https)
 */
export function redirectStep(from: URL, location: string | null, remembered: readonly string[]): { follow: URL } | { ask: URL | null } | { refuse: true } {
  if (location === null) return { ask: null };
  let to: URL | null;
  try {
    to = fetchableUrl(new URL(location, from).href);
  } catch {
    to = null;
  }
  if (!to) return { refuse: true };
  return to.host === from.host || remembered.includes(to.host) ? { follow: to } : { ask: to };
}
