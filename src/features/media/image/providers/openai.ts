// OpenAI Images API (POST /v1/images/generations).
// The model list needs the key (/v1/models, filtered to image models). GPT Image models always return
// base64; aspect ratios map to the sizes the model accepts, and "quality" takes the resolution menu.
// Prices are a table (the API lists none). GPT Image edits an image too (POST /v1/images/edits, as JSON
// with the image as a data: URL).
import { joinUrl } from '../../../../lib/providers/openai-compatible';
import { base64ToBlob, blobToDataUrl } from '../../../../lib/base64';
import type { ImageParams } from '../../../../lib/db/schema';
import type { ImageProvider } from './types';
import { ImageApiError, aspectAndTier, fetchModelList, jsonPost, perImage, sendImageRequest, sizeGrid, type ImageModelInfo } from './common';
import { t } from '../messages';

const GPT_SIZES: Record<string, string> = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536' };
const DALLE_SIZES: Record<string, string> = { '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792' };
/** USD per image by quality, for square / non-square sizes (OpenAI's price list) */
const PRICES: { match: RegExp; square: Record<string, number>; wide: Record<string, number> }[] = [
  { match: /^gpt-image-1-mini/, square: { low: 0.005, medium: 0.011, high: 0.036 }, wide: { low: 0.006, medium: 0.015, high: 0.052 } },
  { match: /^gpt-image-1/, square: { low: 0.011, medium: 0.042, high: 0.167 }, wide: { low: 0.016, medium: 0.063, high: 0.25 } },
  { match: /^dall-e-3/, square: { standard: 0.04, hd: 0.08 }, wide: { standard: 0.08, hd: 0.12 } }
];
export const isOpenAIImageModel = (id: string) => /^(gpt-image|dall-e-3)/.test(id);
const isDalle = (id: string) => id.startsWith('dall-e');

export function mapOpenAIImageModel(raw: any, providerId = 'openai'): ImageModelInfo | null {
  const id = String(raw?.id ?? '');
  if (!isOpenAIImageModel(id)) return null;
  const dalle = isDalle(id);
  const qualities = dalle ? ['standard', 'hd'] : ['low', 'medium', 'high'];
  const sizes = dalle ? DALLE_SIZES : GPT_SIZES;
  const row = PRICES.find((p) => p.match.test(id));
  return {
    providerId,
    id,
    name: id,
    privacy: 'unknown',
    traits: [],
    promptStyle: 'natural',
    constraints: {
      // Square and other sizes cost differently, per quality
      sizes: sizeGrid(Object.keys(sizes), qualities, (aspect, quality) => (row ? (sizes[aspect] === '1024x1024' ? row.square : row.wide)[quality!] : undefined)),
      defaultSize: dalle ? '1:1 standard' : '1:1 medium',
      tierLabel: 'quality'
    },
    pricing: {},
    // GPT Image edits images (DALL·E 3 does not)
    ...(dalle ? {} : { edits: 'also' as const }),
    options: { seed: false, negativePrompt: false, styles: false, enhance: false }
  };
}

/** The pixel size and quality OpenAI takes for a request */
export function openAISize(p: ImageParams, m?: ImageModelInfo): { size: string; quality?: string } {
  const { aspect, tier } = aspectAndTier(m, p);
  const table = isDalle(p.model) ? DALLE_SIZES : GPT_SIZES;
  return { size: table[aspect ?? '1:1'] ?? '1024x1024', quality: tier };
}

export function buildOpenAIImageBody(p: ImageParams, n: number, m?: ImageModelInfo): Record<string, unknown> {
  const { size, quality } = openAISize(p, m);
  const body: Record<string, unknown> = { model: p.model, prompt: p.prompt, n, size };
  if (quality) body.quality = quality;
  if (isDalle(p.model)) body.response_format = 'b64_json';
  else body.output_format = p.format;
  return body;
}

/** POST /images/edits as JSON: the image goes as a data: URL */
export function buildOpenAIEditBody(p: ImageParams, image: string): Record<string, unknown> {
  return { model: p.model, prompt: p.prompt, images: [{ image_url: image }], n: 1, output_format: 'png' };
}

export const openaiImageProvider: ImageProvider = {
  id: 'openai',
  label: 'OpenAI',
  account: 'openai',
  keyedList: true,
  listModels: (cfg, transport, auth) => fetchModelList(transport, joinUrl(cfg.baseUrl, 'models'), auth, (r) => mapOpenAIImageModel(r, cfg.id)),
  async generate(p, m, c) {
    const url = joinUrl(c.config.baseUrl, 'images/generations');
    const mime = isDalle(p.model) ? 'image/png' : `image/${p.format === 'jpeg' ? 'jpeg' : p.format}`;
    const read = async (res: Response) => {
      const data = await res.json();
      return (Array.isArray(data?.data) ? data.data : []).filter((x: any) => typeof x?.b64_json === 'string').map((x: any) => base64ToBlob(x.b64_json, mime));
    };
    // DALL·E 3 makes one image per request; GPT Image takes n
    const images = isDalle(p.model)
      ? (await perImage(p.variants, async () => read(await sendImageRequest(c.transport, url, jsonPost(buildOpenAIImageBody(p, 1, m), c.signal), c.auth)))).flat()
      : await read(await sendImageRequest(c.transport, url, jsonPost(buildOpenAIImageBody(p, Math.min(4, Math.max(1, p.variants)), m), c.signal), c.auth));
    if (!images.length) throw new ImageApiError({ kind: 'bad-request', message: t('err.noImage') });
    return { images };
  },
  async edit(source, p, c) {
    const res = await sendImageRequest(c.transport, joinUrl(c.config.baseUrl, 'images/edits'), jsonPost(buildOpenAIEditBody(p, await blobToDataUrl(source)), c.signal), c.auth);
    const b64 = (await res.json())?.data?.[0]?.b64_json;
    if (typeof b64 !== 'string') throw new ImageApiError({ kind: 'bad-request', message: t('err.noImage') });
    return base64ToBlob(b64, 'image/png');
  },
  privacyLabel: () => ({ tone: 'zinc', label: 'OpenAI', title: t('privacy.openaiTitle') })
};
