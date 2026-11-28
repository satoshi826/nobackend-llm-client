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
  /** What happens until the user chooses in settings ('ask' when not given); the settings page shows the same */
  defaultPermission?: Permission;
  /** Always ask the user, whatever the settings or "always allow" say (e.g. saving a skill) */
  alwaysAsk?: boolean;
  /** "Always allow" is chosen only in settings, not with one press on the approval card (e.g. fetch_url) */
  allowOnlyInSettings?: boolean;
  /**
   * The tool asks the user itself, every time, somewhere the app cannot answer for them (e.g. fetch_file, in the
   * fetch page): the app does not ask again, but "deny" in the settings still blocks it
   */
  confirmsItself?: boolean;
  /** Summary shown on the approval card (e.g. the search query) */
  summarize(input: I): string;
  /** Repair and validate broken arguments. Throws if there is a problem */
  prepare(raw: unknown): I;
  execute(input: I, ctx: ToolContext): Promise<ToolResult>;
}

export function toDefinition(t: Tool): ToolDefinition {
  return { name: t.name, description: t.description, parameters: t.parameters };
}
