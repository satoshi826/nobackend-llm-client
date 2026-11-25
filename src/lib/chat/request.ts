// Builds the messages to send (history, compaction, tool calls within the same turn)
import type { ChatMessage, Part } from '../providers/types';
import type { MessageRecord } from '../db/schema';
import { withAttachedSkills } from '../skills/skill';

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
  let rest = history;
  let lastCompaction = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].compaction) {
      lastCompaction = i;
      break;
    }
  }
  if (lastCompaction >= 0) {
    const c = history[lastCompaction].compaction!;
    const coveredIdx = history.findIndex((m) => m.id === c.coversUntilId);
    const summaryBlock = `## これまでの会話の要約\n以下は、この会話の前半を要約したものです。続きの会話の文脈として扱ってください。\n\n${c.summary}`;
    sys = sys ? `${sys}\n\n${summaryBlock}` : summaryBlock;
    rest = history.slice(coveredIdx + 1);
  }
  const out: ChatMessage[] = [];
  if (sys) out.push({ id: 'system', role: 'system', parts: [{ type: 'text', text: sys }] });
  for (const m of rest) {
    if (m.compaction) continue;
    if (m.role === 'assistant' && m.status === 'error' && !m.parts.some((p) => p.type === 'text' && p.text)) continue;
    let parts = m.parts.filter((p) => p.type === 'text' || p.type === 'tool');
    // Skills the user picked are prepended to that message's text
    if (m.role === 'user' && m.skills?.length) {
      const text = parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
      parts = [{ type: 'text', text: withAttachedSkills(text, m.skills) }];
    }
    if (parts.length === 0) continue;
    const sameModel = !!opts.model && m.meta?.providerId === opts.providerId && m.meta?.model === opts.model;
    out.push({ id: m.id, role: m.role, parts, vendorState: opts.resendReasoning && sameModel ? m.vendorState : undefined });
  }
  return out;
}

/**
 * Converts the steps of this turn (separated by step-start) into assistant messages and tool results for sending.
 * Reasoning within the same turn is sent back as vendorState, since some models need it to continue after a tool call.
 */
export function turnMessages(msg: MessageRecord): ChatMessage[] {
  const out: ChatMessage[] = [];
  let seg: Part[] = [];
  const flush = () => {
    if (seg.some((p) => p.type === 'tool')) {
      const reasoning = seg
        .filter((p) => p.type === 'reasoning')
        .map((p) => (p as { text: string }).text)
        .join('');
      out.push({
        id: `${msg.id}-s${out.length}`,
        role: 'assistant',
        parts: seg.filter((p) => p.type === 'text' || p.type === 'tool'),
        vendorState: reasoning ? { reasoning_content: reasoning } : undefined
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
