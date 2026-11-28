// Reply suggestions: after an answer, generate a few short replies the user is likely to send next.
// Sends only the latest exchange (question and answer), not the whole conversation, as a separate small request (keeps the answer itself clean).
import type { AuthRef, ChatMessage, ProviderConfig, ProviderPreset, Transport, Usage } from '../providers/types';
import type { MessageRecord } from '../db/schema';
import { getAdapter } from '../providers/registry';
import { getLang, LANG_ENGLISH_NAMES } from '../i18n';

/** Max characters sent per message (long answers keep their tail) */
const MAX_CHARS = 3000;
export const SUGGESTION_MAX_LEN = 200;

function textOf(m: MessageRecord): string {
  return m.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join('')
    .trim();
}

function clip(s: string): string {
  return s.length > MAX_CHARS ? '…' + s.slice(-MAX_CHARS) : s;
}

/**
 * Renders the last `turns` exchanges (user message and assistant answer) as text.
 * path runs from the start of the conversation to the answer (last element). Compaction nodes and messages without text are skipped.
 */
export function recentExchanges(path: MessageRecord[], turns: number): string {
  const msgs = path.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.compaction && textOf(m));
  const out: string[] = [];
  let users = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    out.unshift(`${m.role === 'user' ? 'User' : 'Assistant'}: ${clip(textOf(m))}`);
    if (m.role === 'user' && ++users >= turns) break;
  }
  return out.join('\n\n');
}

/**
 * The instruction, in English like every prompt (the request is the same in every UI language). Suggestions are messages
 * the user sends, so they are in the language the user writes in; the UI language only when that is unclear
 */
export function suggestionInstruction(count: number): string {
  return [
    'You suggest replies that the user is likely to send next in a chat.',
    `Given the end of the conversation, write ${count} messages the user is likely to send next.`,
    '- Write as the user, to the assistant (not as the assistant).',
    '- Keep each to one short sentence, and make them go in different directions.',
    `- Write in the language the user writes in (if unclear, in ${LANG_ENGLISH_NAMES[getLang()]}).`,
    '- Output only a JSON array of strings (e.g. ["…", "…"]), with no explanation or preamble.'
  ].join('\n');
}

export function suggestionMessages(path: MessageRecord[], turns: number, count: number): ChatMessage[] {
  return [
    { id: 'sys', role: 'system', parts: [{ type: 'text', text: suggestionInstruction(count) }] },
    { id: 'u', role: 'user', parts: [{ type: 'text', text: `Conversation:\n\n${recentExchanges(path, turns)}` }] }
  ];
}

/** Extract suggestions from the model output (prefer a JSON array, otherwise fall back to list lines) */
export function parseSuggestions(text: string, count: number): string[] {
  let list: unknown[] = [];
  const a = text.indexOf('[');
  const b = text.lastIndexOf(']');
  if (a >= 0 && b > a) {
    try {
      const v = JSON.parse(text.slice(a, b + 1));
      if (Array.isArray(v)) list = v;
    } catch {
      /* read it as a list instead */
    }
  }
  if (!list.length) {
    list = text
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-*・•]|\d+[.)．、])\s*/, '').replace(/^["“「『]|["”」』],?$/g, '').trim())
      .filter((l) => l && !l.startsWith('```'));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const s = v.replace(/\s+/g, ' ').trim().slice(0, SUGGESTION_MAX_LEN);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= count) break;
  }
  return out;
}

export interface SuggestOptions {
  provider: ProviderConfig;
  preset: ProviderPreset;
  auth: AuthRef | undefined;
  transport: Transport;
  model: string;
  providerOptions?: Record<string, Record<string, unknown>>;
  signal: AbortSignal;
  onUsage?(usage: Usage, costUsd?: number): void;
}

export async function generateSuggestions(path: MessageRecord[], turns: number, count: number, o: SuggestOptions): Promise<string[]> {
  let out = '';
  for await (const ev of getAdapter(o.provider).chat(
    o.provider,
    o.preset,
    o.auth,
    { model: o.model, messages: suggestionMessages(path, turns, count), params: { maxTokens: 600, temperature: 0.8 }, providerOptions: o.providerOptions, signal: o.signal },
    o.transport
  )) {
    if (ev.type === 'text-delta') out += ev.delta;
    else if (ev.type === 'usage') o.onUsage?.(ev.usage, ev.costUsd);
    else if (ev.type === 'error') throw new Error(ev.error.message);
  }
  return parseSuggestions(out, count);
}
