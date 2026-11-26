// OpenRouter image API: keyless model list (/images/models),
// prices per model from /images/models/{id}/endpoints (fetched when the model is chosen),
// POST /images with response_format b64_json. The request's reported cost is recorded as spend.
import type { ProviderConfig, Transport } from '../../../lib/providers/types';
import { joinUrl } from '../../../lib/providers/openai-compatible';
import { base64ToBlob } from '../../../lib/db/images';
import type { ImageParams } from '../../../lib/db/schema';
import type { ImageProvider } from './types';
import { DEFAULT_ASPECTS, ImageApiError, jsonPost, perImage, sendImageRequest, sizeGrid, sizeOf, type ImageModelInfo } from './common';
import { t } from '../messages';

const enumOf = (sp: any, k: string): string[] | undefined => (sp?.[k]?.type === 'enum' && Array.isArray(sp[k].values) ? sp[k].values.map(String).filter((v: string) => v !== 'auto') : undefined);

export function mapOpenRouterImageModel(raw: any, providerId = 'openrouter'): ImageModelInfo | null {
  if (!raw?.id) return null;
  const sp = raw.supported_parameters ?? {};
  const aspects = enumOf(sp, 'aspect_ratio');
  const resolutions = enumOf(sp, 'resolution');
  return {
    providerId,
    id: String(raw.id),
    name: String(raw.name ?? raw.id),
    privacy: 'unknown',
    traits: [],
    constraints: {
      sizes: sizeGrid(aspects?.length ? aspects : DEFAULT_ASPECTS, resolutions ?? []),
      defaultSize: [aspects?.includes('1:1') || !aspects?.length ? '1:1' : aspects[0], resolutions?.includes('1K') ? '1K' : resolutions?.[0]].filter(Boolean).join(' '),
      tierLabel: 'resolution'
    },
    pricing: {},
    options: { seed: sp.seed?.type === 'boolean' || !!sp.seed, negativePrompt: false, styles: false, enhance: false }
  };
}

/** Price per image out of the first endpoint's pricing lines (per-image or per-request lines only) */
export function priceFromEndpoints(json: any): number | undefined {
  const ep = Array.isArray(json?.endpoints) ? json.endpoints[0] : json?.data?.endpoints?.[0];
  const lines: any[] = Array.isArray(ep?.pricing) ? ep.pricing : [];
  const line = lines.find((l) => l?.billable === 'output_image' && (l.unit === 'image' || l.unit === 'request')) ?? lines.find((l) => l?.unit === 'request');
  return typeof line?.cost_usd === 'number' ? line.cost_usd : undefined;
}

async function generate(p: ImageParams, m: ImageModelInfo | undefined, cfg: ProviderConfig, transport: Transport, auth: Parameters<typeof sendImageRequest>[3], signal?: AbortSignal) {
  const body: Record<string, unknown> = { model: p.model, prompt: p.prompt, response_format: 'b64_json', output_format: p.format };
  const s = sizeOf(m, p);
  const aspect = s?.aspect ?? p.aspectRatio;
  const tier = s?.tier ?? p.resolution;
  if (aspect) body.aspect_ratio = aspect;
  if (tier) body.resolution = tier;
  if (p.seed !== undefined) body.seed = p.seed;
  // One image per request (the API has no image count); variants run in parallel
  const results = await perImage(p.variants, async (i) => {
    const res = await sendImageRequest(transport, joinUrl(cfg.baseUrl, 'images'), jsonPost({ ...body, ...(p.seed !== undefined ? { seed: p.seed + i } : {}) }, signal), auth);
    const data = await res.json();
    const items: any[] = Array.isArray(data?.data) ? data.data : [];
    const images = items.filter((x) => typeof x?.b64_json === 'string').map((x) => base64ToBlob(x.b64_json, typeof x.media_type === 'string' ? x.media_type : 'image/png'));
    return { images, cost: typeof data?.usage?.cost === 'number' ? data.usage.cost : undefined };
  });
  const images = results.flatMap((r) => r.images);
  if (!images.length) throw new ImageApiError({ kind: 'server', message: t('err.noImage') });
  const costs = results.map((r) => r.cost);
  return { images, costUsd: costs.every((c) => c !== undefined) ? costs.reduce((a, b) => a! + b!, 0) : undefined };
}

export const openrouterImageProvider: ImageProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  account: 'openrouter',
  async listModels(cfg, transport) {
    const res = await sendImageRequest(transport, joinUrl(cfg.baseUrl, 'images/models'), { method: 'GET', headers: { Accept: 'application/json' } }, undefined);
    const data = await res.json();
    return (Array.isArray(data?.data) ? data.data : []).map((r: unknown) => mapOpenRouterImageModel(r, cfg.id)).filter((m: ImageModelInfo | null): m is ImageModelInfo => !!m);
  },
  async loadPricing(m, cfg, transport) {
    const res = await sendImageRequest(transport, joinUrl(cfg.baseUrl, `images/models/${m.id}/endpoints`), { method: 'GET', headers: { Accept: 'application/json' } }, undefined);
    const price = priceFromEndpoints(await res.json());
    return price === undefined ? m : { ...m, pricing: { generation: price, source: 'api' } };
  },
  generate: (p, m, c) => generate(p, m, c.config, c.transport, c.auth, c.signal),
  privacyLabel: () => ({ tone: 'zinc', label: 'OpenRouter', title: t('privacy.openrouterTitle') })
};
