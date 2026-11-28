import { describe, expect, it } from 'vitest';
import type { Transport } from '../../../lib/providers/types';
import { venicePreset } from '../../../lib/providers/presets/venice';
import { providerConfigOf } from '../../../lib/keys/accounts';
import { leastEffort, rewriteAsTags } from './to-tags';
import { t } from './messages';

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
/** A transport that streams the chunks and keeps the request's body */
function streamTransport(chunks: string[], capture: { body?: any } = {}): Transport {
  const enc = new TextEncoder();
  return {
    async fetch(_url, init) {
      capture.body = JSON.parse(String(init.body));
      return new Response(
        new ReadableStream({
          start(c) {
            for (const ch of chunks) c.enqueue(enc.encode(ch));
            c.close();
          }
        }),
        { status: 200 }
      );
    }
  };
}
const answer = (text: string, finish = 'stop') => [sse({ choices: [{ delta: { reasoning_content: 'thinking' } }] }), sse({ choices: [{ delta: { content: text }, finish_reason: finish }] }), 'data: [DONE]\n\n'];
const opts = (transport: Transport, efforts?: string[]) => ({ provider: providerConfigOf('venice')!, preset: venicePreset, auth: undefined, transport, model: 'm', efforts, signal: new AbortController().signal });

describe('To tags', () => {
  it('asks with no answer length and no temperature, and the least reasoning the model offers', async () => {
    const capture: { body?: any } = {};
    expect(await rewriteAsTags('a girl under cherry blossoms', 200, opts(streamTransport(answer('"1girl, cherry blossoms"'), capture), ['high', 'low', 'medium']))).toBe('1girl, cherry blossoms');
    expect(capture.body).not.toHaveProperty('max_completion_tokens');
    expect(capture.body).not.toHaveProperty('temperature');
    expect(capture.body.reasoning_effort).toBe('low');
    expect(capture.body.messages[0].content).toContain('Keep it within 200 characters.');
    expect(capture.body.tools).toBeUndefined();
  });

  it('sends no reasoning effort for a model that offers none', async () => {
    const capture: { body?: any } = {};
    await rewriteAsTags('a cat', undefined, opts(streamTransport(answer('cat'), capture)));
    expect(capture.body).not.toHaveProperty('reasoning_effort');
  });

  it('refuses an answer cut at its length, and an empty one, rather than put them in', async () => {
    await expect(rewriteAsTags('a girl', undefined, opts(streamTransport(answer('1girl, long ha', 'length'))))).rejects.toThrow(t('bar.toTagsCut'));
    await expect(rewriteAsTags('a girl', undefined, opts(streamTransport(answer(''))))).rejects.toThrow(t('bar.toTagsEmpty'));
  });

  it('picks the least effort by name, else the first one offered', () => {
    expect(leastEffort(['medium', 'minimal', 'high'])).toBe('minimal');
    expect(leastEffort(['none', 'low'])).toBe('none');
    expect(leastEffort(['fast', 'deep'])).toBe('fast');
    expect(leastEffort(undefined)).toBeUndefined();
  });
});
