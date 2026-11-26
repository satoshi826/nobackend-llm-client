import { describe, expect, it } from 'vitest';
import { fetchableUrl, nameFor } from './protocol';
import { appCsp, appHeadersFile, fetchCsp } from '../../../csp.config';

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
});
