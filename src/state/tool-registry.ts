// Extension points for generating a reply. Features register here instead of being wired into
// generation.ts, so the generation loop does not need to know about images, files, web search or skills.
import type { Conversation, MessageRecord } from '../lib/db/schema';
import type { ModelInfo } from '../lib/providers/types';
import type { Tool } from '../lib/tools/types';

export interface ToolProviderContext {
  conv: Conversation;
  /** The assistant message being generated ('' when only estimating the request size) */
  messageId: string;
  model: ModelInfo | undefined;
  /** Messages sent as history (up to and including the user message) */
  history: MessageRecord[];
}

export interface ToolProvider {
  id: string;
  /** Tools offered for this reply (only asked for models that support tool calling) */
  tools?(ctx: ToolProviderContext): Tool[];
  /** Tools that appear during the turn, e.g. after a skill unlocked them (only for tool-calling models) */
  dynamicTools?(ctx: ToolProviderContext, turn: MessageRecord): Tool[];
  /** Text appended to the system prompt for this reply (asked for every model) */
  systemNote?(ctx: ToolProviderContext): string | undefined;
  /** The provider's built-in web search for this reply (asked for every model; the first answer wins) */
  builtinWebSearch?(ctx: ToolProviderContext): 'auto' | 'on' | undefined;
}

const providers = new Map<string, ToolProvider>();

export function registerToolProvider(p: ToolProvider) {
  providers.set(p.id, p);
}

const canCallTools = (ctx: ToolProviderContext) => !!ctx.model?.capabilities.tools;

export function contributedTools(ctx: ToolProviderContext): Tool[] {
  if (!canCallTools(ctx)) return [];
  return [...providers.values()].flatMap((p) => p.tools?.(ctx) ?? []);
}

export function contributedDynamicTools(ctx: ToolProviderContext, turn: MessageRecord): Tool[] {
  if (!canCallTools(ctx)) return [];
  return [...providers.values()].flatMap((p) => p.dynamicTools?.(ctx, turn) ?? []);
}

export function contributedSystemNotes(ctx: ToolProviderContext): string {
  return [...providers.values()]
    .map((p) => p.systemNote?.(ctx))
    .filter(Boolean)
    .join('\n\n');
}

export function contributedBuiltinWebSearch(ctx: ToolProviderContext): 'off' | 'auto' | 'on' {
  for (const p of providers.values()) {
    const v = p.builtinWebSearch?.(ctx);
    if (v) return v;
  }
  return 'off';
}

/** The system prompt for a reply: the conversation's own, then the notes of every provider */
export function systemPromptFor(ctx: ToolProviderContext): string {
  return [ctx.conv.systemPrompt.trim(), contributedSystemNotes(ctx)].filter(Boolean).join('\n\n');
}

/**
 * Requests a feature answers itself instead of the chat model (e.g. image requests).
 * regenerate / edit hand such user messages to the handler.
 */
export interface UserRequestHandler {
  id: string;
  matches(user: MessageRecord): boolean;
  run(convId: string, userMsgId: string): Promise<void>;
  /** Extra fields for an edited copy of the user message */
  edit?(orig: MessageRecord, newText: string): Partial<MessageRecord>;
}

const requestHandlers = new Map<string, UserRequestHandler>();

export function registerUserRequestHandler(h: UserRequestHandler) {
  requestHandlers.set(h.id, h);
}

export function requestHandlerFor(user: MessageRecord | undefined): UserRequestHandler | undefined {
  return user ? [...requestHandlers.values()].find((h) => h.matches(user)) : undefined;
}
