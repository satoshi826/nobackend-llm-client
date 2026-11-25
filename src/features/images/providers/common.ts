// What every image provider shares: the model description, errors, and the request helper.
import type { AuthRef, ProviderError, Transport } from '../../../lib/providers/types';
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
    widthHeightDivisor?: number;
    aspectRatios?: string[];
    defaultAspectRatio?: string;
    /** Sizes or quality levels the model offers (shown as one menu; resolutionLabel names it) */
    resolutions?: string[];
    defaultResolution?: string;
    /** What "resolution" means for this model ('quality' for OpenAI) */
    resolutionLabel?: 'resolution' | 'quality';
  };
  /** USD per image; resolutions overrides generation when present */
  pricing: { generation?: number; resolutions?: Record<string, number>; source?: 'api' | 'table'; asOf?: string };
  /** Options the bar shows for this model (missing = all of them, as for Venice) */
  options?: { seed?: boolean; negativePrompt?: boolean; styles?: boolean; enhance?: boolean };
  offline?: boolean;
  deprecated?: boolean;
}

/** Whether the bar should offer an option for this model */
export const hasOption = (m: ImageModelInfo | undefined, k: keyof NonNullable<ImageModelInfo['options']>) => !m?.options || !!m.options[k];

/** Aspect ratios offered for models that take width/height instead of aspect_ratio */
export const DEFAULT_ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16'];

export function aspectsOf(m: ImageModelInfo | undefined): string[] {
  return m?.constraints.aspectRatios?.length ? m.constraints.aspectRatios : DEFAULT_ASPECTS;
}

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
