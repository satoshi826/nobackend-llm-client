// Gemini image models (generateContent with responseModalities IMAGE).
// The model list needs the key (the Gemini models list, filtered to image models). One image per request.
// Prices are a dated table (the API lists none); unknown models show "費用不明".
// Editing sends the image (inline, base64) with the instruction to the same generateContent.
import type { ProviderConfig, Transport } from '../../../lib/providers/types';
import { joinUrl } from '../../../lib/providers/openai-compatible';
import { base64ToBlob } from '../../../lib/db/images';
import type { ImageParams } from '../../../lib/db/schema';
import type { ImageProvider } from './types';
import { ImageApiError, blobToBase64, jsonPost, perImage, sendImageRequest, sizeGrid, sizeOf, type ImageModelInfo } from './common';
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
      sizes: sizeGrid(ASPECTS, sized(id) ? ['1K', '2K', '4K'] : [], (_a, tier) => (tier ? price?.resolutions?.[tier] : undefined)),
      defaultSize: sized(id) ? '1:1 1K' : '1:1',
      tierLabel: 'resolution'
    },
    pricing: price ? { generation: price.generation, source: 'table', asOf: AS_OF } : {},
    // An image and an instruction in one request edits it
    edits: 'also',
    options: { seed: true, negativePrompt: false, styles: false, enhance: false }
  };
}

export function buildGeminiImageBody(p: ImageParams, seed?: number, m?: ImageModelInfo): Record<string, unknown> {
  const imageConfig: Record<string, unknown> = {};
  const s = sizeOf(m, p);
  const aspect = s?.aspect ?? p.aspectRatio;
  const tier = s?.tier ?? p.resolution;
  if (aspect) imageConfig.aspectRatio = aspect;
  if (tier && sized(p.model)) imageConfig.imageSize = tier;
  return {
    contents: [{ role: 'user', parts: [{ text: p.prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], ...(Object.keys(imageConfig).length ? { imageConfig } : {}), ...(seed !== undefined ? { seed } : {}) }
  };
}

/** Edit: the image (inline, base64) and the instruction as one user turn */
export function buildGeminiEditBody(prompt: string, mimeType: string, data: string): Record<string, unknown> {
  return { contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data } }, { text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } };
}

/** The images of a generateContent answer; thought images (interim drafts) are skipped */
async function imagesOf(res: Response): Promise<Blob[]> {
  const data = await res.json();
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((x) => x?.inlineData?.data && !x.thought).map((x) => base64ToBlob(String(x.inlineData.data), String(x.inlineData.mimeType ?? 'image/png')));
}

const contentUrl = (cfg: ProviderConfig, model: string) => joinUrl(cfg.baseUrl, `models/${encodeURIComponent(model)}:generateContent`);

async function generate(p: ImageParams, m: ImageModelInfo | undefined, cfg: ProviderConfig, transport: Transport, auth: Parameters<typeof sendImageRequest>[3], signal?: AbortSignal) {
  const results = await perImage(p.variants, async (i) => imagesOf(await sendImageRequest(transport, contentUrl(cfg, p.model), jsonPost(buildGeminiImageBody(p, p.seed !== undefined ? p.seed + i : undefined, m), signal), auth)));
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
  generate: (p, m, c) => generate(p, m, c.config, c.transport, c.auth, c.signal),
  async edit(source, p, c) {
    const [image] = await imagesOf(await sendImageRequest(c.transport, contentUrl(c.config, p.model), jsonPost(buildGeminiEditBody(p.prompt, source.type || 'image/png', await blobToBase64(source)), c.signal), c.auth));
    if (!image) throw new ImageApiError({ kind: 'bad-request', message: t('err.noImage') });
    return image;
  },
  privacyLabel: () => ({ tone: 'zinc', label: 'Gemini', title: t('privacy.geminiTitle') })
};
