// OpenAI Images API (POST /v1/images/generations).
// The model list needs the key (/v1/models, filtered to image models). GPT Image models always return
// base64; aspect ratios map to the sizes the model accepts, and "quality" takes the resolution menu.
// Prices are a dated table (the API lists none).
import type { ProviderConfig, Transport } from '../../../lib/providers/types';
import { joinUrl } from '../../../lib/providers/openai-compatible';
import { base64ToBlob } from '../../../lib/db/images';
import type { ImageParams } from '../../../lib/db/schema';
import type { ImageProvider } from './types';
import { ImageApiError, jsonPost, perImage, sendImageRequest, type ImageModelInfo } from './common';
import { t } from '../messages';

const AS_OF = '2026-11';
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
  return {
    providerId,
    id,
    name: id,
    privacy: 'unknown',
    traits: [],
    constraints: {
      aspectRatios: Object.keys(dalle ? DALLE_SIZES : GPT_SIZES),
      defaultAspectRatio: '1:1',
      resolutions: qualities,
      defaultResolution: dalle ? 'standard' : 'medium',
      resolutionLabel: 'quality'
    },
    pricing: PRICES.some((p) => p.match.test(id)) ? { source: 'table', asOf: AS_OF } : {},
    options: { seed: false, negativePrompt: false, styles: false, enhance: false }
  };
}

export function sizeOf(p: ImageParams): string {
  const table = isDalle(p.model) ? DALLE_SIZES : GPT_SIZES;
  return table[p.aspectRatio ?? '1:1'] ?? '1024x1024';
}

export function estimateOpenAICost(p: ImageParams, m: ImageModelInfo | undefined): number | undefined {
  if (p.op !== 'generate') return undefined;
  const row = PRICES.find((x) => x.match.test(p.model));
  const quality = p.resolution ?? m?.constraints.defaultResolution ?? 'medium';
  const each = row ? (sizeOf(p) === '1024x1024' ? row.square : row.wide)[quality] : undefined;
  return each === undefined ? undefined : each * Math.max(1, p.variants);
}

export function buildOpenAIImageBody(p: ImageParams, n: number): Record<string, unknown> {
  const body: Record<string, unknown> = { model: p.model, prompt: p.prompt, n, size: sizeOf(p) };
  if (p.resolution) body.quality = p.resolution;
  if (isDalle(p.model)) body.response_format = 'b64_json';
  else body.output_format = p.format;
  return body;
}

async function generate(p: ImageParams, cfg: ProviderConfig, transport: Transport, auth: Parameters<typeof sendImageRequest>[3], signal?: AbortSignal) {
  const url = joinUrl(cfg.baseUrl, 'images/generations');
  const mime = isDalle(p.model) ? 'image/png' : `image/${p.format === 'jpeg' ? 'jpeg' : p.format}`;
  const read = async (res: Response) => {
    const data = await res.json();
    return (Array.isArray(data?.data) ? data.data : []).filter((x: any) => typeof x?.b64_json === 'string').map((x: any) => base64ToBlob(x.b64_json, mime));
  };
  // DALL·E 3 makes one image per request; GPT Image takes n
  const images = isDalle(p.model)
    ? (await perImage(p.variants, async () => read(await sendImageRequest(transport, url, jsonPost(buildOpenAIImageBody(p, 1), signal), auth)))).flat()
    : await read(await sendImageRequest(transport, url, jsonPost(buildOpenAIImageBody(p, Math.min(4, Math.max(1, p.variants))), signal), auth));
  if (!images.length) throw new ImageApiError({ kind: 'bad-request', message: t('err.noImage') });
  return { images };
}

export const openaiImageProvider: ImageProvider = {
  id: 'openai',
  label: 'OpenAI',
  account: 'openai',
  keyedList: true,
  async listModels(cfg, transport, auth) {
    const res = await sendImageRequest(transport, joinUrl(cfg.baseUrl, 'models'), { method: 'GET', headers: { Accept: 'application/json' } }, auth);
    const data = await res.json();
    return (Array.isArray(data?.data) ? data.data : []).map((r: unknown) => mapOpenAIImageModel(r, cfg.id)).filter((m: ImageModelInfo | null): m is ImageModelInfo => !!m);
  },
  generate: (p, _m, c) => generate(p, c.config, c.transport, c.auth, c.signal),
  estimateCost: estimateOpenAICost,
  privacyLabel: () => ({ tone: 'zinc', label: 'OpenAI', title: t('privacy.openaiTitle') })
};
