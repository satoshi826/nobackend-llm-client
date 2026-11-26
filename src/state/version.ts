// Which build is running, and whether a newer one is out (Settings → 情報, sidebar notice).
// The build writes /version.json next to the app (vite.config.ts). A running page fetches it now and then and
// compares commits. Nothing is applied by itself: the page keeps running the build it loaded until the user
// reloads (the Service Worker serves the page network-first, so a reload gets the new build).
import { signal } from '@preact/signals';

export interface BuildInfo {
  version: string;
  commit: string;
  /** ISO time of the build ('' in development) */
  builtAt: string;
}

declare const __APP_BUILD__: BuildInfo | undefined;

export const APP_BUILD: BuildInfo = typeof __APP_BUILD__ !== 'undefined' && __APP_BUILD__ ? __APP_BUILD__ : { version: 'dev', commit: 'dev', builtAt: '' };
export const isDevBuild = APP_BUILD.commit === 'dev';
export const shortCommit = (c: string) => (/^[0-9a-f]{7,}$/i.test(c) ? c.slice(0, 7) : c);

/** A newer build on the server (null: none seen, or not checked yet) */
export const newerBuild = signal<BuildInfo | null>(null);
export const updateCheck = signal<{ at: number; ok: boolean } | null>(null);

/** Fetch /version.json (bypassing caches) and note a newer build. Returns what the server has, or null on failure */
export async function checkForUpdate(): Promise<BuildInfo | null> {
  if (isDevBuild) return null;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(String(res.status));
    const info = (await res.json()) as BuildInfo;
    if (typeof info?.commit !== 'string') throw new Error('bad version file');
    newerBuild.value = info.commit !== APP_BUILD.commit ? info : null;
    updateCheck.value = { at: Date.now(), ok: true };
    return info;
  } catch {
    updateCheck.value = { at: Date.now(), ok: false };
    return null;
  }
}

const EVERY = 60 * 60 * 1000;
const ON_RETURN = 15 * 60 * 1000;

/** Check shortly after start, every hour, and when the tab comes back after a while */
export function watchForUpdates() {
  if (isDevBuild || typeof window === 'undefined') return;
  window.setTimeout(() => void checkForUpdate(), 10_000);
  window.setInterval(() => void checkForUpdate(), EVERY);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const last = updateCheck.value?.at ?? 0;
    if (Date.now() - last > ON_RETURN) void checkForUpdate();
  });
}
