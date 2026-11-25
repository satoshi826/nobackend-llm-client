// Builds the security headers (Cloudflare Pages _headers format) in one place.
// The app and the key vault get separate allowed destinations (least privilege):
//   app:   only requests that need no key (model lists, keyless Jina Reader, providers used without a key)
//   vault: requests that carry a key (LLMs, Tavily, Jina)
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
    jina: origin(env.VITE_JINA_BASE_URL, 'https://r.jina.ai'),
    /** LLM providers the app calls directly */
    appProviders: appDirectOrigins(env),
    /** LLM providers the vault calls with a key attached */
    keyedProviders: keyedProviderOrigins(env)
  };
}

const COMMON = ['X-Content-Type-Options: nosniff', 'Referrer-Policy: no-referrer', 'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()'];

/** CSP for the app. vaultOrigin is a separate-origin vault (just 'self' when same-origin) */
export function appCsp(env: Env, vaultOrigin?: string): string {
  const o = serviceOrigins(env);
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${[...o.appProviders, o.jina].join(' ')}`,
    `frame-src 'self'${vaultOrigin ? ' ' + vaultOrigin : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "require-trusted-types-for 'script'",
    'trusted-types app-md dompurify app-sw'
  ].join('; ');
}

/** CSP for the key vault. appOrigins are the apps allowed to embed it ('self' when hosted same-origin) */
export function vaultCsp(env: Env, appOrigins: string[]): string {
  const o = serviceOrigins(env);
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `connect-src ${[...o.keyedProviders, o.tavily, o.jina].join(' ')}`,
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
export function appHeadersFile(env: Env): string {
  const vaultOrigin = env.VITE_VAULT_URL ? new URL(env.VITE_VAULT_URL).origin : undefined;
  const app = `  Content-Security-Policy: ${appCsp(env, vaultOrigin)}`;
  return [
    '/*',
    ...COMMON.map((h) => '  ' + h),
    '  Cross-Origin-Opener-Policy: same-origin',
    '  Cross-Origin-Resource-Policy: same-origin',
    '',
    '/',
    app,
    '',
    '/index.html',
    app,
    '',
    '/vault/*',
    `  Content-Security-Policy: ${vaultCsp(env, ["'self'"])}`,
    ''
  ].join('\n');
}

/** _headers for a vault hosted on a separate origin */
export function vaultHeadersFile(env: Env): string {
  const appOrigins = (env.VITE_APP_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ['/*', `  Content-Security-Policy: ${vaultCsp(env, appOrigins.length ? appOrigins : ["'self'"])}`, ...COMMON.map((h) => '  ' + h), '  Cross-Origin-Resource-Policy: same-origin', ''].join('\n');
}
