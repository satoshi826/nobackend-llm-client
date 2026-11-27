// Gemini Omni Flash video (https://aistudio.google.com/docs/omni.md), through the Interactions API.
// One request answers with the video (inline base64, or a files/ address on the same host), so there is no job to
// wait on after a reload. The model and its prices are a table (the docs list no video models through the API).
import { joinUrl } from '../../../lib/providers/openai-compatible';
import { base64ToBlob, blobToBase64 } from '../../../lib/db/images';
import type { VideoParams } from '../../../lib/db/schema';
import { jsonPost, perSecondFor, sendVideoRequest, VideoApiError, type VideoModelInfo, type VideoProvider } from './types';
import { t } from '../messages';

/** Google's price list: $12 per 1M output tokens, by the tokens a second takes at each resolution */
export const GEMINI_VIDEO_MODELS = (providerId = 'gemini'): VideoModelInfo[] => [
  {
    providerId,
    id: 'gemini-omni-1.2-flash',
    name: 'Gemini Omni 1.2 Flash',
    privacy: 'unknown',
    input: 'either',
    durations: [4, 6, 8, 10, 12, 15],
    resolutions: ['360p', '720p', '1080p', '4k'],
    aspects: ['16:9', '9:16'],
    audio: 'always',
    perSecond: { '360p|': 0.023, '720p|': 0.07, '1080p|': 0.104, '4k|': 0.209 }
  }
];

export function geminiVideoBody(p: VideoParams, firstFrame?: { mime: string; data: string }): Record<string, unknown> {
  return {
    model: p.model,
    input: firstFrame ? [{ type: 'image', data: firstFrame.data, mime_type: firstFrame.mime }, { type: 'text', text: p.prompt }] : p.prompt,
    response_format: { type: 'video', duration: `${p.duration}s`, ...(p.resolution ? { resolution: p.resolution } : {}), ...(p.aspectRatio ? { aspect_ratio: p.aspectRatio } : {}) },
    store: false
  };
}

/** The video in an interaction: steps[].content[] of type video, inline (data) or as a files/ address (uri) */
export function videoOf(interaction: any): { data?: string; uri?: string; mime: string } | undefined {
  for (const step of Array.isArray(interaction?.steps) ? interaction.steps : []) {
    for (const c of Array.isArray(step?.content) ? step.content : []) {
      if (c?.type === 'video' && (typeof c.data === 'string' || typeof c.uri === 'string')) return { data: c.data, uri: c.uri, mime: String(c.mime_type ?? 'video/mp4') };
    }
  }
  return undefined;
}

export const geminiVideoProvider: VideoProvider = {
  id: 'gemini',
  label: 'Gemini',
  account: 'gemini',
  listModels: async (cfg) => GEMINI_VIDEO_MODELS(cfg.id),
  async quote(p, m) {
    const rate = perSecondFor(m, p.resolution, true);
    return rate === undefined ? undefined : rate * p.duration;
  },
  async start(p, _m, firstFrame, c) {
    const frame = firstFrame ? { mime: firstFrame.type || 'image/png', data: await blobToBase64(firstFrame) } : undefined;
    const res = await sendVideoRequest(c.transport, joinUrl(c.config.baseUrl, 'interactions'), jsonPost(geminiVideoBody(p, frame), c.signal), c.auth);
    const v = videoOf(await res.json());
    if (v?.data) return { video: base64ToBlob(v.data, v.mime) };
    // A files/ address on the same host (with the key)
    if (v?.uri && new URL(v.uri).origin === new URL(c.config.baseUrl).origin) {
      const dl = await sendVideoRequest(c.transport, v.uri, { method: 'GET', signal: c.signal }, c.auth);
      return { video: await dl.blob() };
    }
    throw new VideoApiError({ kind: 'server', message: t('err.noVideo') });
  },
  privacyLabel: () => ({ tone: 'zinc', label: 'Gemini', title: t('privacy.geminiTitle') })
};
