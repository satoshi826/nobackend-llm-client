import { describe, expect, it } from 'vitest';
import type { ModelInfo } from './providers/types';
import { arrangeModels, matchesFilter } from './model-list';

const m = (id: string, o: Partial<ModelInfo> = {}): ModelInfo =>
  ({ id, name: id, providerId: 'venice', capabilities: {}, ...o }) as ModelInfo;

const list = [
  m('zeta', { privacy: 'anonymized', contextLength: 1_000_000, pricing: { inputPerMTok: 3, outputPerMTok: 15, currency: 'USD' } }),
  m('alpha', { privacy: 'private', contextLength: 32_000, pricing: { inputPerMTok: 0.5, outputPerMTok: 1, currency: 'USD' }, capabilities: { reasoning: true } as any }),
  m('beta', { privacy: 'private', tags: ['default'], contextLength: 128_000, capabilities: { vision: true } as any }),
  m('gamma', { privacy: 'unknown', pricing: { inputPerMTok: 0, outputPerMTok: 0, currency: 'USD' } })
];
const ids = (xs: ModelInfo[]) => xs.map((x) => x.id);

describe('model list', () => {
  it('recommended: private first, default first, anonymized last', () => {
    expect(ids(arrangeModels(list, { query: '', filters: [], sort: 'recommended' }))).toEqual(['beta', 'alpha', 'gamma', 'zeta']);
  });
  it('price ascending with unknown prices last', () => {
    expect(ids(arrangeModels(list, { query: '', filters: [], sort: 'price' }))).toEqual(['gamma', 'alpha', 'zeta', 'beta']);
  });
  it('context descending with unknown last', () => {
    expect(ids(arrangeModels(list, { query: '', filters: [], sort: 'context' }))).toEqual(['zeta', 'beta', 'alpha', 'gamma']);
  });
  it('filters combine with AND and with the query', () => {
    expect(ids(arrangeModels(list, { query: '', filters: ['private'], sort: 'name' }))).toEqual(['alpha', 'beta']);
    expect(ids(arrangeModels(list, { query: '', filters: ['private', 'reasoning'], sort: 'name' }))).toEqual(['alpha']);
    expect(ids(arrangeModels(list, { query: 'BET', filters: ['private'], sort: 'name' }))).toEqual(['beta']);
  });
  it('free matches zero-priced models', () => {
    expect(list.filter((x) => matchesFilter(x, 'free')).map((x) => x.id)).toEqual(['gamma']);
  });
});
