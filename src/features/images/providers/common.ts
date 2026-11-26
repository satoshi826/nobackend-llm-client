// What every image provider shares: the model description, errors, and the request helper.
import type { AuthRef, ProviderError, Transport } from '../../../lib/providers/types';
import type { ImageParams } from '../../../lib/db/schema';
import { classifyError, errorFromFetchFailure, ProviderFailure } from '../../../lib/providers/errors';
import { t } from '../messages';

export interface ImageModelInfo {
  providerId: string;
  id: string;
  name: string;
  privacy: 'private' | 'anonymized' | 'unknown';
  traits: string[];
  constraints: {
    promptCharacterLimit?: number;
    steps?: { default?: number; max?: number };
    /** Venice models sized by width x height: what they must be divisible by */
    widthHeightDivisor?: number;
    /** Every size the model makes (see ImageSize); empty when the provider decides */
    sizes: ImageSize[];
    defaultSize?: string;
    /** What a size's tier is called in the menu ('quality' for OpenAI) */
    tierLabel?: 'resolution' | 'quality';
  };
  /** USD per image when a size has no price of its own */
  pricing: { generation?: number; source?: 'api' | 'table'; asOf?: string };
  /** Most images one request can make (default 4) */
  maxImages?: number;
  /** Options the bar shows for this model (missing = all of them, as for Venice) */
  options?: { seed?: boolean; negativePrompt?: boolean; styles?: boolean; enhance?: boolean };
  offline?: boolean;
  deprecated?: boolean;
}

/**
 * One size a model can make. aspect: its aspect ratio (left out when the provider names sizes its own way, as
 * NanoGPT does); tier: its level within the aspect (resolution "2K", quality "high"); price: USD per image.
 * The image bar shows an aspect menu and, when an aspect has several, a tier menu; without aspects, one size menu.
 */
export interface ImageSize {
  id: string;
  aspect?: string;
  tier?: string;
  price?: number;
}

/** Sizes for every pair of aspect ratio and tier (no tiers: one size per aspect) */
export function sizeGrid(aspects: string[], tiers: string[] = [], price?: (aspect: string, tier?: string) => number | undefined): ImageSize[] {
  const withPrice = (s: ImageSize): ImageSize => {
    const p = price?.(s.aspect!, s.tier);
    return p === undefined ? s : { ...s, price: p };
  };
  return tiers.length ? aspects.flatMap((aspect) => tiers.map((tier) => withPrice({ id: `${aspect} ${tier}`, aspect, tier }))) : aspects.map((aspect) => withPrice({ id: aspect, aspect }));
}

/**
 * The size a request asks for: its size id, else its aspect ratio and tier (requests saved before size ids, or a
 * size chosen for another model), else the default tier of that aspect, else the model's default
 */
export function sizeOf(m: ImageModelInfo | undefined, p: Pick<ImageParams, 'size' | 'aspectRatio' | 'resolution'>): ImageSize | undefined {
  const sizes = m?.constraints.sizes ?? [];
  const byId = sizes.find((s) => s.id === p.size);
  if (byId) return byId;
  const def = sizes.find((s) => s.id === m?.constraints.defaultSize) ?? sizes[0];
  const sameAspect = p.aspectRatio ? sizes.filter((s) => s.aspect === p.aspectRatio) : [];
  return sameAspect.find((s) => s.tier === p.resolution) ?? sameAspect.find((s) => s.tier === def?.tier) ?? sameAspect[0] ?? def;
}

/** Images one request makes for a model */
export const imageCount = (p: Pick<ImageParams, 'variants'>, m: ImageModelInfo | undefined) => Math.min(m?.maxImages ?? 4, 4, Math.max(1, p.variants));

/** Estimated USD for generating: the chosen size's price (or the model's) times the images (undefined when unknown) */
export function generationCost(p: ImageParams, m: ImageModelInfo | undefined): number | undefined {
  const each = sizeOf(m, p)?.price ?? m?.pricing.generation;
  return each === undefined ? undefined : each * imageCount(p, m);
}

/** Whether the bar should offer an option for this model */
export const hasOption = (m: ImageModelInfo | undefined, k: keyof NonNullable<ImageModelInfo['options']>) => !m?.options || !!m.options[k];

/** Aspect ratios offered for models that take width/height instead of aspect_ratio */
export const DEFAULT_ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16'];

/** Error from an image API, with the alternatives a provider may suggest after a content-policy rejection */
export class ImageApiError extends Error {
  constructor(
    public readonly error: ProviderError,
    public readonly suggestion?: { prompt?: string; model?: string }
  ) {
    super(error.message);
  }
}

/** Send a request; network failures and non-2xx responses become ImageApiError */
export async function sendImageRequest(transport: Transport, url: string, init: RequestInit, auth: AuthRef | undefined): Promise<Response> {
  let res: Response;
  try {
    res = await transport.fetch(url, init, auth);
  } catch (e) {
    if (e instanceof ProviderFailure) throw new ImageApiError(e.error);
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ImageApiError(errorFromFetchFailure(e));
  }
  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    if (res.status === 503) throw new ImageApiError({ kind: 'server', status: 503, message: t('err.busy') });
    throw new ImageApiError(classifyError(res.status, body, res.headers.get('retry-after')));
  }
  return res;
}

export const jsonPost = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(body),
  signal
});

/** Run one request per image for providers that make one image per call (in parallel, at most 4) */
export async function perImage<T>(count: number, run: (i: number) => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({ length: Math.min(4, Math.max(1, count)) }, (_, i) => run(i)));
}
