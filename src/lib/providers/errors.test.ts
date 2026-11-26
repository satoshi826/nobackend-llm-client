import { describe, expect, it } from 'vitest';
import { classifyError, errorFromFetchFailure, errorFromResponse, isAbort } from './errors';

describe('classifyError', () => {
  it('maps HTTP statuses to error kinds', () => {
    expect(classifyError(401, null).kind).toBe('auth');
    expect(classifyError(403, null).kind).toBe('auth');
    expect(classifyError(402, null).kind).toBe('insufficient-balance');
    expect(classifyError(429, null).kind).toBe('rate-limit');
    expect(classifyError(404, null).kind).toBe('model-unavailable');
    expect(classifyError(400, null).kind).toBe('bad-request');
    expect(classifyError(422, null).kind).toBe('bad-request');
    expect(classifyError(500, null).kind).toBe('server');
    expect(classifyError(503, null).status).toBe(503);
  });

  it('treats PRO_ONLY_MODEL as an unavailable model only on 401, wherever the code is', () => {
    expect(classifyError(401, { code: 'PRO_ONLY_MODEL' }).kind).toBe('model-unavailable');
    expect(classifyError(401, { error: { code: 'PRO_ONLY_MODEL', message: 'pro' } })).toMatchObject({ kind: 'model-unavailable', hint: 'pro' });
    expect(classifyError(403, { code: 'PRO_ONLY_MODEL' }).kind).toBe('auth');
  });

  it('reads the API message from the shapes providers use, as a hint', () => {
    expect(classifyError(401, { error: 'plain string' }).hint).toBe('plain string');
    expect(classifyError(401, { error: { message: 'nested' } }).hint).toBe('nested');
    expect(classifyError(401, { message: 'top level' }).hint).toBe('top level');
    expect(classifyError(401, { details: { message: 'details' } }).hint).toBe('details');
    expect(classifyError(401, null).hint).toBeUndefined();
  });

  it('puts the API message into a bad-request message instead of a hint, and trims it when there is none', () => {
    const withDetail = classifyError(400, { error: { message: 'max_tokens too large' } });
    expect(withDetail.message).toContain('max_tokens too large');
    expect(withDetail.message).toContain('400');
    expect(withDetail.hint).toBeUndefined();
    const bare = classifyError(400, null);
    expect(bare.message).toBe(bare.message.trim());
  });

  it('reads retry-after as seconds or an HTTP date, and ignores anything else', () => {
    const secs = classifyError(429, null, '12');
    expect(secs.retryAfterMs).toBe(12_000);
    expect(secs.message).toContain('12');
    const date = classifyError(429, null, new Date(Date.now() + 30_000).toUTCString());
    expect(date.retryAfterMs).toBeGreaterThan(25_000);
    expect(date.retryAfterMs).toBeLessThanOrEqual(30_000);
    expect(classifyError(429, null, new Date(Date.now() - 60_000).toUTCString()).retryAfterMs).toBe(0);
    expect(classifyError(429, null, 'soon').retryAfterMs).toBeUndefined();
    expect(classifyError(429, null, null).retryAfterMs).toBeUndefined();
  });

  it('rounds the seconds in the rate-limit message up', () => {
    expect(classifyError(429, null, '1.2').message).toContain('2');
  });
});

describe('errorFromResponse', () => {
  it('parses a JSON body and the retry-after header', async () => {
    const res = new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429, headers: { 'retry-after': '3' } });
    expect(await errorFromResponse(res)).toMatchObject({ kind: 'rate-limit', status: 429, retryAfterMs: 3000, hint: 'slow down' });
  });

  it('copes with bodies that are empty or not JSON', async () => {
    expect(await errorFromResponse(new Response('<html>Bad Gateway</html>', { status: 502 }))).toMatchObject({ kind: 'server', status: 502, hint: undefined });
    expect(await errorFromResponse(new Response(null, { status: 401 }))).toMatchObject({ kind: 'auth', hint: undefined });
  });
});

describe('errorFromFetchFailure', () => {
  it('reports an abort as aborted, and anything else as a network or CORS failure with the hint', () => {
    const abort = new DOMException('aborted', 'AbortError');
    expect(isAbort(abort)).toBe(true);
    expect(errorFromFetchFailure(abort).kind).toBe('aborted');
    expect(isAbort(new TypeError('Failed to fetch'))).toBe(false);
    expect(errorFromFetchFailure(new TypeError('Failed to fetch'), 'use a proxy')).toMatchObject({ kind: 'network-or-cors', hint: 'use a proxy' });
    expect(isAbort(undefined)).toBe(false);
  });
});
