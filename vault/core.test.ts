import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { allowedHosts, handle, validateRequest } from './core';
import { keyedFetch, label } from './store';
import { t } from './messages';
import { ACCOUNTS } from '../src/lib/keys/accounts';
import type { FromVault } from '../src/lib/vault/protocol';

const req = (over: Partial<{ providerId: string; url: string; method: any; body: any }> = {}) => ({
  type: 'fetch' as const,
  id: 'r1',
  providerId: 'venice',
  url: 'https://api.venice.ai/api/v1/chat/completions',
  method: 'POST' as const,
  headers: [] as [string, string][],
  body: '{}',
  ...over
});

describe('key vault: send request validation', () => {
  it('allows permitted hosts', () => {
    expect(allowedHosts('venice')).toEqual(['api.venice.ai']);
    expect(validateRequest(req())).toBeNull();
  });
  it('rejects other hosts, http, URLs with credentials, unknown providers and invalid methods', () => {
    expect(validateRequest(req({ url: 'https://evil.example/steal' }))).not.toBeNull();
    expect(validateRequest(req({ url: 'http://api.venice.ai/api/v1/chat/completions' }))).not.toBeNull();
    expect(validateRequest(req({ url: 'https://user:pass@api.venice.ai/x' }))).not.toBeNull();
    expect(validateRequest(req({ providerId: 'unknown' }))).not.toBeNull();
    expect(validateRequest(req({ method: 'DELETE' }))).not.toBeNull();
    // An OpenRouter key cannot be sent to the Venice host either
    expect(validateRequest(req({ providerId: 'openrouter' }))).not.toBeNull();
  });
  it('returns an error without sending when no key is stored', async () => {
    const out: FromVault[] = [];
    await handle(req(), (m) => out.push(m));
    expect(out[0]).toMatchObject({ type: 'error', kind: 'auth' });
  });
  it('errors without fetching for a rejected host', async () => {
    const out: FromVault[] = [];
    await handle(req({ url: 'https://evil.example/' }), (m) => out.push(m));
    expect(out[0]).toMatchObject({ type: 'error', kind: 'host-mismatch' });
  });
});

describe('key vault: web search services', () => {
  it('attaches the Tavily key only to its own host', () => {
    expect(allowedHosts('tavily')).toEqual(['api.tavily.com']);
    expect(validateRequest(req({ providerId: 'tavily', url: 'https://api.tavily.com/search' }))).toBeNull();
    expect(validateRequest(req({ providerId: 'tavily', url: 'https://api.venice.ai/api/v1/chat/completions' }))).not.toBeNull();
  });
});


describe('keyed fetch uses the provider key header', () => {
  it('Anthropic gets x-api-key, others Bearer; app-supplied auth headers are dropped', async () => {
    const calls: Headers[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_u: any, init: any) => {
      calls.push(new Headers(init.headers));
      return new Response('{}');
    }) as any;
    try {
      await keyedFetch('anthropic', 'https://api.anthropic.com/v1/models', { headers: { 'x-api-key': 'stolen', Authorization: 'Bearer x' } }, 'sk-ant');
      await keyedFetch('groq', 'https://api.groq.com/openai/v1/models', {}, 'gsk');
    } finally {
      globalThis.fetch = orig;
    }
    expect(calls[0].get('x-api-key')).toBe('sk-ant');
    expect(calls[0].get('authorization')).toBeNull();
    expect(calls[1].get('authorization')).toBe('Bearer gsk');
  });
});

// What the app sends through the vault, per account (real hosts and base URLs)
const USED: Record<string, string[]> = {
  venice: [
    'https://api.venice.ai/api/v1/chat/completions',
    'https://api.venice.ai/api/v1/models?type=text',
    'https://api.venice.ai/api/v1/api_keys/rate_limits',
    ...['styles', 'generate', 'edit', 'upscale', 'background-remove'].map((p) => `https://api.venice.ai/api/v1/image/${p}`),
    ...['quote', 'queue', 'retrieve', 'complete'].map((p) => `https://api.venice.ai/api/v1/video/${p}`)
  ],
  openrouter: [
    'https://openrouter.ai/api/v1/chat/completions',
    'https://openrouter.ai/api/v1/models?output_modalities=all',
    'https://openrouter.ai/api/v1/key',
    'https://openrouter.ai/api/v1/images',
    'https://openrouter.ai/api/v1/videos',
    'https://openrouter.ai/api/v1/videos/job-1',
    'https://openrouter.ai/api/v1/videos/job-1/content?index=0'
  ],
  nanogpt: ['https://api.nano-gpt.com/api/v1/chat/completions', 'https://api.nano-gpt.com/api/check-balance', 'https://api.nano-gpt.com/api/v1/images/generations'],
  deepinfra: ['https://api.deepinfra.com/v1/openai/chat/completions', 'https://api.deepinfra.com/v1/openai/images/generations'],
  cerebras: ['https://api.cerebras.ai/v1/chat/completions', 'https://api.cerebras.ai/v1/models'],
  novita: ['https://api.novita.ai/openai/v1/chat/completions'],
  chutes: ['https://llm.chutes.ai/v1/chat/completions'],
  together: ['https://api.together.ai/v1/chat/completions', 'https://api.together.ai/v1/models', 'https://api.together.ai/v1/images/generations'],
  anthropic: ['https://api.anthropic.com/v1/messages', 'https://api.anthropic.com/v1/models?limit=100'],
  gemini: [
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&pageToken=abc',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/interactions',
    'https://generativelanguage.googleapis.com/v1beta/files/abc123:download?alt=media'
  ],
  deepseek: ['https://api.deepseek.com/chat/completions', 'https://api.deepseek.com/models', 'https://api.deepseek.com/user/balance'],
  openai: ['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/models', 'https://api.openai.com/v1/images/generations', 'https://api.openai.com/v1/images/edits'],
  groq: ['https://api.groq.com/openai/v1/chat/completions', 'https://api.groq.com/openai/v1/models'],
  tavily: ['https://api.tavily.com/search']
};

// Other APIs on the same hosts: key management above all (an app page taken over must not get a new key)
const REFUSED: Record<string, string[]> = {
  openrouter: ['https://openrouter.ai/api/v1/keys', 'https://openrouter.ai/api/v1/keys/abc', 'https://openrouter.ai/api/v1/credits', 'https://openrouter.ai/api/v1/videos//content'],
  openai: ['https://api.openai.com/v1/organization/admin_api_keys', 'https://api.openai.com/v1/organization/projects/p/api_keys', 'https://api.openai.com/v1/files', 'https://api.openai.com/v1/chat/completions/abc'],
  anthropic: ['https://api.anthropic.com/v1/organizations/api_keys', 'https://api.anthropic.com/v1/organizations/users', 'https://api.anthropic.com/v1/files'],
  gemini: [
    'https://generativelanguage.googleapis.com/v1beta/files',
    'https://generativelanguage.googleapis.com/v1beta/cachedContents',
    'https://generativelanguage.googleapis.com/upload/v1beta/files',
    'https://generativelanguage.googleapis.com/v1beta/models/x:batchGenerateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/x%3AbatchGenerateContent:streamGenerateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/a%2F..%2Fx:generateContent'
  ],
  venice: [
    'https://api.venice.ai/api/v1/api_keys',
    'https://api.venice.ai/api/v1/api_keys/generate_web3_key',
    // Tricks that resolve to, or a server may read as, another path
    'https://api.venice.ai/api/v1/image/../api_keys',
    'https://api.venice.ai/api/v1/image/%2e%2e/api_keys',
    'https://api.venice.ai/api/v1/image\\..\\api_keys',
    'https://api.venice.ai/api/v1/image%2Fgenerate',
    'https://api.venice.ai/api/v1/image%5cgenerate',
    'https://api.venice.ai/api/v1//chat/completions',
    'https://api.venice.ai/api/v1/chat/completions/',
    'https://api.venice.ai/api/v1/chat/completions%',
    'https://api.venice.ai/chat/completions'
  ],
  tavily: ['https://api.tavily.com/extract', 'https://api.tavily.com/']
};

describe('key vault: only the API paths the app uses', () => {
  it('lets every request the app makes through, query strings included', () => {
    for (const [providerId, urls] of Object.entries(USED)) for (const url of urls) expect(validateRequest(req({ providerId, url })), `${providerId} ${url}`).toBeNull();
  });
  it('lets each key check through', () => {
    for (const a of Object.values(ACCOUNTS)) if (a.keyCheck) expect(validateRequest(req({ providerId: a.id, url: a.keyCheck.url })), a.id).toBeNull();
  });
  it('refuses other paths on the same host, and paths dressed up as allowed ones', () => {
    for (const [providerId, urls] of Object.entries(REFUSED))
      for (const url of urls) expect(validateRequest(req({ providerId, url })), `${providerId} ${url}`).toBe(t('store.pathMismatch', { name: label(providerId), host: new URL(url).host, path: new URL(url).pathname }));
  });
  it('does not fetch a refused path', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn() as any;
    try {
      await expect(keyedFetch('openrouter', 'https://openrouter.ai/api/v1/keys', { method: 'POST' }, 'sk-or')).rejects.toThrow();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = orig;
    }
  });
});
