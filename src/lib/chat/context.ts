// Context length management: when a conversation grows past the model's limit, drop the oldest messages before sending.
// Token counts are rough estimates (about 4 chars per token for ASCII, about 1 char per token for Japanese etc.).
import type { ChatMessage } from '../providers/types';

export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 4 + other);
}

export function messageTokens(m: ChatMessage): number {
  let n = 4; // overhead for the role etc.
  for (const p of m.parts) {
    if (p.type === 'text') n += estimateTokens(p.text);
    else if (p.type === 'tool') n += estimateTokens(p.argsText) + estimateTokens(typeof p.modelOutput === 'string' ? p.modelOutput : JSON.stringify(p.modelOutput ?? ''));
  }
  return n;
}

/** Rough token budget for the input (reserves room for the output and keeps a 10% margin for estimation error) */
export function inputBudget(contextLength?: number, maxOutputTokens?: number): number | null {
  if (!contextLength || contextLength <= 0) return null;
  const reserve = Math.min(maxOutputTokens ?? 8192, Math.floor(contextLength * 0.3));
  return Math.floor((contextLength - reserve) * 0.9);
}

/**
 * Always keeps system and the last message, and drops the oldest first.
 * Adjusts so that the first message after dropping (excluding system) is not an assistant message.
 */
export function fitToContext(messages: ChatMessage[], budget: number | null): { messages: ChatMessage[]; dropped: number } {
  if (budget === null) return { messages, dropped: 0 };
  const sys = messages[0]?.role === 'system' ? [messages[0]] : [];
  let rest = messages.slice(sys.length);
  const total = () => [...sys, ...rest].reduce((n, m) => n + messageTokens(m), 0);
  let dropped = 0;
  while (rest.length > 1 && total() > budget) {
    rest = rest.slice(1);
    dropped++;
    while (rest.length > 1 && rest[0].role !== 'user') {
      rest = rest.slice(1);
      dropped++;
    }
  }
  return { messages: [...sys, ...rest], dropped };
}
