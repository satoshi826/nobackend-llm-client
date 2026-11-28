// Where the fetch page is (see fetch/main.ts). The app never fetches arbitrary addresses itself.
// - unset: /fetch/ on the app's own origin (one deployment)
// - VITE_FETCH_URL set: a fetch page on a separate origin, out of reach of scripts running in the app
import { getLang } from '../i18n';
import { fetchRoutes, pageApiOn, pagesReachWeb, type FetchCheck } from './protocol';

const SAME_ORIGIN_PATH = `${(import.meta as any).env?.BASE_URL ?? '/'}fetch/`;
export const FETCH_URL: string = (import.meta as any).env?.VITE_FETCH_URL || (typeof location !== 'undefined' ? new URL(SAME_ORIGIN_PATH, location.origin).toString() : SAME_ORIGIN_PATH);
/** The fetch page's relay and Jina Reader, for settings to show (a fetch page built on its own gets the same VITE_FETCH_RELAY_URL) */
export const FETCH_ROUTES = fetchRoutes((import.meta as any).env ?? {});
/** Experimental (VITE_EXPERIMENTAL_PAGE_API): what pages the user shows may use, the web only with a relay */
export const PAGE_API = pageApiOn((import.meta as any).env ?? {});
export const PAGE_WEB = pagesReachWeb((import.meta as any).env ?? {});
export const FETCH_ORIGIN = typeof location !== 'undefined' ? new URL(FETCH_URL, location.origin).origin : '';

/**
 * The fetch page for one address (with what the app found about it, state/fetch-check.ts), or with view=settings its
 * own settings (the Jina Reader key, the remembered sites). Told which app opened it (it answers only to allowed app
 * origins), in the app's language and theme
 */
export function fetchPageUrl(params: { url: string; mode: 'read' | 'save'; check?: FetchCheck } | { mode: 'page' } | { view: 'settings' }): string {
  // In the fragment: the address the model asked for must not reach the host's request logs
  const u = new URL(FETCH_URL);
  const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const { check, ...rest } = params as typeof params & { check?: FetchCheck };
  u.hash = new URLSearchParams({ ...rest, ...(check ? { check: JSON.stringify(check) } : {}), app: location.origin, lang: getLang(), theme }).toString();
  return u.toString();
}
