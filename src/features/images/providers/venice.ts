// Venice image API (https://docs.venice.ai/api-reference/endpoint/image/generate and friends).
// Requests that need the key go through the transport with an AuthRef (the vault attaches the key).
// Images come back as base64 / raw bytes, so no new host has to be allowed by the CSP.
import type { AuthRef, ProviderConfig, Transport } from '../../../lib/providers/types';
import { classifyError, errorFromFetchFailure, ProviderFailure } from '../../../lib/providers/errors';
import { joinUrl } from '../../../lib/providers/openai-compatible';
import { base64ToBlob } from '../../../lib/db/images';
import type { ImageParams } from '../../../lib/db/schema';
import type { ImageProvider } from './types';
import { ImageApiError, aspectsOf, DEFAULT_ASPECTS, type ImageModelInfo } from './common';

export { ImageApiError, aspectsOf, DEFAULT_ASPECTS, type ImageModelInfo };
import { t } from '../messages';

export function mapImageModel(raw: any, providerId = 'venice'): ImageModelInfo | null {
  if (!raw?.id) return null;
  const spec = raw.model_spec ?? {};
  const c = spec.constraints ?? {};
  const p = spec.pricing ?? {};
  const resolutions: Record<string, number> = {};
  if (p.resolutions && typeof p.resolutions === 'object') {
    for (const [k, v] of Object.entries(p.resolutions)) if (typeof (v as any)?.usd === 'number') resolutions[k] = (v as any).usd;
  }
  return {
    providerId,
    id: String(raw.id),
    name: String(spec.name ?? raw.id),
    privacy: spec.privacy === 'private' ? 'private' : spec.privacy === 'anonymized' ? 'anonymized' : 'unknown',
    traits: Array.isArray(spec.traits) ? spec.traits.map(String) : [],
    constraints: {
      promptCharacterLimit: typeof c.promptCharacterLimit === 'number' ? c.promptCharacterLimit : undefined,
      steps: c.steps && typeof c.steps === 'object' ? { default: c.steps.default, max: c.steps.max } : undefined,
      widthHeightDivisor: typeof c.widthHeightDivisor === 'number' ? c.widthHeightDivisor : undefined,
      aspectRatios: Array.isArray(c.aspectRatios) ? c.aspectRatios.map(String) : undefined,
      defaultAspectRatio: typeof c.defaultAspectRatio === 'string' ? c.defaultAspectRatio : undefined,
      resolutions: Array.isArray(c.resolutions) ? c.resolutions.map(String) : undefined,
      defaultResolution: typeof c.defaultResolution === 'string' ? c.defaultResolution : undefined
    },
    pricing: { generation: typeof p.generation?.usd === 'number' ? p.generation.usd : undefined, resolutions: Object.keys(resolutions).length ? resolutions : undefined, source: 'api' },
    offline: !!spec.offline,
    deprecated: !!spec.deprecation
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

/** Estimated USD for a request (undefined when the price is unknown) */
export function estimateImageCost(p: ImageParams, m: ImageModelInfo | undefined): number | undefined {
  if (p.op === 'upscale') return p.scale === 4 ? 0.08 : 0.02;
  if (p.op === 'edit') return 0.04 + (p.enhancePrompt ? 0.04 : 0);
  if (p.op === 'remove-bg') return undefined;
  const res = p.resolution ?? m?.constraints.defaultResolution;
  const each: number | undefined = (res ? m?.pricing.resolutions?.[res] : undefined) ?? m?.pricing.generation;
  return each === undefined ? undefined : each * Math.max(1, p.variants);
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
  const aspect = p.aspectRatio ?? m?.constraints.defaultAspectRatio ?? '1:1';
  if (m?.constraints.aspectRatios?.length) {
    // Models with aspect ratios (some reject width/height)
    body.aspect_ratio = aspect;
    const res = p.resolution ?? m.constraints.defaultResolution;
    if (res) body.resolution = res;
  } else {
    Object.assign(body, sizeFor(aspect, m?.constraints.widthHeightDivisor ?? 8));
  }
  return body;
}

async function imageError(res: Response): Promise<ImageApiError> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (res.status === 422) {
    return new ImageApiError(
      { kind: 'bad-request', status: 422, message: t('err.policy'), hint: typeof body?.error === 'string' ? body.error : undefined },
      body && (body.suggested_prompt || body.recommended_model) ? { prompt: body.suggested_prompt || undefined, model: body.recommended_model || undefined } : undefined
    );
  }
  if (res.status === 503) return new ImageApiError({ kind: 'server', status: 503, message: t('err.busy') });
  return new ImageApiError(classifyError(res.status, body, res.headers.get('retry-after')));
}

async function send(transport: Transport, url: string, init: RequestInit, auth: AuthRef | undefined): Promise<Response> {
  let res: Response;
  try {
    res = await transport.fetch(url, init, auth);
  } catch (e) {
    if (e instanceof ProviderFailure) throw new ImageApiError(e.error);
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ImageApiError(errorFromFetchFailure(e));
  }
  if (!res.ok) throw await imageError(res);
  return res;
}

const json = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, image/*' },
  body: JSON.stringify(body),
  signal
});

export async function listImageModels(cfg: ProviderConfig, transport: Transport): Promise<ImageModelInfo[]> {
  const res = await send(transport, joinUrl(cfg.baseUrl, 'models?type=image'), { method: 'GET', headers: { Accept: 'application/json' } }, undefined);
  const data = await res.json();
  return (Array.isArray(data?.data) ? data.data : []).map((r: unknown) => mapImageModel(r, cfg.id)).filter((m: ImageModelInfo | null): m is ImageModelInfo => !!m && !m.offline);
}

export async function listStyles(cfg: ProviderConfig, auth: AuthRef | undefined, transport: Transport): Promise<string[]> {
  const res = await send(transport, joinUrl(cfg.baseUrl, 'image/styles'), { method: 'GET', headers: { Accept: 'application/json' } }, auth);
  const data = await res.json();
  return Array.isArray(data?.data) ? data.data.map(String) : [];
}

export interface GeneratedImages {
  images: Blob[];
  blurred: boolean;
  violations: number;
  enhancedPrompt?: string;
}

const MIME = { webp: 'image/webp', png: 'image/png', jpeg: 'image/jpeg' } as const;

export async function generateImages(cfg: ProviderConfig, auth: AuthRef | undefined, transport: Transport, p: ImageParams, m: ImageModelInfo | undefined, signal?: AbortSignal): Promise<GeneratedImages> {
  const res = await send(transport, joinUrl(cfg.baseUrl, 'image/generate'), json(buildGenerateBody(p, m), signal), auth);
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
}

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Endpoints that take one image and return raw image bytes */
async function imageToImage(cfg: ProviderConfig, auth: AuthRef | undefined, transport: Transport, path: string, body: Record<string, unknown>, fallbackMime: string, signal?: AbortSignal): Promise<Blob> {
  const res = await send(transport, joinUrl(cfg.baseUrl, path), json(body, signal), auth);
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    // Some endpoints may answer JSON with base64 images
    const data = await res.json();
    const b64 = Array.isArray(data?.images) ? data.images[0] : data?.image;
    if (typeof b64 !== 'string') throw new ImageApiError({ kind: 'server', message: t('err.noImage') });
    return base64ToBlob(b64, fallbackMime);
  }
  return new Blob([await res.arrayBuffer()], { type: type.startsWith('image/') ? type : fallbackMime });
}

export async function upscaleImage(cfg: ProviderConfig, auth: AuthRef | undefined, transport: Transport, source: Blob, scale: 2 | 4, signal?: AbortSignal): Promise<Blob> {
  return imageToImage(cfg, auth, transport, 'image/upscale', { image: await blobToBase64(source), scale }, 'image/png', signal);
}

export async function editImage(cfg: ProviderConfig, auth: AuthRef | undefined, transport: Transport, source: Blob, p: ImageParams, signal?: AbortSignal): Promise<Blob> {
  const body: Record<string, unknown> = { image: await blobToBase64(source), prompt: p.prompt, safe_mode: p.safeMode };
  if (p.model) body.model = p.model;
  if (p.enhancePrompt) body.enhance_prompt = true;
  return imageToImage(cfg, auth, transport, 'image/edit', body, 'image/png', signal);
}

export async function removeBackground(cfg: ProviderConfig, auth: AuthRef | undefined, transport: Transport, source: Blob, signal?: AbortSignal): Promise<Blob> {
  return imageToImage(cfg, auth, transport, 'image/background-remove', { image: await blobToBase64(source) }, 'image/png', signal);
}

/** Venice as an image provider (generate, plus upscale, edit and background removal) */
export const veniceImageProvider: ImageProvider = {
  id: 'venice',
  label: 'Venice',
  account: 'venice',
  listModels: (cfg, transport) => listImageModels(cfg, transport),
  listStyles: (c) => listStyles(c.config, c.auth, c.transport),
  generate: (p, m, c) => generateImages(c.config, c.auth, c.transport, p, m, c.signal),
  upscale: (source, scale, c) => upscaleImage(c.config, c.auth, c.transport, source, scale, c.signal),
  edit: (source, p, c) => editImage(c.config, c.auth, c.transport, source, p, c.signal),
  removeBackground: (source, c) => removeBackground(c.config, c.auth, c.transport, source, c.signal),
  estimateCost: estimateImageCost,
  privacyLabel: (m) =>
    m?.privacy === 'private'
      ? { tone: 'green', label: 'private', title: t('privacy.privateTitle') }
      : m?.privacy === 'anonymized'
        ? { tone: 'amber', label: t('privacy.relayed'), title: t('privacy.relayedTitle') }
        : { tone: 'zinc', label: 'Venice', title: t('privacy.unknownTitle') }
};
