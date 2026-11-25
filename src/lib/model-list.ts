// Filtering and sorting the model list (used by the model picker)
import type { ModelInfo } from './providers/types';

export type ModelSort = 'recommended' | 'name' | 'price' | 'context';
export type ModelFilter = 'private' | 'reasoning' | 'vision' | 'webSearch' | 'free';

export const SORT_LABELS: Record<ModelSort, string> = {
  recommended: 'おすすめ順',
  name: '名前順',
  price: '安い順',
  context: '文脈が長い順'
};

export const FILTER_LABELS: Record<ModelFilter, string> = {
  private: 'private',
  reasoning: '思考',
  vision: '画像',
  webSearch: '検索',
  free: '無料'
};

export const FILTER_ORDER: ModelFilter[] = ['private', 'reasoning', 'vision', 'webSearch', 'free'];

export function matchesFilter(m: ModelInfo, f: ModelFilter): boolean {
  switch (f) {
    case 'private':
      return m.privacy === 'private';
    case 'reasoning':
      return !!m.capabilities.reasoning;
    case 'vision':
      return !!m.capabilities.vision;
    case 'webSearch':
      return !!m.capabilities.webSearch;
    case 'free':
      return !!m.tags?.includes('free') || (m.pricing?.inputPerMTok === 0 && m.pricing?.outputPerMTok === 0);
  }
}

export function matchesQuery(m: ModelInfo, q: string): boolean {
  const ql = q.trim().toLowerCase();
  return !ql || m.name.toLowerCase().includes(ql) || m.id.toLowerCase().includes(ql);
}

/** Input + output price per million tokens. null if unknown */
function priceOf(m: ModelInfo): number | null {
  const i = m.pricing?.inputPerMTok;
  const o = m.pricing?.outputPerMTok;
  return i == null && o == null ? null : (i ?? 0) + (o ?? 0);
}

const privacyRank = (m: ModelInfo) => (m.privacy === 'private' ? 0 : m.privacy === 'anonymized' ? 2 : 1);
const byName = (a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name);
/** Missing values always go last */
const nullsLast = (a: number | null | undefined, b: number | null | undefined, dir: 1 | -1) =>
  a == null ? (b == null ? 0 : 1) : b == null ? -1 : (a - b) * dir;

export function compareModels(sort: ModelSort): (a: ModelInfo, b: ModelInfo) => number {
  switch (sort) {
    case 'recommended':
      // private first → default model → models scheduled for retirement last → name
      return (a, b) =>
        privacyRank(a) - privacyRank(b) ||
        Number(!a.tags?.includes('default')) - Number(!b.tags?.includes('default')) ||
        Number(!!a.deprecated) - Number(!!b.deprecated) ||
        byName(a, b);
    case 'name':
      return byName;
    case 'price':
      return (a, b) => nullsLast(priceOf(a), priceOf(b), 1) || byName(a, b);
    case 'context':
      return (a, b) => nullsLast(a.contextLength, b.contextLength, -1) || byName(a, b);
  }
}

/** Filter (must match all) and sort */
export function arrangeModels(list: ModelInfo[], opts: { query: string; filters: ModelFilter[]; sort: ModelSort }): ModelInfo[] {
  return list.filter((m) => matchesQuery(m, opts.query) && opts.filters.every((f) => matchesFilter(m, f))).sort(compareModels(opts.sort));
}
