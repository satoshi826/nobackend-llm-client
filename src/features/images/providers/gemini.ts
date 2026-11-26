// Gemini image models (generateContent with responseModalities IMAGE).
// The model list needs the key (the Gemini models list, filtered to image models). One image per request.
// Prices are a dated table (the API lists none); unknown models show "費用不明".
import type { ProviderConfig, Transport } from '../../../lib/providers/types';
import { joinUrl } from '../../../lib/providers/openai-compatible';
import { base64ToBlob } from '../../../lib/db/images';
import type { ImageParams } from '../../../lib/db/schema';
import type { ImageProvider } from './types';
import { ImageApiError, jsonPost, perImage, sendImageRequest, type ImageModelInfo } from './common';
import { t } from '../messages';

const ASPECTS = ['1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16', '21:9'];
const AS_OF = '2026-11';
/** USD per image (Google's price list; 1K and 2K cost the same on Gemini 3 Pro Image) */
const PRICES: { match: RegExp; generation?: number; resolutions?: Record<string, number> }[] = [
  { match: /^gemini-2\.5-flash-image/, generation: 0.039 },
  { match: /^gemini-3-pro-image/, resolutions: { '1K': 0.134, '2K': 0.134, '4K': 0.24 } }
];
/** Models with an image size setting (Gemini 3 and later) */
const sized = (id: string) => /^gemini-([3-9]|\d{2})/.test(id);
export const isGeminiImageModel = (id: string) => /-image(-|$)|nano-banana/.test(id);

export function mapGeminiImageModel(raw: any, providerId = 'gemini'): ImageModelInfo | null {
  const id = String(raw?.name ?? raw?.id ?? '').replace(/^models\//, '');
  if (!id || !isGeminiImageModel(id)) return null;
  const methods: string[] = Array.isArray(raw.supportedGenerationMethods) ? raw.supportedGenerationMethods : ['generateContent'];
  if (!methods.includes('generateContent')) return null;
  const price = PRICES.find((p) => p.match.test(id));
  return {
    providerId,
    id,
    name: String(raw.displayName ?? id),
    privacy: 'unknown',
    traits: [],
    constraints: {
      aspectRatios: ASPECTS,
      defaultAspectRatio: '1:1',
      ...(sized(id) ? { resolutions: ['1K', '2K', '4K'], defaultResolution: '1K', resolutionLabel: 'resolution' as const } : {})
    },
    pricing: price ? { generation: price.generation, resolutions: price.resolutions, source: 'table', asOf: AS_OF } : {},
    options: { seed: true, negativePrompt: false, styles: false, enhance: false }
  };
}

export function buildGeminiImageBody(p: ImageParams, seed?: number): Record<string, unknown> {
  const imageConfig: Record<string, unknown> = {};
  if (p.aspectRatio) imageConfig.aspectRatio = p.aspectRatio;
  if (p.resolution && sized(p.model)) imageConfig.imageSize = p.resolution;
  return {
    contents: [{ role: 'user', parts: [{ text: p.prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], ...(Object.keys(imageConfig).length ? { imageConfig } : {}), ...(seed !== undefined ? { seed } : {}) }
  };
}

async function generate(p: ImageParams, cfg: ProviderConfig, transport: Transport, auth: Parameters<typeof sendImageRequest>[3], signal?: AbortSignal) {
  const results = await perImage(p.variants, async (i) => {
    const res = await sendImageRequest(transport, joinUrl(cfg.baseUrl, `models/${encodeURIComponent(p.model)}:generateContent`), jsonPost(buildGeminiImageBody(p, p.seed !== undefined ? p.seed + i : undefined), signal), auth);
    const data = await res.json();
    const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    // Thought images (interim drafts) are skipped
    return parts.filter((x) => x?.inlineData?.data && !x.thought).map((x) => base64ToBlob(String(x.inlineData.data), String(x.inlineData.mimeType ?? 'image/png')));
  });
  const images = results.flat();
  if (!images.length) throw new ImageApiError({ kind: 'bad-request', message: t('err.noImage') });
  return { images };
}

export const geminiImageProvider: ImageProvider = {
  id: 'gemini',
  label: 'Gemini',
  account: 'gemini',
  keyedList: true,
  async listModels(cfg, transport, auth) {
    const res = await sendImageRequest(transport, joinUrl(cfg.baseUrl, 'models?pageSize=200'), { method: 'GET', headers: { Accept: 'application/json' } }, auth);
    const data = await res.json();
    return (Array.isArray(data?.models) ? data.models : []).map((r: unknown) => mapGeminiImageModel(r, cfg.id)).filter((m: ImageModelInfo | null): m is ImageModelInfo => !!m);
  },
  generate: (p, _m, c) => generate(p, c.config, c.transport, c.auth, c.signal),
  estimateCost(p, m) {
    if (p.op !== 'generate' || !m) return undefined;
    const res = p.resolution ?? m.constraints.defaultResolution;
    const each = (res ? m.pricing.resolutions?.[res] : undefined) ?? m.pricing.generation;
    return each === undefined ? undefined : each * Math.max(1, p.variants);
  },
  privacyLabel: () => ({ tone: 'zinc', label: 'Gemini', title: t('privacy.geminiTitle') })
};
