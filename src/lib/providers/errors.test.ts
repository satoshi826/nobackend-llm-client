import { describe, expect, it } from 'vitest';
import type { ProviderErrorKind } from './types';
import { classifyError, detailOf, errorFromFetchFailure, errorFromResponse, failureOf, isAbort, ProviderFailure } from './errors';
import { t as tp } from './messages';

type Case = [label: string, status: number | undefined, body: unknown, kind: ProviderErrorKind, retryAfter?: string];

// What each provider sends, from its API docs (error codes pages) and, where the docs are silent, observed answers
const PROVIDERS: Record<string, Case[]> = {
  Venice: [
    ['bad key', 401, { error: 'Authentication failed', code: 'AUTHENTICATION_FAILED' }, 'auth'],
    ['inactive key', 401, { error: 'Inactive key', code: 'AUTHENTICATION_FAILED_INACTIVE_KEY' }, 'auth'],
    ['no key (x402)', 402, { x402Version: 1, accepts: [] }, 'auth'],
    ['no balance', 402, { error: 'Insufficient USD or Diem balance to complete request.', code: 'INSUFFICIENT_BALANCE' }, 'insufficient-balance'],
    ['key spend limit', 402, { error: 'Spend limit reached', code: 'API_KEY_USD_SPEND_LIMIT_EXCEEDED' }, 'insufficient-balance'],
    ['rate limit', 429, { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' }, 'rate-limit'],
    ['model overloaded', 429, { error: 'Model overloaded', code: 'MODEL_OVERLOADED' }, 'overloaded'],
    ['pro-only model', 401, { error: { code: 'PRO_ONLY_MODEL', message: 'pro' } }, 'model-unavailable'],
    ['unknown model', 404, { error: 'Specified model not found', code: 'MODEL_NOT_FOUND' }, 'model-unavailable'],
    ['too many tokens', 400, { error: 'Too many tokens', code: 'TOO_MANY_TOKENS' }, 'context-length'],
    ['context length', 400, { error: { type: 'invalid_request_error', param: 'messages', code: 'context_length_exceeded', message: "This model's maximum context length is 32768 tokens." } }, 'context-length'],
    ['payload too large', 413, { error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' }, 'context-length'],
    ['content policy', 422, { error: 'Your request violates the content policy.', code: 'CONTENT_POLICY_VIOLATION' }, 'content-policy'],
    ['at capacity', 503, { error: 'The model is at capacity.', code: 'MODEL_AT_CAPACITY' }, 'overloaded'],
    ['offline model', 503, { error: 'Model offline', code: 'MODEL_OFFLINE' }, 'model-unavailable'],
    ['inference failed', 500, { error: 'Inference processing failed.', code: 'INFERENCE_FAILED' }, 'server'],
    ['timeout', 504, { error: 'The request timed out.', code: 'REQUEST_TIMEOUT' }, 'timeout']
  ],
  OpenRouter: [
    ['bad key', 401, { error: { code: 401, message: 'No auth credentials found' } }, 'auth'],
    ['no credits', 402, { error: { code: 402, message: 'Insufficient credits. Add more using https://openrouter.ai/credits' } }, 'insufficient-balance'],
    ['moderation', 403, { error: { code: 403, message: 'Input was flagged', metadata: { reasons: ['violence'], flagged_input: '...' } } }, 'content-policy'],
    ['timeout', 408, { error: { code: 408, message: 'Request timed out' } }, 'timeout'],
    ['rate limit', 429, { error: { code: 429, message: 'Rate limit exceeded', metadata: { error_type: 'rate_limit_exceeded' } } }, 'rate-limit', '7'],
    ['model down', 502, { error: { code: 502, message: 'Provider returned error' } }, 'server'],
    ['no provider', 503, { error: { code: 503, message: 'No endpoints found that support the requested parameters', metadata: { error_type: 'provider_unavailable' } } }, 'overloaded'],
    ['context length', 400, { error: { code: 400, message: "This endpoint's maximum context length is 131072 tokens. However, you requested about 140000 tokens." } }, 'context-length']
  ],
  Anthropic: [
    ['bad key', 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'auth'],
    ['permission', 403, { type: 'error', error: { type: 'permission_error', message: 'Your API key does not have permission' } }, 'auth'],
    ['billing', 402, { type: 'error', error: { type: 'billing_error', message: 'There is an issue with your billing' } }, 'insufficient-balance'],
    ['credit too low', 400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }, 'insufficient-balance'],
    ['own usage limit', 400, { type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your specified API usage limits.' } }, 'insufficient-balance'],
    ['spend cap', 429, { type: 'error', error: { type: 'rate_limit_error', message: 'Spend limit', details: { error_code: 'enforced_spend_limit_reached' } } }, 'insufficient-balance'],
    ['rate limit', 429, { type: 'error', error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit' } }, 'rate-limit', '20'],
    ['unknown model', 404, { type: 'error', error: { type: 'not_found_error', message: 'model: claude-x' } }, 'model-unavailable'],
    ['prompt too long', 400, { type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 210432 tokens > 200000 maximum' } }, 'context-length'],
    ['request too large', 413, { type: 'error', error: { type: 'request_too_large', message: 'Request exceeds the maximum allowed size' } }, 'context-length'],
    ['api error', 500, { type: 'error', error: { type: 'api_error', message: 'Internal server error' } }, 'server'],
    ['timeout', 504, { type: 'error', error: { type: 'timeout_error', message: 'Request timed out' } }, 'timeout'],
    ['overloaded', 529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'overloaded']
  ],
  OpenAI: [
    ['bad key', 401, { error: { message: 'Incorrect API key provided: sk-proj-abc1****wxyz.', type: 'invalid_request_error', code: 'invalid_api_key' } }, 'auth'],
    ['region', 403, { error: { message: 'Country, region, or territory not supported', type: 'request_forbidden', code: 'unsupported_country_region_territory' } }, 'auth'],
    ['no quota', 429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } }, 'insufficient-balance'],
    ['credit used up', 429, { error: { message: 'Your credit balance is exhausted.', type: 'insufficient_quota', code: 'credit_balance_exhausted' } }, 'insufficient-balance'],
    ['spend limit', 429, { error: { message: 'Project spend limit exceeded.', type: 'insufficient_quota', code: 'project_spend_limit_exceeded' } }, 'insufficient-balance'],
    ['rate limit', 429, { error: { message: 'Rate limit reached for requests', type: 'requests', code: 'rate_limit_exceeded' } }, 'rate-limit', '20'],
    ['unknown model', 404, { error: { message: 'The model `gpt-x` does not exist or you do not have access to it.', type: 'invalid_request_error', code: 'model_not_found' } }, 'model-unavailable'],
    ['context length', 400, { error: { message: "This model's maximum context length is 128000 tokens.", type: 'invalid_request_error', param: 'messages', code: 'context_length_exceeded' } }, 'context-length'],
    ['content policy', 400, { error: { message: 'Your request was rejected as a result of our safety system.', type: 'invalid_request_error', code: 'content_policy_violation' } }, 'content-policy'],
    ['bad parameter', 400, { error: { message: "Unsupported parameter: 'temperature' is not supported with this model.", type: 'invalid_request_error', code: 'unsupported_parameter' } }, 'bad-request'],
    ['server', 500, { error: { message: 'The server had an error while processing your request.', type: 'server_error' } }, 'server'],
    ['overloaded', 503, { error: { message: 'The server is overloaded or not ready yet.', type: 'server_error', code: 'server_is_overloaded' } }, 'overloaded']
  ],
  Gemini: [
    ['bad key', 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] } }, 'auth'],
    ['denied', 403, { error: { code: 403, message: 'Your API key was reported as leaked. Please use another API key.', status: 'PERMISSION_DENIED' } }, 'auth'],
    ['prepay used up', 402, { error: { code: 402, message: 'Prepay credits depleted', status: 'PAYMENT_REQUIRED' } }, 'insufficient-balance'],
    ['quota', 429, { error: { code: 429, message: 'You exceeded your current quota, please check your plan and billing details.', status: 'RESOURCE_EXHAUSTED' } }, 'rate-limit'],
    ['unknown model', 404, { error: { code: 404, message: 'models/gemini-x is not found for API version v1beta', status: 'NOT_FOUND' } }, 'model-unavailable'],
    ['context length', 400, { error: { code: 400, message: 'The input token count (1210000) exceeds the maximum number of tokens allowed (1048576).', status: 'INVALID_ARGUMENT' } }, 'context-length'],
    ['safety', 400, { error: { code: 400, message: 'The request was blocked by safety filters', status: 'INVALID_ARGUMENT' } }, 'content-policy'],
    ['region', 400, { error: { code: 400, message: 'User location is not supported for the API use.', status: 'FAILED_PRECONDITION' } }, 'bad-request'],
    ['internal', 500, { error: { code: 500, message: 'An internal error has occurred.', status: 'INTERNAL' } }, 'server'],
    ['overloaded', 503, { error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } }, 'overloaded'],
    ['deadline', 504, { error: { code: 504, message: 'Deadline expired', status: 'DEADLINE_EXCEEDED' } }, 'timeout']
  ],
  DeepSeek: [
    ['bad key', 401, { error: { message: 'Authentication Fails, Your api key: ****abcd is invalid', type: 'authentication_error', code: 'invalid_request_error' } }, 'auth'],
    ['no balance', 402, { error: { message: 'Insufficient Balance', type: 'unknown_error' } }, 'insufficient-balance'],
    ['bad parameters', 422, { error: { message: 'Invalid Parameters', type: 'invalid_request_error' } }, 'bad-request'],
    ['rate limit', 429, { error: { message: 'Rate Limit Reached', type: 'rate_limit_reached' } }, 'rate-limit'],
    ['context length', 400, { error: { message: "This model's maximum context length is 131072 tokens. However, you requested 140000 tokens.", type: 'invalid_request_error' } }, 'context-length'],
    ['server', 500, { error: { message: 'Server Error', type: 'server_error' } }, 'server'],
    ['overloaded', 503, { error: { message: 'Server Overloaded', type: 'server_error' } }, 'overloaded']
  ],
  Groq: [
    ['bad key', 401, { error: { message: 'Invalid API Key', type: 'invalid_request_error', code: 'invalid_api_key' } }, 'auth'],
    ['unknown model', 404, { error: { message: 'The model `x` does not exist or you do not have access to it.', type: 'invalid_request_error', code: 'model_not_found' } }, 'model-unavailable'],
    ['too large', 413, { error: { message: 'Request Entity Too Large', type: 'invalid_request_error' } }, 'context-length'],
    ['context length', 400, { error: { message: 'Please reduce the length of the messages or completion.', type: 'invalid_request_error', code: 'context_length_exceeded' } }, 'context-length'],
    ['rate limit', 429, { error: { message: 'Rate limit reached for model', type: 'tokens', code: 'rate_limit_exceeded' } }, 'rate-limit', '7.66'],
    ['flex capacity', 498, { error: { message: 'Flex tier capacity exceeded', type: 'capacity_exceeded' } }, 'overloaded'],
    ['unavailable', 503, { error: { message: 'Service Unavailable', type: 'internal_server_error' } }, 'overloaded']
  ],
  NanoGPT: [
    ['bad key', 401, { error: { message: 'Invalid API key', type: 'authentication_error' } }, 'auth'],
    ['no balance', 402, { error: 'Insufficient balance', requiredBalance: 0.0035, status: 402 }, 'insufficient-balance'],
    ['unknown model', 404, { error: { message: 'Model not found', type: 'not_found_error', code: 'model_not_found' } }, 'model-unavailable'],
    ['not allowed', 403, { error: { message: 'Model not allowed for this key', type: 'permission_error', code: 'model_not_allowed' } }, 'model-unavailable'],
    ['context length', 400, { error: { message: 'Context too long', type: 'invalid_request_error', code: 'context_length_exceeded' } }, 'context-length'],
    ['content policy', 400, { error: { message: 'Rejected', type: 'invalid_request_error', code: 'content_policy_violation' } }, 'content-policy'],
    ['rate limit', 429, { error: { message: 'Too many requests', type: 'rate_limit_error' } }, 'rate-limit', '5'],
    ['unavailable', 503, { error: { message: 'Service temporarily unavailable.', type: 'service_unavailable', code: 'service_unavailable' } }, 'overloaded']
  ],
  'DeepInfra, Cerebras, Novita, Chutes, Together': [
    ['DeepInfra rate limit', 429, { error: { message: 'Rate limited' } }, 'rate-limit'],
    ['DeepInfra model busy', 429, { error: { message: 'Model busy' } }, 'overloaded'],
    ['Cerebras no credit', 402, { error: { message: 'Payment required', type: 'payment_required' } }, 'insufficient-balance'],
    ['Cerebras rate limit', 429, { error: { message: 'Rate limit exceeded', type: 'requests', code: 'rate_limit_exceeded' } }, 'rate-limit'],
    ['Novita no access', 403, { error: { message: 'model access denied', reason: 'model_access_denied', code: 'model_access_denied' } }, 'model-unavailable'],
    ['Chutes no instances', 503, { detail: 'No instances available (yet) for chute_id=abc' }, 'overloaded'],
    ['Chutes exhausted', 500, { detail: 'exhausted all available targets to no avail' }, 'server'],
    ['Together no balance', 402, { error: { message: 'Credit limit exceeded', type: 'credit_limit' } }, 'insufficient-balance'],
    ['Together context', 400, { error: { message: 'Input validation error: `inputs` tokens + `max_new_tokens` must be <= 32769. Given: 40000 `inputs` tokens', type: 'invalid_request_error' } }, 'context-length'],
    ['Together gateway timeout', 524, null, 'timeout'],
    ['Together overloaded', 529, { error: { message: 'Overloaded' } }, 'overloaded']
  ],
  'OpenAI-compatible servers': [
    ['Ollama unknown model', 404, { error: { message: "model 'llama9' not found", type: 'not_found_error' } }, 'model-unavailable'],
    ['vLLM context length', 400, { object: 'error', message: "This model's maximum context length is 8192 tokens and your request has 9000 input tokens.", type: 'BadRequestError', code: 400 }, 'context-length'],
    ['LiteLLM context', 400, { error: { message: 'litellm.ContextWindowExceededError: context window exceeded', type: 'invalid_request_error', code: '400' } }, 'context-length'],
    ['LiteLLM policy', 400, { error: { message: 'litellm.ContentPolicyViolationError: blocked', type: 'invalid_request_error', code: '400' } }, 'content-policy'],
    ['LiteLLM budget', 422, { error: { message: 'Budget has been exceeded! Current cost: 5, Max budget: 5', type: 'budget_exceeded', code: '422' } }, 'insufficient-balance'],
    ['LiteLLM throttled', 429, { error: { message: 'Rate limited', type: 'throttling_error', code: '429' } }, 'rate-limit']
  ]
};

describe('classifyError, per provider', () => {
  for (const [provider, cases] of Object.entries(PROVIDERS)) {
    describe(provider, () => {
      for (const [label, status, body, kind, retryAfter] of cases) {
        it(`${label} → ${kind}`, () => {
          const e = classifyError(status, body, retryAfter);
          expect(e.kind).toBe(kind);
          expect(e.status).toBe(status);
          expect(e.message).not.toBe('');
          if (retryAfter) expect(e.retryAfterMs).toBe(Number(retryAfter) * 1000);
        });
      }
    });
  }
});

describe('classifyError', () => {
  it('maps bare HTTP statuses to error kinds', () => {
    const kinds: [number, ProviderErrorKind][] = [
      [400, 'bad-request'],
      [401, 'auth'],
      [402, 'insufficient-balance'],
      [403, 'auth'],
      [404, 'model-unavailable'],
      [408, 'timeout'],
      [413, 'context-length'],
      [422, 'bad-request'],
      [429, 'rate-limit'],
      [500, 'server'],
      [502, 'server'],
      [503, 'overloaded'],
      [504, 'timeout'],
      [529, 'overloaded']
    ];
    for (const [status, kind] of kinds) expect([status, classifyError(status, null).kind]).toEqual([status, kind]);
  });

  it('gives one text per kind, without the provider’s words or the status in it', () => {
    const e = classifyError(400, { error: { message: 'max_tokens too large' } });
    expect(e.message).toBe(tp('error.badRequest'));
    expect(e.detail).toBe('max_tokens too large');
    expect(classifyError(500, null).message).toBe(tp('error.server'));
    expect(classifyError(401, null).message).toBe(tp('error.auth'));
  });

  it('keeps the provider’s words from the shapes providers use as the detail', () => {
    expect(classifyError(401, { error: 'plain string' }).detail).toBe('plain string');
    expect(classifyError(401, { error: { message: 'nested' } }).detail).toBe('nested');
    expect(classifyError(401, { message: 'top level' }).detail).toBe('top level');
    expect(classifyError(401, { details: { message: 'details' } }).detail).toBe('details');
    expect(classifyError(500, { detail: 'fastapi' }).detail).toBe('fastapi');
    expect(classifyError(401, null).detail).toBeUndefined();
  });

  it('reads how long to wait from retry-after (seconds or an HTTP date), a retry_after field or Gemini’s RetryInfo', () => {
    const secs = classifyError(429, null, '12');
    expect(secs.retryAfterMs).toBe(12_000);
    expect(secs.message).toBe(tp('error.rateLimitAfter', { seconds: 12 }));
    const date = classifyError(429, null, new Date(Date.now() + 30_000).toUTCString());
    expect(date.retryAfterMs).toBeGreaterThan(25_000);
    expect(date.retryAfterMs).toBeLessThanOrEqual(30_000);
    expect(classifyError(429, null, new Date(Date.now() - 60_000).toUTCString()).retryAfterMs).toBe(0);
    expect(classifyError(429, null, 'soon').retryAfterMs).toBeUndefined();
    expect(classifyError(429, null, null).message).toBe(tp('error.rateLimit'));
    expect(classifyError(429, { error: { message: 'slow', retry_after: 3 } }).retryAfterMs).toBe(3000);
    const gemini = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' }] } };
    expect(classifyError(429, gemini).retryAfterMs).toBe(17_000);
    expect(classifyError(503, null, '4').retryAfterMs).toBe(4000);
    expect(classifyError(500, null, '4').retryAfterMs).toBeUndefined();
  });

  it('rounds the seconds in the rate-limit message up', () => {
    expect(classifyError(429, null, '1.2').message).toBe(tp('error.rateLimitAfter', { seconds: 2 }));
  });

  it('classifies an error sent inside a stream by its body, with the status it names when there is one', () => {
    // OpenRouter / NanoGPT: a chunk with error.code (number) or error.status
    expect(classifyError(undefined, { error: { code: 429, message: 'Rate limited' }, choices: [{ finish_reason: 'error' }] })).toMatchObject({ kind: 'rate-limit', status: 429 });
    expect(classifyError(undefined, { error: { status: 503, message: 'Service temporarily unavailable.', code: 'service_unavailable' } })).toMatchObject({ kind: 'overloaded', status: 503 });
    expect(classifyError(undefined, { error: { message: 'Model overloaded', type: 'server_error', retry_after: 2 } })).toMatchObject({ kind: 'overloaded', retryAfterMs: 2000 });
    expect(classifyError(undefined, { error: { message: 'boom' } }).kind).toBe('server');
  });
});

describe('detailOf', () => {
  it('takes out key-like strings', () => {
    expect(detailOf('Incorrect API key provided: sk-proj-abc1****************wxyz. You can find your API key at …')).toBe('Incorrect API key provided: •••. You can find your API key at …');
    expect(detailOf('key AIzaSyA1234567890abcdefghijklmnop is invalid')).toBe('key ••• is invalid');
    expect(detailOf('token Ab3dEfGh1jKlMnOpQrStUvWxYz012345678 rejected')).toBe('token ••• rejected');
    expect(detailOf('hex 0123456789abcdef0123456789abcdef rejected')).toBe('hex ••• rejected');
  });

  it('keeps model ids and ordinary words, and cuts long text short', () => {
    expect(detailOf('The model `deepseek-ai/DeepSeek-R1-Distill-Llama-70B` does not exist')).toBe('The model `deepseek-ai/DeepSeek-R1-Distill-Llama-70B` does not exist');
    expect(detailOf('x'.repeat(700))?.length).toBe(601);
    expect(detailOf('   ')).toBeUndefined();
  });
});

describe('errorFromResponse', () => {
  it('parses a JSON body and the retry-after header', async () => {
    const res = new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429, headers: { 'retry-after': '3' } });
    expect(await errorFromResponse(res)).toMatchObject({ kind: 'rate-limit', status: 429, retryAfterMs: 3000, detail: 'slow down' });
  });

  it('copes with bodies that are empty or not JSON', async () => {
    expect(await errorFromResponse(new Response('<html>Bad Gateway</html>', { status: 502 }))).toMatchObject({ kind: 'server', status: 502, detail: undefined });
    expect(await errorFromResponse(new Response(null, { status: 401 }))).toMatchObject({ kind: 'auth', detail: undefined });
  });
});

describe('errorFromFetchFailure and failureOf', () => {
  it('reports an abort as aborted, and anything else as a network or CORS failure with the hint', () => {
    const abort = new DOMException('aborted', 'AbortError');
    expect(isAbort(abort)).toBe(true);
    expect(errorFromFetchFailure(abort).kind).toBe('aborted');
    expect(isAbort(new TypeError('Failed to fetch'))).toBe(false);
    expect(errorFromFetchFailure(new TypeError('Failed to fetch'), 'use a proxy')).toMatchObject({ kind: 'network-or-cors', message: tp('error.network'), hint: 'use a proxy' });
    expect(isAbort(undefined)).toBe(false);
  });

  it('gives the key vault’s network failure the app’s text and hint, and keeps its other failures', () => {
    expect(failureOf(new ProviderFailure({ kind: 'network-or-cors', message: 'vault words' }), 'hint')).toMatchObject({ kind: 'network-or-cors', message: tp('error.network'), hint: 'hint' });
    const mismatch = { kind: 'host-mismatch' as const, message: 'not this host' };
    expect(failureOf(new ProviderFailure(mismatch), 'hint')).toEqual(mismatch);
  });
});
