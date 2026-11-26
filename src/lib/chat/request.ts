// Builds the messages to send (history, compaction, tool calls within the same turn)
import type { ChatMessage, Part } from '../providers/types';
import type { MessageRecord } from '../db/schema';

/**
 * A feature's change to what is sent for one stored message (e.g. images become a short note,
 * attached files and skills are put before the text). Transforms run in registration order.
 */
export type MessageTransform = (m: MessageRecord, parts: Part[]) => Part[];
const transforms: MessageTransform[] = [];

export function registerMessageTransform(t: MessageTransform) {
  if (!transforms.includes(t)) transforms.push(t);
}

/** Join the text parts of a message into one text part (helper for transforms that prepend content) */
export function joinedText(parts: Part[]): string {
  return parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

export interface BuildOptions {
  /** Send earlier reasoning (reasoning_content etc.) back to the model. Only for messages from the same provider and model */
  resendReasoning?: boolean;
  providerId?: string;
  model?: string;
}

/**
 * History → messages sent to the provider.
 * - reasoning text (reasoning parts) is never sent
 * - vendorState (reasoning_content etc.) is sent back only when resendReasoning is on and the message is from the same model
 * - if there are compaction nodes, the range summarized by the last one is replaced by the summary
 *   (the summary is appended to the system prompt, since some APIs dislike multiple system messages)
 */
export function buildRequestMessages(history: MessageRecord[], systemPrompt: string, opts: BuildOptions = {}): ChatMessage[] {
  let sys = systemPrompt.trim();
  const { summary, rest } = afterCompaction(history);
  if (summary !== null) {
    const summaryBlock = `## Summary of the conversation so far\nThe earlier part of this conversation was summarized as follows. Treat it as context for the rest of the conversation.\n\n${summary}`;
    sys = sys ? `${sys}\n\n${summaryBlock}` : summaryBlock;
  }
  const out: ChatMessage[] = [];
  if (sys) out.push({ id: 'system', role: 'system', parts: [{ type: 'text', text: sys }] });
  for (const m of rest) {
    const sent = requestMessage(m, opts);
    if (sent) out.push(sent);
  }
  return out;
}

/** The summary in effect (the last compaction's) and the messages after the range it covers */
export function afterCompaction(history: MessageRecord[]): { summary: string | null; rest: MessageRecord[] } {
  for (let i = history.length - 1; i >= 0; i--) {
    const c = history[i].compaction;
    if (c) return { summary: c.summary, rest: history.slice(history.findIndex((m) => m.id === c.coversUntilId) + 1) };
  }
  return { summary: null, rest: history };
}

/** What is sent for one stored message (null when nothing is: compaction nodes, failed answers without text) */
export function requestMessage(m: MessageRecord, opts: BuildOptions = {}): ChatMessage | null {
  if (m.compaction) return null;
  if (m.role === 'assistant' && m.status === 'error' && !m.parts.some((p) => p.type === 'text' && p.text)) return null;
  let parts: Part[] = m.parts.filter((p) => p.type === 'text' || p.type === 'tool');
  for (const t of transforms) parts = t(m, parts);
  if (parts.length === 0) return null;
  const sameModel = !!opts.model && m.meta?.providerId === opts.providerId && m.meta?.model === opts.model;
  return { id: m.id, role: m.role, parts, vendorState: opts.resendReasoning && sameModel ? m.vendorState : undefined };
}

/**
 * Converts the steps of this turn (separated by step-start) into assistant messages and tool results for sending.
 * Reasoning within the same turn is sent back as vendorState, since some models need it to continue after a tool call.
 */
export function turnMessages(msg: MessageRecord): ChatMessage[] {
  const out: ChatMessage[] = [];
  let seg: Part[] = [];
  const flush = () => {
    if (seg.some((p) => p.type === 'tool' || p.type === 'provider-content')) {
      const raw = seg.find((p): p is Extract<Part, { type: 'provider-content' }> => p.type === 'provider-content');
      const reasoning = seg
        .filter((p) => p.type === 'reasoning')
        .map((p) => (p as { text: string }).text)
        .join('');
      out.push({
        id: `${msg.id}-s${out.length}`,
        role: 'assistant',
        parts: seg.filter((p) => p.type === 'text' || p.type === 'tool'),
        vendorState: reasoning || raw ? { ...(reasoning ? { reasoning_content: reasoning } : {}), ...(raw ? { providerContent: raw } : {}) } : undefined
      });
    }
    seg = [];
  };
  for (const p of msg.parts) {
    if (p.type === 'step-start') flush();
    else seg.push(p);
  }
  flush();
  return out;
}
