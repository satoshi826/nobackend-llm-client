// Type definitions for the provider layer
// This layer does not depend on UI or DB.

export type AdapterKind = 'openai-compatible' | 'anthropic' | 'gemini';

export interface ProviderConfig {
  id: string;
  name: string;
  kind: AdapterKind;
  preset: string; // preset ID (registry.ts)
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
  /** Replies can contain generated images (native image output) */
  imageOutput?: boolean;
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
  | { type: 'file'; blobId: string; name: string; mimeType: string; width?: number; height?: number }
  | { type: 'source'; url: string; title?: string; snippet?: string }
  /** A tool the chat provider ran on its own servers (native web search). Shown, never executed by the app */
  | { type: 'server-tool'; id: string; name: string; query?: string; state: 'running' | 'done' | 'error'; resultCount?: number; error?: string }
  /**
   * The provider's own content blocks for one step, exactly as received. Sent back in place of the step's
   * parts while the turn runs (some APIs require it, e.g. Anthropic after pause_turn); removed when the turn ends
   */
  | { type: 'provider-content'; provider: string; content: unknown[] }
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
  /** Part of the input that hit the prompt cache */
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  /** Searches the provider ran (native web search) */
  webSearches?: number;
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
  /** Prompt cache routing key (routes requests of the same conversation to the same cache) */
  cacheKey?: string;
  /** Use the provider's own web search ('auto': the model decides). Only set for models the preset says can (nativeWebSearch) */
  webSearch?: 'auto' | 'on';
  /** Ask for images in the reply (models with capabilities.imageOutput) */
  imageOutput?: boolean;
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
  /** A provider-side tool started or changed (same id updates the same part) */
  | { type: 'server-tool'; id: string; name: string; query?: string; state: 'running' | 'done' | 'error'; resultCount?: number; error?: string }
  /** The step's content blocks as the provider sent them (see the provider-content part) */
  | { type: 'provider-content'; provider: string; content: unknown[] }
  /** A generated image in the reply (base64) */
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'usage'; usage: Usage; costUsd?: number }
  | { type: 'vendor-state'; data: Record<string, unknown> }
  | { type: 'account'; balanceUsd?: number; balanceDiem?: number }
  /** pause: the provider paused a long server-side turn; the runner sends the turn back to continue it */
  | { type: 'done'; reason: 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'pause' }
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
 * Says which key to attach when sending. The key itself never exists in the app.
 * Keys are held by the key vault (a separate page), which attaches them only for allowed hosts.
 */
export interface AuthRef {
  /** Account ID (an LLM provider preset ID, or tavily / jina) */
  keyId: string;
}

/** Network abstraction. Requests with auth are delegated to the key vault; others are sent as is. */
export interface Transport {
  fetch(url: string, init: RequestInit, auth?: AuthRef): Promise<Response>;
}

/** Function that sends with the key attached (only created inside the key vault; used to verify keys) */
export type KeyedFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Provider-specific setting (boolean; shown under Settings > Connections and keys) */
export interface ProviderSetting {
  key: string;
  label: string;
  desc?: string;
  default: boolean;
}

export interface RequestOptionsContext {
  purpose: 'chat' | 'summary';
  /** Provider's built-in web search (only something other than 'off' when features.builtInWebSearch) */
  webSearch: 'off' | 'auto' | 'on';
  /** Values of ProviderSetting */
  settings: Record<string, boolean>;
}

export interface ProviderPreset {
  id: string;
  label: string;
  /** One-liner shown on the provider picker */
  tagline?: string;
  /** Header the key goes in (default: Authorization: Bearer <key>). Used by the key vault */
  keyHeader?: { name: string; prefix?: string };
  /** Usable without a key (e.g. local Ollama) */
  keyOptional?: boolean;
  /** Fetching the model list needs a key (fetched through the vault) */
  modelsNeedKey?: boolean;
  /**
   * Whether earlier reasoning (reasoning_content) may be sent back.
   * always: per the setting / tool-turns: only messages that contain tool calls / never: not sent (API rejects it)
   */
  reasoningResend?: 'always' | 'tool-turns' | 'never';
  /**
   * The provider's own web search (no extra key). supports: whether this model can use it.
   * The request carries ChatRequest.webSearch; requestOptions / transformRequest / the adapter turn it into the provider's shape
   */
  nativeWebSearch?: {
    supports(modelId: string, model?: ModelInfo): boolean;
    /** Where queries go and what it costs (Settings → Web search) */
    note?: string;
  };
  settings?: ProviderSetting[];
  /** Provider-specific request options (passed to transformRequest as req.providerOptions[preset.id]) */
  requestOptions?(ctx: RequestOptionsContext): Record<string, unknown> | undefined;
  /** Response headers the key vault may return to the app (balance etc.) */
  responseHeaders?: string[];
  /** Descriptive text for the UI */
  copy?: {
    /** Description of privacy: 'private' models */
    private?: string;
    /** Description of privacy: 'anonymized' models (relayed to third-party vendors) */
    relayed?: string;
    /** Notice shown when the list contains relayed models */
    relayedNote?: string;
    /** Notice on the model picker */
    pickerNote?: string;
    /** Extra note on this provider in the list of destinations (privacy) */
    destinationNote?: string;
    /** Rows added to the list of destinations */
    extraDestinations?: [string, string][];
  };
  defaults: Omit<ProviderConfig, 'id'>;
  browserAccess: 'direct' | 'needs-header' | 'needs-proxy' | 'unknown';
  modelsPath?: string;
  mapModel?(raw: any, providerId: string): ModelInfo | null;
  transformRequest?(body: Record<string, any>, req: ChatRequest): Record<string, any>;
  parseExtra?(chunk: any, seen: Set<string>): ProviderEvent[];
  /** Read the balance etc. from response headers (headers to return are listed in responseHeaders) */
  readHeaders?(headers: Headers): ProviderEvent[];
  /** Verify a key (called inside the key vault with a fetch that attaches the candidate key) */
  validateKey?(cfg: ProviderConfig, fetchWithKey: KeyedFetch): Promise<{ ok: boolean; error?: ProviderError }>;
  /** Guide on creating a key and configuring it safely */
  keyGuide?: string;
  corsHint?: string;
}

export interface ProviderAdapter {
  /** auth: passed only for providers whose model list needs a key (preset.modelsNeedKey) */
  listModels(cfg: ProviderConfig, preset: ProviderPreset, transport: Transport, auth?: AuthRef): Promise<ModelInfo[]>;
  chat(cfg: ProviderConfig, preset: ProviderPreset, auth: AuthRef | undefined, req: ChatRequest, transport: Transport): AsyncIterable<ProviderEvent>;
}
