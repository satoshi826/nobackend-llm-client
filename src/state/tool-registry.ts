// Extension point for tools. Features register a provider here instead of being wired into
// generation.ts, so the generation loop does not need to know about images, files, etc.
import type { Conversation, MessageRecord } from '../lib/db/schema';
import type { ModelInfo } from '../lib/providers/types';
import type { Tool } from '../lib/tools/types';

export interface ToolProviderContext {
  conv: Conversation;
  /** The assistant message being generated */
  messageId: string;
  model: ModelInfo | undefined;
  /** Messages sent as history (up to and including the user message) */
  history: MessageRecord[];
}

export interface ToolProvider {
  id: string;
  /** Tools offered for this reply (only called for models that support tool calling) */
  tools(ctx: ToolProviderContext): Tool[];
  /** Text appended to the system prompt for this reply (e.g. which files the model can read) */
  systemNote?(ctx: ToolProviderContext): string | undefined;
}

const providers = new Map<string, ToolProvider>();

export function registerToolProvider(p: ToolProvider) {
  providers.set(p.id, p);
}

export function contributedTools(ctx: ToolProviderContext): Tool[] {
  if (!ctx.model?.capabilities.tools) return [];
  return [...providers.values()].flatMap((p) => p.tools(ctx));
}

export function contributedSystemNotes(ctx: ToolProviderContext): string {
  if (!ctx.model?.capabilities.tools) return '';
  return [...providers.values()]
    .map((p) => p.systemNote?.(ctx))
    .filter(Boolean)
    .join('\n\n');
}
