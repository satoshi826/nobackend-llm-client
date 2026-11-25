// Tool types (docs/design.md §9.3)
import type { AuthRef, ToolDefinition, Transport } from '../providers/types';

export type ToolRisk = 'read' | 'write' | 'exec' | 'network';
export type Permission = 'allow' | 'ask' | 'deny';

export interface ToolSource {
  url: string;
  title?: string;
  snippet?: string;
}

export interface ToolResult {
  /** Content passed to the model */
  content: string;
  /** For display only (not passed to the model) */
  details?: unknown;
  /** Items shown as sources */
  sources?: ToolSource[];
  isError?: boolean;
}

export interface ToolContext {
  signal: AbortSignal;
  transport: Transport;
  /** Key reference for the external service (undefined when no key is set or it is locked, i.e. send without a key) */
  authFor(serviceId: string): AuthRef | undefined;
}

export interface Tool<I = any> {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  risk: ToolRisk;
  /** Summary shown on the approval card (e.g. the search query) */
  summarize(input: I): string;
  /** Repair and validate broken arguments. Throws if there is a problem */
  prepare(raw: unknown): I;
  execute(input: I, ctx: ToolContext): Promise<ToolResult>;
}

export function toDefinition(t: Tool): ToolDefinition {
  return { name: t.name, description: t.description, parameters: t.parameters };
}
