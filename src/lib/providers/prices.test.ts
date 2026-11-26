import { describe, expect, it } from 'vitest';
import { listPrice, PRICE_LIST_DATE, withListPrices } from './prices';
import { estimateCost } from '../usage';
import type { ModelInfo } from './types';

const m = (id: string, pricing?: ModelInfo['pricing']): ModelInfo => ({ providerId: 'p', id, name: id, capabilities: {}, source: 'fetched', pricing });

describe('list prices', () => {
  it('matches exact ids and dated snapshots, never a longer model name', () => {
    expect(listPrice('anthropic', 'claude-haiku-4-5-20251001')?.inputPerMTok).toBe(1);
    expect(listPrice('openai', 'gpt-4o-2024-08-06')?.inputPerMTok).toBe(2.5);
    expect(listPrice('openai', 'gpt-5-mini')?.inputPerMTok).toBe(0.25);
    expect(listPrice('openai', 'gpt-5')?.inputPerMTok).toBe(1.25);
    expect(listPrice('openai', 'gpt-5-turbo-preview')).toBeUndefined();
    expect(listPrice('anthropic', 'claude-opus-4-5-20251101')?.outputPerMTok).toBe(25);
    expect(listPrice('venice', 'anything')).toBeUndefined();
  });

  it('switches to a scheduled price on its date', () => {
    expect(listPrice('gemini', 'gemini-4-carbon', '2026-11-30')?.inputPerMTok).toBe(2);
    expect(listPrice('gemini', 'gemini-4-carbon', '2026-12-01')?.inputPerMTok).toBe(4);
  });

  it('carries the cache price and the list date', () => {
    expect(listPrice('anthropic', 'claude-sonnet-5-5')).toEqual({ inputPerMTok: 2, outputPerMTok: 10, cachedInputPerMTok: 0.1, currency: 'USD', listedAt: PRICE_LIST_DATE });
  });

  it('keeps prices the API gave and fills in only missing ones', () => {
    const api = { inputPerMTok: 9, outputPerMTok: 9, currency: 'USD' as const };
    const [a, b, c] = withListPrices([m('gpt-5', api), m('gpt-5-nano'), m('unknown-model')], 'openai');
    expect(a.pricing).toBe(api);
    expect(b.pricing?.inputPerMTok).toBe(0.05);
    expect(c.pricing).toBeUndefined();
  });
});

describe('estimateCost', () => {
  it('charges cached input at the cache price when the model has one', () => {
    const p = { inputPerMTok: 2, cachedInputPerMTok: 0.1, outputPerMTok: 10, currency: 'USD' as const };
    // 1M input of which 600k cached, 100k output: 400k*2 + 600k*0.1 + 100k*10 = 0.8 + 0.06 + 1
    expect(estimateCost({ inputTokens: 1_000_000, cachedInputTokens: 600_000, outputTokens: 100_000 }, p)).toBeCloseTo(1.86);
  });
  it('charges cached input at the full price when there is no cache price', () => {
    const p = { inputPerMTok: 2, outputPerMTok: 10, currency: 'USD' as const };
    expect(estimateCost({ inputTokens: 1_000_000, cachedInputTokens: 600_000, outputTokens: 0 }, p)).toBeCloseTo(2);
  });
});
