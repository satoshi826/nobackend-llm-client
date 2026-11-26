// List prices for providers whose model list has none (Anthropic, Gemini, OpenAI, DeepSeek, Groq).
// Copied by hand from the providers' official pricing pages (sources below). Prices change: update the table and
// PRICE_LIST_DATE together. Models not in the table stay without a price ("unknown"), never a guess.
//
// Simplifications (the estimate is a guide, not a bill):
// - Only the base tier: prompts above 200k / 272k tokens (Gemini Pro, OpenAI) and Claude Haiku 5.5 above 100k
//   cost more than shown.
// - DeepSeek: the peak price (off-peak is half), so the estimate errs high.
// - Cache writes (Anthropic 1.25x input) count as normal input.
// - Scheduled changes (`next`) switch on their date.
//
// Sources, fetched 2026-11-26:
//   https://platform.claude.com/docs/en/about-claude/pricing
//   https://aistudio.google.com/docs/pricing
//   https://developers.openai.com/api/docs/pricing
//   https://api-docs.deepseek.com/quick_start/pricing
//   https://console.groq.com/docs/models
import type { ModelInfo } from './types';

export const PRICE_LIST_DATE = '2026-11-26';

/** [model id, input, cached input (or null), output] in USD per 1M tokens; next: a price that starts on a date */
type Row = [id: string, input: number, cached: number | null, output: number, next?: { from: string; input: number; cached: number | null; output: number }];

const TABLE: Record<string, Row[]> = {
  anthropic: [
    ['claude-fable-5-2', 8, 0.2, 40],
    ['claude-mythos-5-2', 8, 0.2, 40],
    ['claude-fable-5-1', 10, 0.25, 50],
    ['claude-mythos-5-1', 10, 0.25, 50],
    ['claude-fable-5', 10, 1, 50],
    ['claude-mythos-5', 10, 1, 50],
    ['claude-opus-5-5', 4, 0.2, 20],
    ['claude-opus-5', 5, 0.5, 25],
    ['claude-opus-4-8', 5, 0.5, 25],
    ['claude-opus-4-7', 5, 0.5, 25],
    ['claude-opus-4-6', 5, 0.5, 25],
    ['claude-opus-4-5', 5, 0.5, 25],
    ['claude-opus-4-1', 15, 1.5, 75],
    ['claude-opus-4', 15, 1.5, 75],
    ['claude-sonnet-5-5', 2, 0.1, 10],
    ['claude-sonnet-5', 2, 0.2, 10],
    ['claude-sonnet-4-6', 3, 0.3, 15],
    ['claude-sonnet-4-5', 3, 0.3, 15],
    ['claude-sonnet-4', 3, 0.3, 15],
    ['claude-haiku-5-5', 0.1, 0.01, 0.5],
    ['claude-haiku-4-5', 1, 0.1, 5]
  ],
  gemini: [
    ['gemini-4-carbon', 2, 0.1, 10, { from: '2026-12-01', input: 4, cached: 0.2, output: 20 }],
    ['gemini-4-argon', 2, 0.1, 10, { from: '2026-12-01', input: 4, cached: 0.2, output: 20 }],
    ['gemini-4-neon', 3, 0.15, 15],
    ['gemini-4-hydrogen', 1.5, 0.075, 7.5],
    ['gemini-3.8-flash', 0.75, 0.075, 3.75, { from: '2027-01-01', input: 1.5, cached: 0.15, output: 7.5 }],
    ['gemini-3.6-flash', 0.75, 0.075, 3.75, { from: '2027-01-01', input: 1.5, cached: 0.15, output: 7.5 }],
    ['gemini-3.5-flash-lite', 0.3, 0.03, 2.5],
    ['gemini-3.1-flash-lite', 0.25, 0.025, 1.5],
    ['gemini-3.1-pro-preview', 2, 0.2, 12],
    ['gemini-3-flash-preview', 0.5, 0.05, 3],
    ['gemini-2.5-pro', 1.25, 0.125, 10],
    ['gemini-2.5-flash', 0.3, 0.03, 2.5],
    ['gemini-2.5-flash-lite', 0.1, 0.01, 0.4],
    // Gemma: free tier only
    ['gemma-4-31b-it', 0, null, 0],
    ['gemma-4-26b-a4b-it', 0, null, 0]
  ],
  openai: [
    ['gpt-6.2-astra', 8, 0.4, 40],
    ['gpt-6.2-sol', 2, 0.1, 10],
    ['gpt-6.1-sol', 2, 0.1, 10],
    ['gpt-6.1-terra', 1, 0.05, 5],
    ['gpt-6-astra', 10, 1, 50],
    ['gpt-6-sol', 2, 0.2, 10],
    ['gpt-6-luna', 0.1, 0.01, 0.5],
    ['gpt-5.6-sol', 4, 0.4, 20],
    ['gpt-5.6-terra', 2, 0.2, 12],
    ['gpt-5.6-luna', 0.2, 0.02, 1.2],
    ['gpt-5.5-pro', 30, null, 180],
    ['gpt-5.5', 5, 0.5, 30],
    ['gpt-5.4-pro', 30, null, 180],
    ['gpt-5.4-mini', 0.75, 0.075, 4.5],
    ['gpt-5.4-nano', 0.2, 0.02, 1.25],
    ['gpt-5.4', 2.5, 0.25, 15],
    ['gpt-5.3-codex', 1.75, 0.175, 14],
    ['gpt-5.2-pro', 21, null, 168],
    ['gpt-5.2', 1.75, 0.175, 14],
    ['gpt-5.1', 1.25, 0.125, 10],
    ['gpt-5-pro', 15, null, 120],
    ['gpt-5-mini', 0.25, 0.025, 2],
    ['gpt-5-nano', 0.05, 0.005, 0.4],
    ['gpt-5', 1.25, 0.125, 10],
    ['gpt-4.1-mini', 0.4, 0.1, 1.6],
    ['gpt-4.1', 2, 0.5, 8],
    ['gpt-4o-mini', 0.15, 0.075, 0.6],
    ['gpt-4o', 2.5, 1.25, 10],
    ['o3-pro', 20, null, 80],
    ['o3', 2, 0.5, 8],
    ['chat-latest', 5, 0.5, 30]
  ],
  deepseek: [
    ['deepseek-flash', 0.3, 0.006, 1.2],
    ['deepseek-v4-flash', 0.3, 0.006, 1.2],
    ['deepseek-v4-pro', 1.32, 0.044, 3.96]
  ],
  groq: [
    ['openai/gpt-oss-120b', 0.15, 0.075, 0.6],
    ['openai/gpt-oss-20b', 0.075, 0.037, 0.3],
    ['openai/gpt-oss-safeguard-20b', 0.075, null, 0.3],
    ['qwen/qwen3.8-27b', 0.8, null, 4]
  ]
};

/** A dated snapshot of a model: claude-haiku-4-5-20251001, gpt-4o-2024-08-06 */
const SNAPSHOT = /^-(\d{8}|\d{4}-\d{2}-\d{2})$/;

/** The list price of a model on a day (YYYY-MM-DD), or undefined when the table does not have it */
export function listPrice(presetId: string, modelId: string, today = new Date().toISOString().slice(0, 10)): ModelInfo['pricing'] | undefined {
  const row = TABLE[presetId]?.find(([id]) => modelId === id || (modelId.startsWith(id) && SNAPSHOT.test(modelId.slice(id.length))));
  if (!row) return undefined;
  const [, input, cached, output, next] = row;
  const p = next && today >= next.from ? next : { input, cached, output };
  return { inputPerMTok: p.input, outputPerMTok: p.output, ...(p.cached != null ? { cachedInputPerMTok: p.cached } : {}), currency: 'USD', listedAt: PRICE_LIST_DATE };
}

/** Fill in list prices for models whose list entry has none */
export function withListPrices(list: ModelInfo[], presetId: string, today?: string): ModelInfo[] {
  if (!TABLE[presetId]) return list;
  return list.map((m) => {
    if (m.pricing && (m.pricing.inputPerMTok != null || m.pricing.outputPerMTok != null) && !m.pricing.listedAt) return m;
    const p = listPrice(presetId, m.id, today);
    return p ? { ...m, pricing: p } : m;
  });
}
