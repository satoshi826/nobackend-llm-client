// OpenRouter video API (https://openrouter.ai/docs/guides/overview/multimodal/video-generation).
// - models: GET /videos/models, no key; prices per second in pricing_skus
// - job: POST /videos → id; GET /videos/{id} until completed (progress while generating, the charge in usage.cost),
//   then GET /videos/{id}/content (the MP4, same host, with the key)
// - a first frame goes in frame_images as a data: URL
import { joinUrl } from '../../../../lib/providers/openai-compatible';
import { blobToDataUrl } from '../../../../lib/base64';
import type { VideoParams } from '../../../../lib/db/schema';
import { jsonPost, perSecondFor, sendVideoRequest, VideoApiError, type VideoModelInfo, type VideoProvider } from './types';
import { t } from '../messages';

/**
 * USD per second out of pricing_skus: duration_seconds[_with_audio|_without_audio][_<resolution>] in dollars,
 * cents_per_video_output_second[_<resolution>] / cents_per_second_output[_<resolution>] in cents. Others (per
 * token, per image) cannot be priced from the request
 */
export function perSecondFromSkus(skus: unknown): Record<string, number> | undefined {
  if (!skus || typeof skus !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(skus as Record<string, unknown>)) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const usd = /^duration_seconds(?:_(with|without)_audio)?(?:_(\w+))?$/.exec(k);
    const cents = /^cents_per_(?:video_output_second|second_output)(?:_(\w+))?$/.exec(k);
    if (usd) out[`${(usd[2] ?? '').toLowerCase()}|${usd[1] === 'with' ? 'audio' : usd[1] === 'without' ? 'silent' : ''}`] = n;
    else if (cents) out[`${(cents[1] ?? '').toLowerCase()}|`] = n / 100;
  }
  return Object.keys(out).length ? out : undefined;
}

export function mapOpenRouterVideoModel(raw: any, providerId = 'openrouter'): VideoModelInfo | null {
  if (!raw?.id) return null;
  const list = (x: unknown) => (Array.isArray(x) ? x.map(String) : []);
  const perSecond = perSecondFromSkus(raw.pricing_skus);
  const priced = Object.keys(perSecond ?? {});
  return {
    providerId,
    id: String(raw.id),
    name: String(raw.name ?? raw.id),
    privacy: 'unknown',
    input: list(raw.supported_frame_images).includes('first_frame') ? 'either' : 'text',
    durations: (Array.isArray(raw.supported_durations) ? raw.supported_durations : []).map(Number).filter((n: number) => n > 0),
    resolutions: list(raw.supported_resolutions),
    aspects: list(raw.supported_aspect_ratios),
    // Priced with and without sound: sound is a choice; declared on: always made
    audio: priced.some((k) => k.endsWith('|audio')) && priced.some((k) => k.endsWith('|silent')) ? 'optional' : raw.generate_audio === true ? 'always' : 'none',
    ...(perSecond ? { perSecond } : {})
  };
}

export function openRouterVideoBody(p: VideoParams, m: VideoModelInfo | undefined, firstFrame?: string): Record<string, unknown> {
  return {
    model: p.model,
    prompt: p.prompt,
    duration: p.duration,
    ...(p.resolution ? { resolution: p.resolution } : {}),
    ...(p.aspectRatio ? { aspect_ratio: p.aspectRatio } : {}),
    // Sent either way: when it is left out some endpoints make sound and others do not
    ...(m && m.audio !== 'none' ? { generate_audio: m.audio === 'always' || !!p.audio } : {}),
    ...(firstFrame ? { frame_images: [{ type: 'image_url', image_url: { url: firstFrame }, frame_type: 'first_frame' }] } : {})
  };
}

export const openrouterVideoProvider: VideoProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  account: 'openrouter',
  async listModels(cfg, transport) {
    const res = await sendVideoRequest(transport, joinUrl(cfg.baseUrl, 'videos/models'), { method: 'GET', headers: { Accept: 'application/json' } }, undefined);
    const data = (await res.json())?.data;
    return (Array.isArray(data) ? data : []).map((r) => mapOpenRouterVideoModel(r, cfg.id)).filter((m): m is VideoModelInfo => !!m);
  },
  async quote(p, m) {
    const rate = perSecondFor(m, p.resolution, m?.audio === 'always' || !!p.audio);
    return rate === undefined ? undefined : rate * p.duration;
  },
  async start(p, m, firstFrame, c) {
    const res = await sendVideoRequest(c.transport, joinUrl(c.config.baseUrl, 'videos'), jsonPost(openRouterVideoBody(p, m, firstFrame ? await blobToDataUrl(firstFrame) : undefined), c.signal), c.auth);
    const data = await res.json();
    if (typeof data?.id !== 'string') throw new VideoApiError({ kind: 'server', message: t('err.noJob') });
    return { id: data.id };
  },
  pollSeconds: 10,
  async check(job, c) {
    const res = await sendVideoRequest(c.transport, joinUrl(c.config.baseUrl, `videos/${encodeURIComponent(job.id)}`), { method: 'GET', headers: { Accept: 'application/json' }, signal: c.signal }, c.auth);
    const data = await res.json();
    if (data?.status === 'completed') {
      const content = await c.transport.fetch(joinUrl(c.config.baseUrl, `videos/${encodeURIComponent(job.id)}/content?index=0`), { method: 'GET', signal: c.signal }, c.auth);
      // Stored a moment after it reports completed: asked again next time
      if (content.status === 404 || content.status === 409) return {};
      if (!content.ok) throw new VideoApiError({ kind: 'server', status: content.status, message: t('err.noVideo') });
      return { video: await content.blob(), costUsd: typeof data.usage?.cost === 'number' ? data.usage.cost : undefined };
    }
    if (['failed', 'cancelled', 'expired'].includes(data?.status)) throw new VideoApiError({ kind: 'server', message: typeof data.error === 'string' && data.error ? t('err.failedWith', { error: data.error }) : t('err.failed') });
    return typeof data?.progress === 'number' ? { progress: Math.min(0.95, data.progress / 100) } : {};
  },
  privacyLabel: () => ({ tone: 'zinc', label: 'OpenRouter', title: t('privacy.openrouterTitle') })
};
