// モデル一覧の絞り込み・並び替え（モデル選択画面で使う）
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

/** 入力 + 出力の 100 万トークンあたりの価格。不明なら null */
function priceOf(m: ModelInfo): number | null {
  const i = m.pricing?.inputPerMTok;
  const o = m.pricing?.outputPerMTok;
  return i == null && o == null ? null : (i ?? 0) + (o ?? 0);
}

const privacyRank = (m: ModelInfo) => (m.privacy === 'private' ? 0 : m.privacy === 'anonymized' ? 2 : 1);
const byName = (a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name);
/** 値のないものは常に末尾 */
const nullsLast = (a: number | null | undefined, b: number | null | undefined, dir: 1 | -1) =>
  a == null ? (b == null ? 0 : 1) : b == null ? -1 : (a - b) * dir;

export function compareModels(sort: ModelSort): (a: ModelInfo, b: ModelInfo) => number {
  switch (sort) {
    case 'recommended':
      // private 優先 → 既定モデル → 提供終了予定は後ろ → 名前
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

/** 絞り込み（すべて満たすもの）と並び替え */
export function arrangeModels(list: ModelInfo[], opts: { query: string; filters: ModelFilter[]; sort: ModelSort }): ModelInfo[] {
  return list.filter((m) => matchesQuery(m, opts.query) && opts.filters.every((f) => matchesFilter(m, f))).sort(compareModels(opts.sort));
}
