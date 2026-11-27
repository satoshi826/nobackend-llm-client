// Options for one chat, chosen before it starts or along the way (header → ツール・出力): which tools the model is
// offered, how long an answer may be, how much the model thinks, and whether its earlier reasoning is sent back.
// A tool left out costs no tokens: neither it nor the notes that go with it are sent. Kept in memory only, never
// saved: a new chat, or the page loaded again, starts from the defaults.
import { signal } from '@preact/signals';

export interface ChatOptions {
  /** What is turned off: whole groups by their tool provider's id, single tools by name */
  off: ReadonlySet<string>;
  /** The most an answer may be, in tokens (null: the model's own limit) */
  maxTokens: number | null;
  /** How much the model thinks, from its own list (null: its default) */
  reasoningEffort: string | null;
  /** Send the model's earlier reasoning back with the history (null: as in Settings → チャット) */
  resendReasoning: boolean | null;
}

export const DEFAULT_CHAT_OPTIONS: ChatOptions = { off: new Set(), maxTokens: null, reasoningEffort: null, resendReasoning: null };

const byChat = signal<ReadonlyMap<string, ChatOptions>>(new Map());

export const chatOptionsOf = (conversationId: string): ChatOptions => byChat.value.get(conversationId) ?? DEFAULT_CHAT_OPTIONS;

/** Whether a tool is offered in this chat (neither it nor its group is turned off) */
export const toolOn = (o: ChatOptions, group: string, tool: string) => !o.off.has(group) && !o.off.has(tool);

export function setChatOptions(conversationId: string, patch: Partial<ChatOptions>) {
  const next = new Map(byChat.value);
  next.set(conversationId, { ...chatOptionsOf(conversationId), ...patch });
  byChat.value = next;
}

/** The new chat's options go with it when it is saved (it gets its id then), so the next new chat starts from the defaults */
export function moveChatOptions(from: string, to: string) {
  const o = byChat.value.get(from);
  if (!o) return;
  const next = new Map(byChat.value);
  next.delete(from);
  next.set(to, o);
  byChat.value = next;
}
