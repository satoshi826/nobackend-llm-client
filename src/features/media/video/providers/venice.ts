// Venice video API (https://docs.venice.ai/api-reference/endpoint/video/queue and friends).
// - models: GET /models?type=video, no key. Text-to-video and image-to-video models are separate ids; the rest
//   (editing, upscaling, references) are left out
// - price: POST /video/quote, Venice's own price for the request
// - job: POST /video/queue → queue_id; POST /video/retrieve answers JSON while it runs, then the MP4 itself. Some
//   models instead hand out a one-time keyless download_url when queued (on private-share.venice.ai), fetched
//   without the key once retrieve says COMPLETED. After a download the media is deleted at Venice (/video/complete)
import { joinUrl } from '../../../../lib/providers/openai-compatible';
import { plainTransport } from '../../../../lib/providers/transport';
import { blobToDataUrl } from '../../../../lib/base64';
import type { VideoParams } from '../../../../lib/db/schema';
import { jsonPost, policyError, seconds, sendVideoRequest, VideoApiError, type VideoModelInfo, type VideoProvider } from './types';
import { t } from '../messages';

const INPUT: Record<string, VideoModelInfo['input']> = { 'text-to-video': 'text', 'image-to-video': 'image' };

export function mapVeniceVideoModel(raw: any, providerId = 'venice'): VideoModelInfo | null {
  const spec = raw?.model_spec ?? {};
  const c = spec.constraints ?? {};
  const input = INPUT[c.model_type];
  if (!raw?.id || !input) return null;
  const list = (x: unknown) => (Array.isArray(x) ? x.map(String) : []);
  return {
    providerId,
    id: String(raw.id),
    name: String(spec.name ?? raw.id),
    privacy: spec.privacy === 'private' ? 'private' : spec.privacy === 'anonymized' ? 'anonymized' : 'unknown',
    input,
    durations: list(c.durations).map(seconds).filter((n): n is number => n !== undefined),
    resolutions: list(c.resolutions),
    aspects: list(c.aspect_ratios),
    audio: c.audio ? (c.audio_configurable ? 'optional' : 'always') : 'none',
    offline: !!spec.offline
  };
}

/** The fields queue and quote share */
export function veniceVideoBody(p: VideoParams, m: VideoModelInfo | undefined): Record<string, unknown> {
  return {
    model: p.model,
    duration: `${p.duration}s`,
    ...(p.resolution ? { resolution: p.resolution } : {}),
    ...(p.aspectRatio ? { aspect_ratio: p.aspectRatio } : {}),
    ...(m?.audio === 'optional' ? { audio: !!p.audio } : {})
  };
}

/** 422 on queue: the prompt or the image was refused; on retrieve: the provider refused it (maybe with a model to try) */
const rejected = (status: number, body: any) => (status === 422 ? policyError(typeof body?.error?.recommended_model === 'string' ? body.error.recommended_model : undefined) : undefined);

export const veniceVideoProvider: VideoProvider = {
  id: 'venice',
  label: 'Venice',
  account: 'venice',
  async listModels(cfg, transport) {
    const res = await sendVideoRequest(transport, joinUrl(cfg.baseUrl, 'models?type=video'), { method: 'GET', headers: { Accept: 'application/json' } }, undefined);
    const data = (await res.json())?.data;
    return (Array.isArray(data) ? data : []).map((r) => mapVeniceVideoModel(r, cfg.id)).filter((m): m is VideoModelInfo => !!m);
  },
  quoteIsPrice: true,
  async quote(p, m, c) {
    const res = await sendVideoRequest(c.transport, joinUrl(c.config.baseUrl, 'video/quote'), jsonPost(veniceVideoBody(p, m), c.signal), c.auth);
    const q = (await res.json())?.quote;
    return typeof q === 'number' ? q : undefined;
  },
  async start(p, m, firstFrame, c) {
    const body = { ...veniceVideoBody(p, m), prompt: p.prompt, ...(firstFrame ? { image_url: await blobToDataUrl(firstFrame) } : {}) };
    const res = await sendVideoRequest(c.transport, joinUrl(c.config.baseUrl, 'video/queue'), jsonPost(body, c.signal), c.auth, rejected);
    const data = await res.json();
    if (typeof data?.queue_id !== 'string') throw new VideoApiError({ kind: 'server', message: t('err.noJob') });
    return { id: data.queue_id, ...(typeof data.download_url === 'string' ? { downloadUrl: data.download_url } : {}) };
  },
  pollSeconds: 5,
  async check(job, c) {
    const res = await sendVideoRequest(c.transport, joinUrl(c.config.baseUrl, 'video/retrieve'), { ...jsonPost({ queue_id: job.id }, c.signal), headers: { 'Content-Type': 'application/json' } }, c.auth, rejected);
    if ((res.headers.get('content-type') ?? '').startsWith('video/')) {
      const video = await res.blob();
      // The copy at Venice is no longer needed (a failure leaves it to expire)
      void c.transport.fetch(joinUrl(c.config.baseUrl, 'video/complete'), jsonPost({ queue_id: job.id }), c.auth).catch(() => {});
      return { video };
    }
    const data = await res.json();
    if (data?.status === 'COMPLETED') {
      if (!job.downloadUrl) throw new VideoApiError({ kind: 'server', message: t('err.noVideo') });
      // A keyless one-time address: fetched by the app itself, without the key
      const dl = await sendVideoRequest(plainTransport, job.downloadUrl, { method: 'GET', signal: c.signal }, undefined);
      return { video: await dl.blob() };
    }
    const avg = Number(data?.average_execution_time);
    const ran = Number(data?.execution_duration);
    return avg > 0 && ran >= 0 ? { progress: Math.min(0.95, ran / avg) } : {};
  },
  privacyLabel: (m) =>
    m?.privacy === 'private'
      ? { tone: 'green', label: t('privacy.private'), title: t('privacy.privateTitle') }
      : { tone: 'amber', label: t('privacy.anonymized'), title: t('privacy.anonymizedTitle') }
};
