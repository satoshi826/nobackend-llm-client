import { describe, expect, it } from 'vitest';
import { fetchableUrl, nameFor } from './protocol';
import { appCsp, appHeadersFile, appPagePolicies, cspMetaTag, fetchCsp, sandboxCsp } from '../../../csp.config';

describe('fetch page', () => {
  it('fetches only plain https addresses', () => {
    expect(fetchableUrl('https://example.com/a.pdf')?.host).toBe('example.com');
    expect(fetchableUrl('http://example.com/a.pdf')).toBeNull();
    expect(fetchableUrl('https://user:pw@example.com/a')).toBeNull();
    expect(fetchableUrl('data:text/plain,hi')).toBeNull();
    expect(fetchableUrl('not a url')).toBeNull();
  });
  it('names what it fetched from the header, else from the address', () => {
    const u = new URL('https://example.com/docs/report%202026.pdf?x=1');
    expect(nameFor(u, null, 'application/pdf')).toBe('report 2026.pdf');
    expect(nameFor(u, 'attachment; filename="q3.csv"', 'text/csv')).toBe('q3.csv');
    expect(nameFor(u, "attachment; filename*=UTF-8''%E5%A0%B1%E5%91%8A.txt", 'text/plain')).toBe('報告.txt');
    expect(nameFor(new URL('https://img.example/abc'), null, 'image/png')).toBe('abc.png');
    expect(nameFor(new URL('https://img.example/'), null, 'image/jpeg')).toBe('img.example.jpg');
  });
  it('is the only document that may reach any https address', () => {
    expect(fetchCsp(["'self'"])).toContain('connect-src https:');
    expect(appCsp({})).not.toContain('https:;');
    const headers = appHeadersFile({});
    expect(headers).toContain('/fetch/*');
    expect(appCsp({}, undefined, 'https://fetch.example')).toContain("frame-src 'self' https://fetch.example");
  });
  it('leaves out the same-origin vault and fetch page once both have their own origins', () => {
    const env = { VITE_VAULT_URL: 'https://vault.example/', VITE_FETCH_URL: 'https://fetch.example/' };
    expect(appCsp(env, 'https://vault.example', 'https://fetch.example')).toContain("frame-src 'self' https://vault.example https://fetch.example;");
    expect(appHeadersFile(env)).not.toMatch(/\/vault\/\*|\/fetch\/\*/);
    expect(Object.keys(appPagePolicies(env))).toEqual(['/index.html']);
    expect(Object.keys(appPagePolicies({}))).toEqual(['/index.html', '/vault/index.html', '/fetch/index.html']);
  });
  it('puts every header path under the base path when served from a subpath', () => {
    const headers = appHeadersFile({}, '/repo/');
    for (const path of ['/repo/*', '/repo/', '/repo/index.html', '/repo/sandbox/*', '/repo/vault/*', '/repo/fetch/*']) expect(headers.split('\n')).toContain(path);
    expect(headers).not.toMatch(/^\/(?!repo\/)/m);
  });
  it('lets the sandbox run scripts but reach nothing', () => {
    const p = sandboxCsp();
    expect(p).toContain("connect-src 'none'");
    expect(p).toContain("frame-src 'none'");
    expect(p).toContain("form-action 'none'");
    expect(p).toContain('img-src data: blob:');
    expect(p).not.toMatch(/https?:|\*/);
    expect(p).toContain("webrtc 'block'");
    expect(appHeadersFile({})).toMatch(/\/sandbox\/\*\n[^/]*X-DNS-Prefetch-Control: off/);
    // the app may frame it ('self') even with the vault and fetch page elsewhere
    expect(appCsp({}, 'https://v.example', 'https://f.example')).toContain("frame-src 'self'");
  });
  it('writes the CSP as a meta tag without what a meta CSP cannot carry', () => {
    const tag = cspMetaTag(fetchCsp(["'self'"]));
    expect(tag).toMatch(/^<meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
    expect(tag).not.toContain('frame-ancestors');
    expect(tag).toContain("require-trusted-types-for 'script'");
  });
});
