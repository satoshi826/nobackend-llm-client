import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoParams } from '../../../lib/db/schema';
import type { Transport } from '../../../lib/providers/types';
import { mapVeniceVideoModel, veniceVideoBody, veniceVideoProvider } from './providers/venice';
import { mapOpenRouterVideoModel, openRouterVideoBody, openrouterVideoProvider, perSecondFromSkus } from './providers/openrouter';
import { GEMINI_VIDEO_MODELS, geminiVideoBody, geminiVideoProvider, videoOf } from './providers/gemini';
import { isDone, perSecondFor, VideoApiError, type VideoCallContext } from './providers/types';

const params = (o: Partial<VideoParams> = {}): VideoParams => ({ providerId: 'venice', model: 'm', prompt: 'a cat', duration: 5, ...o });

/** A transport that answers from a list of handlers in order, recording what was asked */
function fakeTransport(answers: ((url: string, init?: RequestInit) => Response)[]): Transport & { calls: { url: string; body?: any; auth: boolean }[] } {
  const calls: { url: string; body?: any; auth: boolean }[] = [];
  return {
    calls,
    async fetch(url, init, auth) {
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined, auth: !!auth });
      const next = answers.shift();
      if (!next) throw new Error(`unexpected request ${url}`);
      return next(url, init);
    }
  };
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const mp4 = () => () => new Response(new Blob([new Uint8Array([0, 0, 0, 24])]), { status: 200, headers: { 'Content-Type': 'video/mp4' } });
const ctx = (transport: Transport, baseUrl: string): VideoCallContext => ({ config: { id: 'x', baseUrl } as never, auth: { provider: 'x' } as never, transport });

afterEach(() => vi.unstubAllGlobals());

describe('Venice video', () => {
  it('reads text-to-video and image-to-video models and leaves the rest out', () => {
    const t2v = mapVeniceVideoModel({ id: 'wan-t2v', model_spec: { name: 'Wan', privacy: 'private', constraints: { model_type: 'text-to-video', durations: ['5s', '10s'], resolutions: ['720p'], aspect_ratios: ['16:9'], audio: true, audio_configurable: true } } });
    expect(t2v).toMatchObject({ id: 'wan-t2v', input: 'text', durations: [5, 10], audio: 'optional', privacy: 'private' });
    expect(mapVeniceVideoModel({ id: 'i2v', model_spec: { constraints: { model_type: 'image-to-video', audio: true } } })).toMatchObject({ input: 'image', audio: 'always' });
    expect(mapVeniceVideoModel({ id: 'edit', model_spec: { constraints: { model_type: 'video' } } })).toBeNull();
  });

  it('sends the length as "5s" and sound only to models where it is a choice', () => {
    const m = mapVeniceVideoModel({ id: 'm', model_spec: { constraints: { model_type: 'text-to-video', audio: true, audio_configurable: true } } })!;
    expect(veniceVideoBody(params({ resolution: '720p', aspectRatio: '16:9', audio: false }), m)).toEqual({ model: 'm', duration: '5s', resolution: '720p', aspect_ratio: '16:9', audio: false });
    expect(veniceVideoBody(params(), { ...m, audio: 'always' })).not.toHaveProperty('audio');
  });

  it('queues, reports progress, then takes the MP4 and deletes the copy at Venice', async () => {
    const tr = fakeTransport([
      json({ model: 'm', queue_id: 'q1' }),
      json({ status: 'PROCESSING', average_execution_time: 100000, execution_duration: 50000 }),
      mp4(),
      json({ success: true })
    ]);
    const c = ctx(tr, 'https://api.venice.ai/api/v1');
    const job = await veniceVideoProvider.start(params(), undefined, new Blob(['png'], { type: 'image/png' }), c);
    expect(job).toEqual({ id: 'q1' });
    expect(tr.calls[0].body.image_url).toMatch(/^data:image\/png;base64,/);
    expect(await veniceVideoProvider.check!({ id: 'q1' }, c)).toEqual({ progress: 0.5 });
    const done = await veniceVideoProvider.check!({ id: 'q1' }, c);
    expect(isDone(done) && done.video.size).toBe(4);
    await Promise.resolve();
    expect(tr.calls.at(-1)).toMatchObject({ url: 'https://api.venice.ai/api/v1/video/complete', body: { queue_id: 'q1' }, auth: true });
  });

  it('fetches a one-time download address without the key once retrieve says COMPLETED', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      fetched.push(url);
      expect(init.credentials).toBe('omit');
      return new Response(new Blob([new Uint8Array(8)]), { headers: { 'Content-Type': 'video/mp4' } });
    });
    const tr = fakeTransport([json({ model: 'm', queue_id: 'q2', download_url: 'https://private-share.venice.ai/v1/share/read/x' }), json({ status: 'COMPLETED' })]);
    const c = ctx(tr, 'https://api.venice.ai/api/v1');
    const job = await veniceVideoProvider.start(params(), undefined, null, c);
    expect(job).toEqual({ id: 'q2', downloadUrl: 'https://private-share.venice.ai/v1/share/read/x' });
    const done = await veniceVideoProvider.check!(job as never, c);
    expect(isDone(done) && done.video.size).toBe(8);
    expect(fetched).toEqual(['https://private-share.venice.ai/v1/share/read/x']);
  });

  it('turns a content-policy rejection into one that names the suggested model', async () => {
    const c = ctx(fakeTransport([json({ error: { message: 'no', type: 'provider_content_policy', recommended_model: 'wan-2-7' } }, 422)]), 'https://api.venice.ai/api/v1');
    const e = await veniceVideoProvider.check!({ id: 'q' }, c).catch((x) => x);
    expect(e).toBeInstanceOf(VideoApiError);
    expect(e.suggestedModel).toBe('wan-2-7');
  });
});

describe('OpenRouter video', () => {
  it('reads per-second prices from pricing_skus (dollars, cents, by resolution and sound)', () => {
    expect(perSecondFromSkus({ duration_seconds_with_audio: '0.40', duration_seconds_without_audio_4k: '0.30', duration_seconds_720p: '0.10', cents_per_video_output_second_1080p: '5', video_tokens: '0.000001' })).toEqual({
      '|audio': 0.4,
      '4k|silent': 0.3,
      '720p|': 0.1,
      '1080p|': 0.05
    });
    expect(perSecondFromSkus({ video_tokens: '1' })).toBeUndefined();
  });

  it('prices a request from the closest entry', () => {
    const m = mapOpenRouterVideoModel({ id: 'veo', supported_frame_images: ['first_frame'], generate_audio: true, pricing_skus: { duration_seconds_with_audio: '0.40', duration_seconds_without_audio: '0.20', duration_seconds_with_audio_4k: '0.60' } })!;
    expect(m).toMatchObject({ input: 'either', audio: 'optional' });
    expect(perSecondFor(m, '4K', true)).toBe(0.6);
    expect(perSecondFor(m, '1080p', false)).toBe(0.2);
    expect(mapOpenRouterVideoModel({ id: 'wan', generate_audio: false })).toMatchObject({ input: 'text', audio: 'none' });
  });

  it('sends the first frame as a data: URL and the sound choice explicitly', () => {
    const m = mapOpenRouterVideoModel({ id: 'veo', pricing_skus: { duration_seconds_with_audio: '1', duration_seconds_without_audio: '1' } })!;
    expect(openRouterVideoBody(params({ audio: false }), m, 'data:image/png;base64,AA')).toMatchObject({
      duration: 5,
      generate_audio: false,
      frame_images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA' }, frame_type: 'first_frame' }]
    });
  });

  it('waits while generating, then fetches the content with the reported cost', async () => {
    const tr = fakeTransport([json({ id: 'j1', status: 'in_progress', progress: 40 }), json({ id: 'j1', status: 'completed', usage: { cost: 0.48 } }), mp4()]);
    const c = ctx(tr, 'https://openrouter.ai/api/v1');
    expect(await openrouterVideoProvider.check!({ id: 'j1' }, c)).toEqual({ progress: 0.4 });
    const done = await openrouterVideoProvider.check!({ id: 'j1' }, c);
    expect(isDone(done) && done.costUsd).toBe(0.48);
    expect(tr.calls.at(-1)?.url).toBe('https://openrouter.ai/api/v1/videos/j1/content?index=0');
  });

  it('reports a failed job, with the provider’s reason in the details', async () => {
    const c = ctx(fakeTransport([json({ id: 'j', status: 'failed', error: 'Content policy violation' })]), 'https://openrouter.ai/api/v1');
    await expect(openrouterVideoProvider.check!({ id: 'j' }, c)).rejects.toMatchObject({ error: { kind: 'server', detail: 'Content policy violation' } });
  });
});

describe('Gemini video', () => {
  it('asks for the video in one request, with a first frame as inline data', () => {
    expect(geminiVideoBody(params({ model: 'gemini-omni-1.2-flash', resolution: '720p', aspectRatio: '9:16' }))).toEqual({
      model: 'gemini-omni-1.2-flash',
      input: 'a cat',
      response_format: { type: 'video', duration: '5s', resolution: '720p', aspect_ratio: '9:16' },
      store: false
    });
    expect(geminiVideoBody(params(), { mime: 'image/png', data: 'AA' }).input).toEqual([{ type: 'image', data: 'AA', mime_type: 'image/png' }, { type: 'text', text: 'a cat' }]);
  });

  it('finds the video in the answer and prices it from the table', async () => {
    expect(videoOf({ steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: 'AAAA' }] }] })).toEqual({ data: 'AAAA', uri: undefined, mime: 'video/mp4' });
    const [m] = GEMINI_VIDEO_MODELS();
    expect(await geminiVideoProvider.quote(params({ duration: 10, resolution: '720p' }), m, ctx(fakeTransport([]), ''))).toBeCloseTo(0.7);
    const c = ctx(fakeTransport([json({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: btoa('abcd') }] }] })]), 'https://generativelanguage.googleapis.com/v1beta');
    const done = await geminiVideoProvider.start(params(), m, null, c);
    expect(isDone(done) && done.video.type).toBe('video/mp4');
  });
});
