// Conversation compaction (replaces the older part with a summary).
// - The original history is never deleted. A compaction node is appended to the conversation tree and replaced by the summary only when sending (runner.buildRequestMessages)
// - The most recent exchanges are kept verbatim, not summarized (their details are the most likely to be needed)
// - If there was a previous compaction, re-summarize "previous summary + the conversation since"
import type { MessageRecord } from '../db/schema';
import type { AuthRef, ChatMessage, ProviderConfig, ProviderPreset, Transport, Usage } from '../providers/types';
import { getAdapter } from '../providers/registry';
import { estimateTokens, inputBudget, messageTokens } from './context';
import { buildRequestMessages } from './request';
import { t as tc } from './messages';

/** Number of most recent messages kept without summarizing */
export const KEEP_RECENT = 4;

export interface CompactionPlan {
  /** Previous summary to include in the new one (if any) */
  previousSummary: string | null;
  /** Messages to summarize this time */
  toSummarize: MessageRecord[];
  /** Everything up to (and including) this message is replaced by the summary */
  coversUntilId: string;
}

/** Decide the compaction range from path (root → tail). null if the conversation is not long enough to compact */
export function planCompaction(path: MessageRecord[], keepRecent = KEEP_RECENT): CompactionPlan | null {
  let start = 0;
  let previousSummary: string | null = null;
  for (let i = path.length - 1; i >= 0; i--) {
    const c = path[i].compaction;
    if (c) {
      previousSummary = c.summary;
      const covered = path.findIndex((m) => m.id === c.coversUntilId);
      start = covered + 1;
      break;
    }
  }
  const candidates = path.slice(start).filter((m) => !m.compaction && m.parts.some((p) => p.type === 'text' && p.text.trim()));
  if (candidates.length <= keepRecent) return null;
  let cut = candidates.length - keepRecent;
  // Shift the boundary so the kept part starts with a user message
  while (cut > 0 && candidates[cut].role !== 'user') cut--;
  if (cut <= 0) return null;
  const toSummarize = candidates.slice(0, cut);
  return { previousSummary, toSummarize, coversUntilId: toSummarize[toSummarize.length - 1].id };
}

/** The summarizing instruction (in the UI language) */
export function summaryInstruction(): string {
  return tc('summary.instruction');
}

export function buildTranscript(plan: CompactionPlan, maxTokens?: number | null): string {
  const lines: string[] = [];
  for (const m of plan.toSummarize) {
    const text = m.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text)
      .join('');
    lines.push(`${tc(m.role === 'user' ? 'summary.userLabel' : 'summary.assistantLabel')}\n${text}`);
  }
  let body = lines.join('\n\n');
  // If it may exceed the summarizing model's context length, cut the old end (the previous summary covers it, so older parts are the safest to lose)
  if (maxTokens && estimateTokens(body) > maxTokens) {
    while (lines.length > 1 && estimateTokens(lines.join('\n\n')) > maxTokens) lines.shift();
    body = tc('summary.omitted') + '\n\n' + lines.join('\n\n');
  }
  return (plan.previousSummary ? `${tc('summary.previousHeading')}\n${plan.previousSummary}\n\n${tc('summary.sinceHeading')}\n` : `${tc('summary.conversationHeading')}\n`) + body;
}

export interface SummarizeOptions {
  provider: ProviderConfig;
  preset: ProviderPreset;
  auth: AuthRef | undefined;
  transport: Transport;
  model: string;
  contextLength?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
  signal: AbortSignal;
  /** Tokens and cost spent on summarizing (for usage tracking) */
  onUsage?(usage: Usage, costUsd?: number): void;
}

/** Generate the summary (discard reasoning and collect only the text) */
export async function summarize(plan: CompactionPlan, o: SummarizeOptions): Promise<string> {
  const budget = inputBudget(o.contextLength, 4096);
  const instruction = summaryInstruction();
  const transcript = buildTranscript(plan, budget ? budget - estimateTokens(instruction) - 200 : null);
  const messages: ChatMessage[] = [
    { id: 's', role: 'system', parts: [{ type: 'text', text: instruction }] },
    { id: 'u', role: 'user', parts: [{ type: 'text', text: transcript }] }
  ];
  let out = '';
  for await (const ev of getAdapter(o.provider).chat(
    o.provider,
    o.preset,
    o.auth,
    { model: o.model, messages, params: { maxTokens: 4096, temperature: 0.2 }, providerOptions: o.providerOptions, signal: o.signal },
    o.transport
  )) {
    if (ev.type === 'text-delta') out += ev.delta;
    else if (ev.type === 'usage') o.onUsage?.(ev.usage, ev.costUsd);
    else if (ev.type === 'error') throw new Error(ev.error.message);
  }
  out = out.trim();
  if (!out) throw new Error(tc('summary.empty'));
  return out;
}

/** Estimated input tokens if the current path were sent (taking compaction into account) */
export function estimateRequestTokens(path: MessageRecord[], systemPrompt: string): number {
  return buildRequestMessages(path, systemPrompt).reduce((n, m) => n + messageTokens(m), 0);
}
