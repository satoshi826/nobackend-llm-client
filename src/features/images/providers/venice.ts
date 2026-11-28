// Venice image API (https://docs.venice.ai/api-reference/endpoint/image/generate and friends).
// Requests that need the key go through the transport with an AuthRef (the vault attaches the key).
// Images come back as base64 / raw bytes, so no new host has to be allowed by the CSP.
import { joinUrl } from '../../../lib/providers/openai-compatible';
import { base64ToBlob, blobToBase64 } from '../../../lib/db/images';
import type { ImageParams } from '../../../lib/db/schema';
import type { ImageCallContext, ImageProvider } from './types';
import { ImageApiError, DEFAULT_ASPECTS, fetchModelList, promptStyleOf, sendImageRequest, sizeGrid, sizeOf, type ImageModelInfo } from './common';
import { t } from '../messages';

export function mapImageModel(raw: any, providerId = 'venice'): ImageModelInfo | null {
  if (!raw?.id) return null;
  const spec = raw.model_spec ?? {};
  const c = spec.constraints ?? {};
  const p = spec.pricing ?? {};
  const resolutionPrices: Record<string, number> = {};
  if (p.resolutions && typeof p.resolutions === 'object') {
    for (const [k, v] of Object.entries(p.resolutions)) if (typeof (v as any)?.usd === 'number') resolutionPrices[k] = (v as any).usd;
  }
  // Models with aspect ratios take aspect_ratio (and a resolution); the others take width / height
  const aspects: string[] | undefined = Array.isArray(c.aspectRatios) && c.aspectRatios.length ? c.aspectRatios.map(String) : undefined;
  const tiers: string[] = aspects && Array.isArray(c.resolutions) ? c.resolutions.map(String) : [];
  const defaultAspect = (typeof c.defaultAspectRatio === 'string' && c.defaultAspectRatio) || (aspects ?? DEFAULT_ASPECTS)[0];
  const defaultTier = typeof c.defaultResolution === 'string' && tiers.includes(c.defaultResolution) ? c.defaultResolution : tiers[0];
  const name = String(spec.name ?? raw.id);
  return {
    providerId,
    id: String(raw.id),
    name,
    privacy: spec.privacy === 'private' ? 'private' : spec.privacy === 'anonymized' ? 'anonymized' : 'unknown',
    traits: Array.isArray(spec.traits) ? spec.traits.map(String) : [],
    ...promptStyleOf(name, typeof spec.description === 'string' ? spec.description : ''),
    ...(typeof c.promptCharacterLimit === 'number' && c.promptCharacterLimit > 0 ? { promptLimit: c.promptCharacterLimit } : {}),
    constraints: {
      widthHeightDivisor: aspects ? undefined : typeof c.widthHeightDivisor === 'number' ? c.widthHeightDivisor : 8,
      sizes: sizeGrid(aspects ?? DEFAULT_ASPECTS, tiers, (_a, tier) => (tier ? resolutionPrices[tier] : undefined)),
      defaultSize: defaultTier ? `${defaultAspect} ${defaultTier}` : defaultAspect,
      tierLabel: 'resolution'
    },
    pricing: { generation: typeof p.generation?.usd === 'number' ? p.generation.usd : undefined },
    offline: !!spec.offline
  };
}

/** width/height for an aspect ratio: long edge 1024 (exact-canvas models allow at most 1280 per side), rounded to the divisor */
export function sizeFor(aspect: string, divisor = 8): { width: number; height: number } {
  const [w, h] = aspect.split(':').map(Number);
  if (!w || !h) return { width: 1024, height: 1024 };
  const long = 1024;
  const round = (n: number) => Math.max(divisor, Math.round(n / divisor) * divisor);
  return w >= h ? { width: round(long), height: round((long * h) / w) } : { width: round((long * w) / h), height: round(long) };
}

/** Estimated USD of an edit (Venice's price list; background removal has none) */
export function veniceEditCost(p: ImageParams): number | undefined {
  if (p.op === 'upscale') return p.scale === 4 ? 0.08 : 0.02;
  if (p.op === 'edit') return 0.04 + (p.enhancePrompt ? 0.04 : 0);
  return undefined;
}

export function buildGenerateBody(p: ImageParams, m: ImageModelInfo | undefined): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: p.model,
    prompt: p.prompt,
    variants: Math.min(4, Math.max(1, p.variants)),
    format: p.format,
    safe_mode: p.safeMode,
    return_binary: false,
    embed_exif_metadata: false
  };
  if (p.negativePrompt?.trim()) body.negative_prompt = p.negativePrompt.trim();
  if (p.style) body.style_preset = p.style;
  if (p.seed !== undefined) body.seed = p.seed;
  if (p.enhancePrompt) body.enhance_prompt = true;
  const size = sizeOf(m, p);
  const aspect = size?.aspect ?? p.aspectRatio ?? '1:1';
  if (m && m.constraints.widthHeightDivisor === undefined) {
    // Models with aspect ratios (some reject width/height)
    body.aspect_ratio = aspect;
    if (size?.tier) body.resolution = size.tier;
  } else {
    Object.assign(body, sizeFor(aspect, m?.constraints.widthHeightDivisor ?? 8));
  }
  return body;
}

/** A 422 is a content-policy rejection, with the prompt and model Venice may suggest instead */
function policyError(status: number, body: any): ImageApiError | undefined {
  if (status !== 422) return undefined;
  return new ImageApiError(
    { kind: 'bad-request', status: 422, message: t('err.policy'), hint: typeof body?.error === 'string' ? body.error : undefined },
    body && (body.suggested_prompt || body.recommended_model) ? { prompt: body.suggested_prompt || undefined, model: body.recommended_model || undefined } : undefined
  );
}

const send = (c: ImageCallContext, path: string, init: RequestInit) => sendImageRequest(c.transport, joinUrl(c.config.baseUrl, path), init, c.auth, policyError);
/** A JSON POST; the edit endpoints answer with image bytes */
const post = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, image/*' }, body: JSON.stringify(body), signal });

const MIME = { webp: 'image/webp', png: 'image/png', jpeg: 'image/jpeg' } as const;

/** Endpoints that take one image and return raw image bytes */
async function imageToImage(c: ImageCallContext, path: string, body: Record<string, unknown>): Promise<Blob> {
  const res = await send(c, path, post(body, c.signal));
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    // Some endpoints may answer JSON with base64 images
    const data = await res.json();
    const b64 = Array.isArray(data?.images) ? data.images[0] : data?.image;
    if (typeof b64 !== 'string') throw new ImageApiError({ kind: 'server', message: t('err.noImage') });
    return base64ToBlob(b64, 'image/png');
  }
  return new Blob([await res.arrayBuffer()], { type: type.startsWith('image/') ? type : 'image/png' });
}

/** Venice as an image provider (generate, plus upscale, edit and background removal) */
export const veniceImageProvider: ImageProvider = {
  id: 'venice',
  label: 'Venice',
  account: 'venice',
  async listModels(cfg, transport) {
    return (await fetchModelList(transport, joinUrl(cfg.baseUrl, 'models?type=image'), undefined, (r) => mapImageModel(r, cfg.id))).filter((m) => !m.offline);
  },
  async listStyles(c) {
    const data = await (await send(c, 'image/styles', { method: 'GET', headers: { Accept: 'application/json' } })).json();
    return Array.isArray(data?.data) ? data.data.map(String) : [];
  },
  async generate(p, m, c) {
    const res = await send(c, 'image/generate', post(buildGenerateBody(p, m), c.signal));
    const data = await res.json();
    const list: string[] = Array.isArray(data?.images) ? data.images.filter((s: unknown) => typeof s === 'string') : [];
    const enhanced = res.headers.get('x-venice-enhanced-prompt');
    let enhancedPrompt: string | undefined;
    try {
      enhancedPrompt = enhanced ? decodeURIComponent(enhanced) : undefined;
    } catch {
      enhancedPrompt = enhanced ?? undefined;
    }
    return {
      images: list.map((b64) => base64ToBlob(b64, MIME[p.format])),
      blurred: res.headers.get('x-venice-is-blurred') === 'true',
      violations: Number(res.headers.get('x-venice-content-violation-count') ?? data?.content_policy_violation_count ?? 0) || 0,
      enhancedPrompt
    };
  },
  upscale: async (source, scale, c) => imageToImage(c, 'image/upscale', { image: await blobToBase64(source), scale }),
  async edit(source, p, c) {
    const body: Record<string, unknown> = { image: await blobToBase64(source), prompt: p.prompt, safe_mode: p.safeMode };
    if (p.model) body.model = p.model;
    if (p.enhancePrompt) body.enhance_prompt = true;
    return imageToImage(c, 'image/edit', body);
  },
  ownEditModel: true,
  removeBackground: async (source, c) => imageToImage(c, 'image/background-remove', { image: await blobToBase64(source) }),
  editCost: veniceEditCost,
  privacyLabel: (m) =>
    m?.privacy === 'private'
      ? { tone: 'green', label: 'private', title: t('privacy.privateTitle') }
      : m?.privacy === 'anonymized'
        ? { tone: 'amber', label: t('privacy.relayed'), title: t('privacy.relayedTitle') }
        : { tone: 'zinc', label: 'Venice', title: t('privacy.unknownTitle') }
};
