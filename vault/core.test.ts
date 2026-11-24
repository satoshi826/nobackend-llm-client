import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { allowedHosts, handle, validateRequest } from './core';
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

describe('キー金庫: 送信依頼の検証', () => {
  it('許可されたホストは通す', () => {
    expect(allowedHosts('venice')).toEqual(['api.venice.ai']);
    expect(validateRequest(req())).toBeNull();
  });
  it('別のホスト・http・認証情報付き URL・未知のプロバイダー・不正なメソッドは拒否', () => {
    expect(validateRequest(req({ url: 'https://evil.example/steal' }))).not.toBeNull();
    expect(validateRequest(req({ url: 'http://api.venice.ai/api/v1/chat/completions' }))).not.toBeNull();
    expect(validateRequest(req({ url: 'https://user:pass@api.venice.ai/x' }))).not.toBeNull();
    expect(validateRequest(req({ providerId: 'unknown' }))).not.toBeNull();
    expect(validateRequest(req({ method: 'DELETE' }))).not.toBeNull();
    // OpenRouter のキーを Venice のホストに送ることもできない
    expect(validateRequest(req({ providerId: 'openrouter' }))).not.toBeNull();
  });
  it('キーが未登録なら送信せずエラーを返す', async () => {
    const out: FromVault[] = [];
    await handle(req(), (m) => out.push(m));
    expect(out[0]).toMatchObject({ type: 'error', kind: 'auth' });
  });
  it('拒否されたホストへの依頼は fetch せずにエラー', async () => {
    const out: FromVault[] = [];
    await handle(req({ url: 'https://evil.example/' }), (m) => out.push(m));
    expect(out[0]).toMatchObject({ type: 'error', kind: 'host-mismatch' });
  });
});

describe('キー金庫: Web 検索サービス', () => {
  it('Tavily / Jina のキーはそれぞれのホストにだけ付ける', () => {
    expect(allowedHosts('tavily')).toEqual(['api.tavily.com']);
    expect(allowedHosts('jina')).toEqual(['r.jina.ai']);
    expect(validateRequest(req({ providerId: 'tavily', url: 'https://api.tavily.com/search' }))).toBeNull();
    expect(validateRequest(req({ providerId: 'tavily', url: 'https://api.venice.ai/api/v1/chat/completions' }))).not.toBeNull();
    expect(validateRequest(req({ providerId: 'jina', method: 'GET', body: undefined, url: 'https://r.jina.ai/https://example.com/' }))).toBeNull();
  });
});

import { keyedFetch } from './store';
import { vi } from 'vitest';

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
