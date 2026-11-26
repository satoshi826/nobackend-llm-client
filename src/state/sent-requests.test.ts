import { describe, expect, it } from 'vitest';
import { recordingTransport, sentRequestsOf, sentRequestsVersion } from './sent-requests';
import type { AuthRef, Transport } from '../lib/providers/types';

function inner(seen: { url: string; auth?: AuthRef }[] = []): Transport {
  return {
    async fetch(url, _init, auth) {
      seen.push({ url, auth });
      return new Response('ok');
    }
  };
}

describe('developer view: sent requests', () => {
  it('records each body under its reply, parsed when it is JSON, and passes the request on unchanged', async () => {
    const seen: { url: string; auth?: AuthRef }[] = [];
    const t = recordingTransport(inner(seen), 'reply-1');
    const v = sentRequestsVersion.value;
    await t.fetch('https://x.example/chat', { method: 'POST', body: '{"model":"m"}' }, { keyId: 'venice' });
    await t.fetch('https://x.example/raw', { method: 'POST', body: 'not json' });
    await t.fetch('https://x.example/get', { method: 'GET' });
    expect(sentRequestsOf('reply-1').map((r) => [r.url, r.body])).toEqual([
      ['https://x.example/chat', { model: 'm' }],
      ['https://x.example/raw', 'not json'],
      ['https://x.example/get', undefined]
    ]);
    expect(seen[0]).toEqual({ url: 'https://x.example/chat', auth: { keyId: 'venice' } });
    expect(sentRequestsVersion.value).toBe(v + 3);
    expect(sentRequestsOf('never')).toEqual([]);
  });

  it('keeps only the 20 most recently used replies', async () => {
    for (let i = 0; i < 20; i++) await recordingTransport(inner(), `r${i}`).fetch('u', {});
    // r0 is used again, so it becomes the newest and r1 is the oldest
    await recordingTransport(inner(), 'r0').fetch('u2', {});
    await recordingTransport(inner(), 'r20').fetch('u', {});
    expect(sentRequestsOf('r0')).toHaveLength(2);
    expect(sentRequestsOf('r1')).toEqual([]);
    expect(sentRequestsOf('r2')).toHaveLength(1);
    expect(sentRequestsOf('r20')).toHaveLength(1);
  });
});
