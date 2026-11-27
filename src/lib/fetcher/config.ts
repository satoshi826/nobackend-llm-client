// Where the fetch page is (see fetch/main.ts). The app never fetches arbitrary addresses itself.
// - unset: /fetch/ on the app's own origin (one deployment)
// - VITE_FETCH_URL set: a fetch page on a separate origin, out of reach of scripts running in the app
import { getLang } from '../i18n';
import { fetchRoutes, type FetchMode } from './protocol';

const SAME_ORIGIN_PATH = `${(import.meta as any).env?.BASE_URL ?? '/'}fetch/`;
export const FETCH_URL: string = (import.meta as any).env?.VITE_FETCH_URL || (typeof location !== 'undefined' ? new URL(SAME_ORIGIN_PATH, location.origin).toString() : SAME_ORIGIN_PATH);
/** The fetch page's relay and Jina Reader, for settings to show (a fetch page built on its own gets the same VITE_FETCH_RELAY_URL) */
export const FETCH_ROUTES = fetchRoutes((import.meta as any).env ?? {});
export const FETCH_ORIGIN = typeof location !== 'undefined' ? new URL(FETCH_URL, location.origin).origin : '';

/**
 * The fetch page for one address, or with view=settings its own settings (the Jina Reader key, the remembered sites).
 * Told which app opened it (it answers only to allowed app origins), in the app's language and theme
 */
export function fetchPageUrl(params: { url: string; mode: FetchMode } | { view: 'settings' }): string {
  // In the fragment: the address the model asked for must not reach the host's request logs
  const u = new URL(FETCH_URL);
  const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  u.hash = new URLSearchParams({ ...params, app: location.origin, lang: getLang(), theme }).toString();
  return u.toString();
}
