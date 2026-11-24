// ツールの型（docs/design.md §9.3）
import type { AuthRef, ToolDefinition, Transport } from '../providers/types';

export type ToolRisk = 'read' | 'write' | 'exec' | 'network';
export type Permission = 'allow' | 'ask' | 'deny';

export interface ToolSource {
  url: string;
  title?: string;
  snippet?: string;
}

export interface ToolResult {
  /** モデルに渡す内容 */
  content: string;
  /** 画面表示用（モデルには渡さない） */
  details?: unknown;
  /** 出典として表示するもの */
  sources?: ToolSource[];
  isError?: boolean;
}

export interface ToolContext {
  signal: AbortSignal;
  transport: Transport;
  /** 外部サービスのキーの指定（キー未設定・ロック中なら undefined＝キーなしで送る） */
  authFor(serviceId: string): AuthRef | undefined;
}

export interface Tool<I = any> {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  risk: ToolRisk;
  /** 承認カードに出す要約（例: 検索語） */
  summarize(input: I): string;
  /** 壊れた引数の修復・検証。問題があれば例外 */
  prepare(raw: unknown): I;
  execute(input: I, ctx: ToolContext): Promise<ToolResult>;
}

export function toDefinition(t: Tool): ToolDefinition {
  return { name: t.name, description: t.description, parameters: t.parameters };
}
