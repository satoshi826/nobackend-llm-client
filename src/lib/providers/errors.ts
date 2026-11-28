import type { ProviderError, ProviderErrorKind } from './types';
import { t as tp } from './messages';

export class ProviderFailure extends Error {
  constructor(public readonly error: ProviderError) {
    super(error.message);
  }
}

/** Normalize an HTTP error response into a ProviderError. Body and header contents are used only for display and never logged. */
export async function errorFromResponse(res: Response): Promise<ProviderError> {
  let body: any = null;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return classifyError(res.status, body, res.headers.get('retry-after'));
}

/**
 * How each kind is told apart, in this order, by the error's codes (code, type, status names, reasons; lowercased) and
 * by its message. Codes come first; a message pattern covers providers that only say it in words
 */
const SIGNS: [ProviderErrorKind, RegExp, RegExp | null][] = [
  [
    'content-policy',
    /content_?policy|content_filter|moderation|flagged|safety|prohibited|request_declined|blocklist/,
    /content[\s_]?(management )?polic|safety (system|filter)|flagged|moderation|violates? (our|the|its) (usage |content )?polic/i
  ],
  [
    'insufficient-balance',
    /insufficient_(balance|quota|credits?|funds)|credit_balance|spend_limit|usage_limit|billing|payment_required|budget_exceeded|not_enough_balance|balance_required/,
    /credit balance is too low|insufficient (usd |diem )?(or diem )?(balance|credits?|funds)|reached your specified api usage limits|budget has been exceeded|out of credits/i
  ],
  [
    'model-unavailable',
    /model_not_found|model_not_allowed|model_not_available|model_access_denied|pro_only_model|invalid_model|model_offline|all_fallbacks_failed|no_fallback_available/,
    /\bmodels?\b.*\b(not found|does not exist|not available|not supported|not allowed|decommissioned)|invalid model/i
  ],
  [
    'context-length',
    /context_length|context_window|too_many_tokens|string_above_max_length|request_too_large|payload_too_large/,
    /context (length|window)|prompt is too long|too many tokens|input token count .*exceeds|maximum number of tokens allowed|reduce the length of the messages|input is too long|tokens .*must be <=/i
  ],
  ['overloaded', /overloaded|capacity|unavailable|no_available/, /overloaded|at capacity|no instances available|high demand|\bbusy\b/i],
  ['rate-limit', /rate_limit|too_many_requests|resource_exhausted|throttl|quota_exceeded|slow_down/, null],
  ['auth', /authentication|invalid_api_key|api_key_invalid|unauthenticated|permission|unauthorized|invalid_key|expired_key|token_not_found|auth_error/, null],
  ['timeout', /timeout|deadline_exceeded/, null]
];

/** The kind an HTTP status says on its own, when nothing in the body says more */
function kindOfStatus(status: number | undefined, body: any): ProviderErrorKind {
  if (status === undefined) return 'server';
  if (status === 401 || status === 403) return 'auth';
  // A 402 that asks for a payment protocol (x402) means no key was sent
  if (status === 402) return body?.x402Version !== undefined || Array.isArray(body?.accepts) ? 'auth' : 'insufficient-balance';
  if (status === 404) return 'model-unavailable';
  if (status === 413) return 'context-length';
  if (status === 429) return 'rate-limit';
  if (status === 408 || status === 504 || status === 524) return 'timeout';
  if (status === 498 || status === 503 || status === 529) return 'overloaded';
  return status >= 400 && status < 500 ? 'bad-request' : 'server';
}

/**
 * The common error of a provider's error answer: the HTTP status (absent for one sent inside a stream), its body
 * ({ error: { message, code, type, ... } }, { error: "..." }, { message }, { detail } or Gemini's google.rpc shape) and
 * its retry-after header
 */
export function classifyError(status: number | undefined, body: any, retryAfter?: string | null): ProviderError {
  const err = body?.error && typeof body.error === 'object' ? body.error : (body ?? {});
  const said = [typeof body?.error === 'string' ? body.error : undefined, err.message, body?.message, body?.detail, body?.details?.message].find(
    (x): x is string => typeof x === 'string' && !!x
  );
  const details: any[] = Array.isArray(err.details) ? err.details : [];
  const codes = [err.code, err.type, err.status, body?.code, err.metadata?.error_type, err.details?.error_code, ...details.map((d) => d?.reason)]
    .filter((x): x is string => typeof x === 'string')
    .join(' ')
    .toLowerCase();
  const httpStatus = status ?? [err.code, err.status, body?.status].find((x): x is number => typeof x === 'number');
  const moderated = httpStatus === 403 && Array.isArray(err.metadata?.reasons);
  const kind: ProviderErrorKind = moderated
    ? 'content-policy'
    : (SIGNS.find(([, c, m]) => c.test(codes) || (!!m && !!said && m.test(said)))?.[0] ?? kindOfStatus(httpStatus, body));
  const retryAfterMs = kind === 'rate-limit' || kind === 'overloaded' ? waitOf(retryAfter, err, body, details) : undefined;
  return { kind, status: httpStatus, message: messageOf(kind, retryAfterMs), ...(retryAfterMs !== undefined ? { retryAfterMs } : {}), detail: detailOf(said) };
}

/** The text of each kind: what happened, then what to do */
function messageOf(kind: ProviderErrorKind, retryAfterMs?: number): string {
  switch (kind) {
    case 'auth':
      return tp('error.auth');
    case 'insufficient-balance':
      return tp('error.balance');
    case 'rate-limit':
      return retryAfterMs ? tp('error.rateLimitAfter', { seconds: Math.ceil(retryAfterMs / 1000) }) : tp('error.rateLimit');
    case 'model-unavailable':
      return tp('error.model');
    case 'context-length':
      return tp('error.contextLength');
    case 'content-policy':
      return tp('error.policy');
    case 'overloaded':
      return tp('error.overloaded');
    case 'timeout':
      return tp('error.timeout');
    case 'bad-request':
      return tp('error.badRequest');
    case 'network-or-cors':
      return tp('error.network');
    default:
      return tp('error.server');
  }
}

/** How long the provider asks to wait: the retry-after header, a retry_after field (seconds) or Gemini's RetryInfo ("17s") */
function waitOf(header: string | null | undefined, err: any, body: any, details: any[]): number | undefined {
  const fromHeader = parseRetryAfter(header);
  if (fromHeader !== undefined) return fromHeader;
  const secs = [err.retry_after, body?.retry_after].find((x): x is number => typeof x === 'number');
  if (secs !== undefined) return secs * 1000;
  const delay = details.find((d) => typeof d?.retryDelay === 'string')?.retryDelay;
  const n = typeof delay === 'string' ? parseFloat(delay) : NaN;
  return Number.isFinite(n) ? n * 1000 : undefined;
}

/** Key-like strings: known key prefixes, Google keys, and long random tokens (mixed case with digits, or hex) */
const KEYLIKE = /\b(?:sk|pk|rk|gsk|csk|xai|nvapi|tvly|jina)[-_][\w*-]{6,}|\bAIza[\w-]{20,}|\b(?=[\w-]*\d)(?=[\w-]*[A-Z])(?=[\w-]*[a-z])[\w-]{32,}|\b[a-f0-9]{32,}\b/g;
const DETAIL_MAX = 600;

/** The provider's own words for the details: key-like strings taken out (some providers echo part of the key), cut short */
export function detailOf(text: string | undefined): string | undefined {
  const s = text?.replace(KEYLIKE, '•••').trim();
  if (!s) return undefined;
  return s.length > DETAIL_MAX ? s.slice(0, DETAIL_MAX) + '…' : s;
}

/** When fetch itself fails (no response). Browsers report CORS failures only as "Failed to fetch". */
export function errorFromFetchFailure(err: unknown, corsHint?: string): ProviderError {
  if (isAbort(err)) return { kind: 'aborted', message: tp('stream.stopped') };
  return { kind: 'network-or-cors', message: tp('error.network'), hint: corsHint };
}

/** Send a request: not reaching the provider, or an error answer, throws a ProviderFailure (the common error) */
export async function sendOrFail(send: () => Promise<Response>, corsHint?: string): Promise<Response> {
  let res: Response;
  try {
    res = await send();
  } catch (e) {
    throw new ProviderFailure(failureOf(e, corsHint));
  }
  if (!res.ok) throw new ProviderFailure(await errorFromResponse(res));
  return res;
}

/**
 * The common error of what sending threw. The key vault reports not reaching the provider in its own words: it gets
 * the same text and hint as a request without a key
 */
export const failureOf = (e: unknown, corsHint?: string): ProviderError =>
  e instanceof ProviderFailure && e.error.kind !== 'network-or-cors' ? e.error : errorFromFetchFailure(e, corsHint);

export function isAbort(err: unknown): boolean {
  return (err as any)?.name === 'AbortError';
}

function parseRetryAfter(v?: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return n * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : undefined;
}
