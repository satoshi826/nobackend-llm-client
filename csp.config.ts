// Builds the security headers (Cloudflare Pages _headers format) in one place.
// The app and the key vault get separate allowed destinations (least privilege):
//   app:   only requests that need no key (model lists, providers used without a key)
//   vault: requests that carry a key (LLMs, Tavily)
// Web pages are fetched only by the fetch page (its own CSP), never by the app
// Provider destinations come from src/lib/providers/endpoints.ts (including VITE_CUSTOM_PROVIDERS at build time).
import { appDirectOrigins, keyedProviderOrigins, type Env } from './src/lib/providers/endpoints';

function origin(url: string | undefined, fallback: string): string {
  try {
    return url ? new URL(url).origin : fallback;
  } catch {
    return fallback;
  }
}

export function serviceOrigins(env: Env) {
  return {
    tavily: origin(env.VITE_TAVILY_BASE_URL, 'https://api.tavily.com'),
    /** LLM providers the app calls directly */
    appProviders: appDirectOrigins(env),
    /** LLM providers the vault calls with a key attached */
    keyedProviders: keyedProviderOrigins(env)
  };
}

const COMMON = ['X-Content-Type-Options: nosniff', 'Referrer-Policy: no-referrer', 'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()'];

/** CSP for the app. vaultOrigin / fetchOrigin: a vault / fetch page on a separate origin ('self' covers same-origin ones) */
export function appCsp(env: Env, vaultOrigin?: string, fetchOrigin?: string): string {
  const o = serviceOrigins(env);
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    // Videos play from stored data only (object URLs), never from another site
    'media-src blob:',
    "font-src 'self'",
    `connect-src 'self' ${o.appProviders.join(' ')}`,
    // 'self': the sandbox (/sandbox/), and the vault and the fetch page while they are hosted with the app. Once those
    // have their own origins their same-origin copies are not built, so no framed page on this origin can reach out
    `frame-src ${["'self'", vaultOrigin, fetchOrigin].filter(Boolean).join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "require-trusted-types-for 'script'",
    'trusted-types dompurify app-sw app-pdf'
  ].join('; ');
}

/**
 * CSP for the sandbox (/sandbox/), opened in <iframe sandbox="allow-scripts allow-forms"> with no origin of its own. The
 * HTML and scripts it is given may run (inline, eval, workers from blob:), but nothing may leave: no request of any
 * kind, images and fonts only from data: / blob:, no frames, and a form's submit handlers run but the form goes nowhere.
 * frameAncestors: only for the header version
 */
export function sandboxCsp(frameAncestors = true): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
    'worker-src blob:',
    "connect-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // Peer connections are outside every fetch directive; browsers that implement this directive refuse them
    "webrtc 'block'",
    ...(frameAncestors ? ["frame-ancestors 'self'"] : [])
  ].join('; ');
}

/**
 * CSP for the fetch page: the one document that may reach any https address (it asks the user before each fetch).
 * appOrigins are the apps allowed to embed it ('self' when hosted same-origin)
 */
export function fetchCsp(appOrigins: string[]): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    'connect-src https:',
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${appOrigins.join(' ')}`,
    "object-src 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'"
  ].join('; ');
}

/** CSP for the key vault. appOrigins are the apps allowed to embed it ('self' when hosted same-origin) */
export function vaultCsp(env: Env, appOrigins: string[]): string {
  const o = serviceOrigins(env);
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `connect-src ${[...o.keyedProviders, o.tavily].join(' ')}`,
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${appOrigins.join(' ')}`,
    "object-src 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'"
  ].join('; ');
}

/**
 * _headers for deploying the app (format shared by Cloudflare Pages and Workers static assets).
 * CSP is applied per document: the app page (/ and /index.html) and the same-origin vault (under /vault/).
 * Writing "app CSP on /*, removed on /vault/*" would depend on "! Header" support,
 * and if removal fails the two CSPs stack and block the vault's requests, so we avoid it.
 * The app switches views via #, so no other path ever returns HTML (404).
 */
export function appHeadersFile(env: Env, base = '/'): string {
  const { vaultOrigin, fetchOrigin } = separateOrigins(env);
  const app = `  Content-Security-Policy: ${appCsp(env, vaultOrigin, fetchOrigin)}`;
  return [
    `${base}*`,
    ...COMMON.map((h) => '  ' + h),
    '  Cross-Origin-Opener-Policy: same-origin',
    '  Cross-Origin-Resource-Policy: same-origin',
    '',
    base,
    app,
    '',
    `${base}index.html`,
    app,
    '',
    `${base}sandbox/*`,
    `  Content-Security-Policy: ${sandboxCsp()}`,
    // DNS prefetch hints could carry data in host names (CSP does not cover them)
    '  X-DNS-Prefetch-Control: off',
    '',
    ...(vaultOrigin ? [] : [`${base}vault/*`, `  Content-Security-Policy: ${vaultCsp(env, ["'self'"])}`, '']),
    ...(fetchOrigin ? [] : [`${base}fetch/*`, `  Content-Security-Policy: ${fetchCsp(["'self'"])}`, ''])
  ].join('\n');
}

/**
 * The vault and the fetch page on origins of their own (VITE_VAULT_URL / VITE_FETCH_URL). Then the app build leaves
 * out its same-origin copies: a page on the app's origin that may reach any address (the fetch page) or that holds
 * the keys (the vault) would be within reach of a script running in the app.
 */
export function separateOrigins(env: Env): { vaultOrigin?: string; fetchOrigin?: string } {
  return {
    vaultOrigin: env.VITE_VAULT_URL ? new URL(env.VITE_VAULT_URL).origin : undefined,
    fetchOrigin: env.VITE_FETCH_URL ? new URL(env.VITE_FETCH_URL).origin : undefined
  };
}

/** The CSPs of the app build's pages, by page path */
export function appPagePolicies(env: Env): Record<string, string> {
  const { vaultOrigin, fetchOrigin } = separateOrigins(env);
  return {
    '/index.html': appCsp(env, vaultOrigin, fetchOrigin),
    ...(vaultOrigin ? {} : { '/vault/index.html': vaultCsp(env, ["'self'"]) }),
    ...(fetchOrigin ? {} : { '/fetch/index.html': fetchCsp(["'self'"]) })
  };
}

/**
 * The same CSP as a <meta> tag, for hosts that send no headers of their own (GitHub Pages). A meta CSP cannot carry
 * frame-ancestors, so there other sites can still embed the pages; everything else applies.
 */
export function cspMetaTag(policy: string): string {
  const kept = policy
    .split('; ')
    .filter((d) => !/^(frame-ancestors|report-uri|report-to|sandbox)\b/.test(d))
    .join('; ');
  return `<meta http-equiv="Content-Security-Policy" content="${kept.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" />`;
}

/** The apps allowed to embed a vault or fetch page on its own origin (VITE_APP_ORIGIN, comma-separated) */
function embeddingApps(env: Env): string[] {
  const list = (env.VITE_APP_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : ["'self'"];
}

/** CSP of a fetch page / vault hosted on a separate origin */
export const fetchPagePolicy = (env: Env) => fetchCsp(embeddingApps(env));
export const vaultPagePolicy = (env: Env) => vaultCsp(env, embeddingApps(env));

const separateHeaders = (policy: string) => ['/*', `  Content-Security-Policy: ${policy}`, ...COMMON.map((h) => '  ' + h), '  Cross-Origin-Resource-Policy: same-origin', ''].join('\n');

/** _headers for a fetch page hosted on a separate origin */
export const fetchHeadersFile = (env: Env) => separateHeaders(fetchPagePolicy(env));

/** _headers for a vault hosted on a separate origin */
export const vaultHeadersFile = (env: Env) => separateHeaders(vaultPagePolicy(env));
