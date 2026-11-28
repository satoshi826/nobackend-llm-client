import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JavaScript Worker without types
import worker from './worker.js';

const env = { ALLOWED_ORIGINS: 'https://app.example' };
const call = (url: string, origin = 'https://app.example', method = 'GET') => worker.fetch(new Request(`https://relay.example/?url=${encodeURIComponent(url)}`, { method, headers: { Origin: origin } }), env);

afterEach(() => vi.unstubAllGlobals());

describe('fetch relay', () => {
  it('answers only to the allowed fetch page', async () => {
    expect((await call('https://files.example/a.txt', 'https://evil.example')).status).toBe(403);
  });
  it('reaches only public https addresses', async () => {
    const upstream = vi.fn(async () => new Response('x'));
    vi.stubGlobal('fetch', upstream);
    for (const bad of ['http://files.example/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.5/a', 'https://192.168.1.1/a', 'https://[::1]/a', 'https://u:p@files.example/a']) expect((await call(bad)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('relays the file without the caller\'s headers, with CORS for the fetch page', async () => {
    const upstream = vi.fn(async (_u: string, _init: RequestInit) => new Response('hello', { headers: { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="a.txt"' } }));
    vi.stubGlobal('fetch', upstream);
    const res = await call('https://files.example/a.txt');
    expect(await res.text()).toBe('hello');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(res.headers.get('content-disposition')).toContain('a.txt');
    const sent = new Headers(upstream.mock.calls[0][1].headers);
    expect(sent.get('origin')).toBeNull();
    expect(sent.get('cookie')).toBeNull();
  });
  it('refuses files over the limit', async () => {
    vi.stubGlobal('fetch', async () => new Response('x', { headers: { 'Content-Length': String(30 * 1024 * 1024) } }));
    expect((await call('https://files.example/big.bin')).status).toBe(413);
  });
  it('follows no redirect: it answers with where one leads, for the fetch page to decide on', async () => {
    const upstream = vi.fn(async (_u: string, _init: RequestInit) => new Response(null, { status: 302, headers: { Location: '/next?a=1' } }));
    vi.stubGlobal('fetch', upstream);
    const res = await call('https://files.example/a');
    expect(res.status).toBe(204);
    expect(res.headers.get('x-redirect-to')).toBe('https://files.example/next?a=1');
    expect(res.headers.get('access-control-expose-headers')).toContain('X-Redirect-To');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0][1].redirect).toBe('manual');
  });
});
