// OpenRouter image API: keyless model list (/images/models),
// prices per model from /images/models/{id}/endpoints (fetched when the model is chosen),
// POST /images with response_format b64_json. The request's reported cost is recorded as spend.
// Models that take input_references edit an image (sent there as a data: URL); those that need one only edit.
import { joinUrl } from '../../../lib/providers/openai-compatible';
import { base64ToBlob } from '../../../lib/db/images';
import type { ImageParams } from '../../../lib/db/schema';
import type { ImageProvider } from './types';
import { DEFAULT_ASPECTS, ImageApiError, aspectAndTier, blobToDataUrl, fetchModelList, jsonPost, perImage, sendImageRequest, sizeGrid, type ImageModelInfo } from './common';
import { t } from '../messages';

const enumOf = (sp: any, k: string): string[] | undefined => (sp?.[k]?.type === 'enum' && Array.isArray(sp[k].values) ? sp[k].values.map(String).filter((v: string) => v !== 'auto') : undefined);

export function mapOpenRouterImageModel(raw: any, providerId = 'openrouter'): ImageModelInfo | null {
  if (!raw?.id) return null;
  const sp = raw.supported_parameters ?? {};
  const aspects = enumOf(sp, 'aspect_ratio');
  const resolutions = enumOf(sp, 'resolution');
  // input_references: how many images the model takes in; at least one means it only edits
  const refs = sp.input_references?.type === 'range' ? sp.input_references : undefined;
  const edits = refs && refs.max > 0 ? (refs.min >= 1 ? 'only' : 'also') : undefined;
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
    ...(edits ? { edits } : {}),
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

/** The images (and reported cost) of a POST /images answer */
async function readImages(res: Response): Promise<{ images: Blob[]; cost?: number }> {
  const data = await res.json();
  const items: any[] = Array.isArray(data?.data) ? data.data : [];
  const images = items.filter((x) => typeof x?.b64_json === 'string').map((x) => base64ToBlob(x.b64_json, typeof x.media_type === 'string' ? x.media_type : 'image/png'));
  return { images, cost: typeof data?.usage?.cost === 'number' ? data.usage.cost : undefined };
}

/** Edit: the image goes in input_references as a data: URL */
export function buildOpenRouterEditBody(p: ImageParams, image: string): Record<string, unknown> {
  return { model: p.model, prompt: p.prompt, input_references: [{ type: 'image_url', image_url: { url: image } }], response_format: 'b64_json', output_format: 'png' };
}

export const openrouterImageProvider: ImageProvider = {
  id: 'openrouter',
  label: 'OpenRouter',
  account: 'openrouter',
  listModels: (cfg, transport) => fetchModelList(transport, joinUrl(cfg.baseUrl, 'images/models'), undefined, (r) => mapOpenRouterImageModel(r, cfg.id)),
  async loadPricing(m, cfg, transport) {
    const res = await sendImageRequest(transport, joinUrl(cfg.baseUrl, `images/models/${m.id}/endpoints`), { method: 'GET', headers: { Accept: 'application/json' } }, undefined);
    const price = priceFromEndpoints(await res.json());
    return price === undefined ? m : { ...m, pricing: { generation: price } };
  },
  async generate(p, m, c) {
    const body: Record<string, unknown> = { model: p.model, prompt: p.prompt, response_format: 'b64_json', output_format: p.format };
    const { aspect, tier } = aspectAndTier(m, p);
    if (aspect) body.aspect_ratio = aspect;
    if (tier) body.resolution = tier;
    if (p.seed !== undefined) body.seed = p.seed;
    // One image per request (the API has no image count); variants run in parallel
    const results = await perImage(p.variants, async (i) =>
      readImages(await sendImageRequest(c.transport, joinUrl(c.config.baseUrl, 'images'), jsonPost({ ...body, ...(p.seed !== undefined ? { seed: p.seed + i } : {}) }, c.signal), c.auth))
    );
    const images = results.flatMap((r) => r.images);
    if (!images.length) throw new ImageApiError({ kind: 'server', message: t('err.noImage') });
    const costs = results.map((r) => r.cost);
    return { images, costUsd: costs.every((x) => x !== undefined) ? costs.reduce((a, b) => a! + b!, 0) : undefined };
  },
  async edit(source, p, c) {
    const { images } = await readImages(await sendImageRequest(c.transport, joinUrl(c.config.baseUrl, 'images'), jsonPost(buildOpenRouterEditBody(p, await blobToDataUrl(source)), c.signal), c.auth));
    if (!images[0]) throw new ImageApiError({ kind: 'server', message: t('err.noImage') });
    return images[0];
  },
  privacyLabel: () => ({ tone: 'zinc', label: 'OpenRouter', title: t('privacy.openrouterTitle') })
};
