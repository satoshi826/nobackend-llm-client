// Video providers: one adapter per service (Venice, OpenRouter, Gemini). The video state calls them only through
// this interface. Each turns its API into the same steps: a price before sending, a job that is started and then
// asked about until the video is ready (or, for a provider that answers in one request, the video right away).
import type { Connection } from '../../connection';
import type { VideoJob, VideoParams } from '../../../../lib/db/schema';
import type { AuthRef, ProviderError, Transport } from '../../../../lib/providers/types';
import { classifyError, failureOf, isAbort } from '../../../../lib/providers/errors';
import { t } from '../messages';

export interface VideoModelInfo {
  providerId: string;
  id: string;
  name: string;
  privacy: 'private' | 'anonymized' | 'unknown';
  /** What the model starts from: a prompt, a first frame (an image) with a prompt, or either */
  input: 'text' | 'image' | 'either';
  /** Seconds it can make */
  durations: number[];
  /** Empty when the provider decides */
  resolutions: string[];
  aspects: string[];
  /** Sound: always made, made on request, or never */
  audio: 'always' | 'optional' | 'none';
  /**
   * USD per second of video when the list says: keyed `resolution|audio`, `resolution|silent` or `resolution|`
   * (resolution in lower case, '' for any)
   */
  perSecond?: Record<string, number>;
  offline?: boolean;
}

export interface VideoCallContext {
  config: Connection;
  auth: AuthRef | undefined;
  transport: Transport;
  signal?: AbortSignal;
}

/** A finished video, and its cost as the provider reported it */
export interface VideoDone {
  video: Blob;
  costUsd?: number;
}

/** Still being made: how far along (0–1) when the provider says */
export interface VideoWaiting {
  progress?: number;
}

export const isDone = (x: VideoDone | VideoWaiting | VideoJob): x is VideoDone => 'video' in x;

export interface VideoProvider {
  id: string;
  label: string;
  /** Vault account holding the key */
  account: string;
  listModels(config: Connection, transport: Transport): Promise<VideoModelInfo[]>;
  /** USD of a request before it is sent; undefined when unknown */
  quote(p: VideoParams, m: VideoModelInfo | undefined, ctx: VideoCallContext): Promise<number | undefined>;
  /** The quote is the provider's own price for the request (recorded as spend), not an estimate */
  quoteIsPrice?: boolean;
  /** Start a job; a provider that answers in one request returns the video itself */
  start(p: VideoParams, m: VideoModelInfo | undefined, firstFrame: Blob | null, ctx: VideoCallContext): Promise<VideoJob | VideoDone>;
  /** Ask about a job (providers with jobs) */
  check?(job: VideoJob, ctx: VideoCallContext): Promise<VideoWaiting | VideoDone>;
  /** Seconds between asks */
  pollSeconds?: number;
  /** Who sees the prompt, for the input box and the answer */
  privacyLabel(m: VideoModelInfo | undefined): { tone: 'green' | 'amber' | 'zinc'; label: string; title: string };
}

const providers = new Map<string, VideoProvider>();

export function registerVideoProvider(p: VideoProvider) {
  providers.set(p.id, p);
}

export function videoProviderOf(id: string): VideoProvider | undefined {
  return providers.get(id);
}

export function videoProviderList(): VideoProvider[] {
  return [...providers.values()];
}

/** USD per second for a resolution and sound, from a model's list (the closest key that exists) */
export function perSecondFor(m: VideoModelInfo | undefined, resolution: string | undefined, audio: boolean): number | undefined {
  const table = m?.perSecond;
  if (!table) return undefined;
  const r = (resolution ?? '').toLowerCase();
  const a = audio ? 'audio' : 'silent';
  for (const k of [`${r}|${a}`, `${r}|`, `|${a}`, '|']) if (table[k] !== undefined) return table[k];
  return undefined;
}

/** Error from a video API, with a model the provider may suggest after a content-policy rejection */
export class VideoApiError extends Error {
  constructor(
    public readonly error: ProviderError,
    public readonly suggestedModel?: string
  ) {
    super(error.message);
  }
}

/**
 * Send a request; network failures and non-2xx responses become VideoApiError. rejected: a provider's own reading
 * of an error response, tried first
 */
export async function sendVideoRequest(
  transport: Transport,
  url: string,
  init: RequestInit,
  auth: AuthRef | undefined,
  rejected?: (status: number, body: any) => VideoApiError | undefined
): Promise<Response> {
  let res: Response;
  try {
    res = await transport.fetch(url, init, auth);
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new VideoApiError(failureOf(e));
  }
  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    const own = rejected?.(res.status, body);
    if (own) throw own;
    throw new VideoApiError(classifyError(res.status, body, res.headers.get('retry-after')));
  }
  return res;
}

export const jsonPost = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify(body),
  signal
});

/** A content-policy rejection (the prompt or the first frame) */
export const policyError = (suggestedModel?: string) => new VideoApiError({ kind: 'content-policy', status: 422, message: t('err.policy') }, suggestedModel);

/** "5s" → 5 */
export const seconds = (x: unknown): number | undefined => {
  const n = typeof x === 'number' ? x : Number(String(x).replace(/s$/, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
