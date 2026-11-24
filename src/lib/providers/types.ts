// Provider 層の型定義（docs/design.md §3.3）
// この層は UI・DB に依存しない。

export type AdapterKind = 'openai-compatible' | 'anthropic' | 'gemini';

export interface ProviderConfig {
  id: string;
  name: string;
  kind: AdapterKind;
  preset: string; // プリセット ID（registry.ts）
  baseUrl: string;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  proxyUrl?: string;
  modelListMode: 'fetch' | 'manual' | 'both';
  enabled: boolean;
}

export interface ModelCapabilities {
  vision?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  reasoningEffort?: string[];
  webSearch?: boolean;
  jsonSchema?: boolean;
}

export interface ModelInfo {
  providerId: string;
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  capabilities: ModelCapabilities;
  pricing?: { inputPerMTok?: number; outputPerMTok?: number; currency: 'USD' };
  privacy?: 'private' | 'anonymized' | 'unknown';
  tags?: string[];
  offline?: boolean;
  deprecated?: { date?: string; replacementId?: string };
  source: 'fetched' | 'manual';
}

export type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied';

export type Part =
  | { type: 'text'; text: string; state?: 'streaming' | 'done' }
  | { type: 'reasoning'; text: string; state?: 'streaming' | 'done' }
  | { type: 'file'; blobId: string; name: string; mimeType: string }
  | { type: 'source'; url: string; title?: string; snippet?: string }
  | {
      type: 'tool';
      toolCallId: string;
      name: string;
      argsText: string;
      input?: unknown;
      state: ToolState;
      approval?: { approved: boolean; reason?: string; auto: boolean };
      modelOutput?: unknown;
      uiDetails?: unknown;
      error?: string;
      startedAt?: number;
      endedAt?: number;
    }
  | { type: 'step-start' }
  | { type: 'error'; message: string; code?: string };

export interface Usage {
  inputTokens?: number;
  /** 入力のうちプロンプトキャッシュに当たった分 */
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: Part[];
  vendorState?: Record<string, unknown>;
  meta?: { providerId?: string; model?: string; usage?: Usage; costUsd?: number; finishReason?: string; truncated?: number };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ChatParams {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  stop?: string[];
  seed?: number;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  params?: ChatParams;
  tools?: ToolDefinition[];
  providerOptions?: Record<string, Record<string, unknown>>;
  /** プロンプトキャッシュの振り分けキー（同じ会話の要求を同じキャッシュに当てる） */
  cacheKey?: string;
  signal: AbortSignal;
}

export type ProviderEvent =
  | { type: 'start'; responseId?: string }
  | { type: 'text-start' | 'reasoning-start'; index: number }
  | { type: 'text-delta' | 'reasoning-delta'; index: number; delta: string }
  | { type: 'text-end' | 'reasoning-end'; index: number }
  | { type: 'tool-call-start'; index: number; toolCallId: string; name: string }
  | { type: 'tool-call-delta'; index: number; argsDelta: string }
  | { type: 'tool-call-end'; index: number; input: unknown; parseError?: string }
  | { type: 'source'; url: string; title?: string; snippet?: string }
  | { type: 'usage'; usage: Usage; costUsd?: number }
  | { type: 'vendor-state'; data: Record<string, unknown> }
  | { type: 'account'; balanceUsd?: number; balanceDiem?: number }
  | { type: 'done'; reason: 'stop' | 'length' | 'tool-calls' | 'content-filter' }
  | { type: 'error'; error: ProviderError };

export type ProviderErrorKind =
  | 'auth'
  | 'insufficient-balance'
  | 'rate-limit'
  | 'model-unavailable'
  | 'bad-request'
  | 'server'
  | 'network-or-cors'
  | 'host-mismatch'
  | 'aborted';

export interface ProviderError {
  kind: ProviderErrorKind;
  status?: number;
  message: string;
  retryAfterMs?: number;
  hint?: string;
}

/**
 * 「どのキーを付けて送るか」の指定。キーそのものは本体アプリに存在しない。
 * キーはキー金庫（別ページ）が保持し、許可されたホスト宛てのときだけ金庫が付けて送る。
 */
export interface AuthRef {
  /** 接続先 ID（LLM プロバイダーのプリセット ID、または tavily / jina） */
  keyId: string;
}

/** 通信の抽象。auth を指定した通信はキー金庫が代行し、指定のない通信はそのまま送る。 */
export interface Transport {
  fetch(url: string, init: RequestInit, auth?: AuthRef): Promise<Response>;
}

/** キーを付けて送る関数（キー金庫の中でだけ作られる。キーの確認に使う） */
export type KeyedFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** 接続先だけの設定（真偽値。設定 > 接続とキー に出す） */
export interface ProviderSetting {
  key: string;
  label: string;
  desc?: string;
  default: boolean;
}

export interface RequestOptionsContext {
  purpose: 'chat' | 'summary';
  /** 接続先の内蔵 Web 検索（features.builtInWebSearch のときだけ 'off' 以外になる） */
  webSearch: 'off' | 'auto' | 'on';
  /** ProviderSetting の値 */
  settings: Record<string, boolean>;
}

export interface ProviderPreset {
  id: string;
  label: string;
  /** 接続先を選ぶ画面に出す一言 */
  tagline?: string;
  features?: {
    /** 接続先自身が Web 検索を持つ（追加のキー不要） */
    builtInWebSearch?: boolean;
  };
  settings?: ProviderSetting[];
  /** 要求に付ける接続先固有のオプション（transformRequest に req.providerOptions[preset.id] として渡る） */
  requestOptions?(ctx: RequestOptionsContext): Record<string, unknown> | undefined;
  /** キー金庫が本体に返してよい応答ヘッダ（残高など） */
  responseHeaders?: string[];
  /** 画面の説明文 */
  copy?: {
    /** privacy: 'private' のモデルの説明 */
    private?: string;
    /** privacy: 'anonymized'（外部事業者へ中継）のモデルの説明 */
    relayed?: string;
    /** 一覧に中継モデルがあるときの注意書き */
    relayedNote?: string;
    /** モデル選択画面の注意書き */
    pickerNote?: string;
    /** 通信先の一覧（プライバシー）での、この接続先の補足 */
    destinationNote?: string;
    /** 通信先の一覧に足す行 */
    extraDestinations?: [string, string][];
  };
  defaults: Omit<ProviderConfig, 'id'>;
  browserAccess: 'direct' | 'needs-header' | 'needs-proxy' | 'unknown';
  modelsPath?: string;
  mapModel?(raw: any, providerId: string): ModelInfo | null;
  transformRequest?(body: Record<string, any>, req: ChatRequest): Record<string, any>;
  parseExtra?(chunk: any, seen: Set<string>): ProviderEvent[];
  /** 応答ヘッダから残高などを読む（返してもらうヘッダは responseHeaders に書く） */
  readHeaders?(headers: Headers): ProviderEvent[];
  /** キーの確認（キー金庫の中で、候補のキーを付ける fetch を渡して呼ぶ） */
  validateKey?(cfg: ProviderConfig, fetchWithKey: KeyedFetch): Promise<{ ok: boolean; error?: ProviderError }>;
  /** キーの作り方・安全な設定の案内 */
  keyGuide?: string;
  corsHint?: string;
}

export interface ProviderAdapter {
  listModels(cfg: ProviderConfig, preset: ProviderPreset, transport: Transport): Promise<ModelInfo[]>;
  chat(cfg: ProviderConfig, preset: ProviderPreset, auth: AuthRef | undefined, req: ChatRequest, transport: Transport): AsyncIterable<ProviderEvent>;
}
