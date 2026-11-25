// Built-in providers other than Venice / OpenRouter, and OpenAI-compatible providers added at build time.
// All of them need a key to fetch the model list, so it is fetched through the key vault (modelsNeedKey).
import type { ModelInfo, ProviderPreset } from '../types';
import { checkKey, joinUrl } from '../openai-compatible';
import { builtinBaseUrl, parseCustomProviders, type CustomProviderDef } from '../endpoints';

const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;

function model(providerId: string, id: string, name: string, extra: Partial<ModelInfo> = {}): ModelInfo {
  return { providerId, id, name, capabilities: {}, privacy: 'unknown', source: 'fetched', ...extra };
}

// ---- Anthropic (native Messages API) ----
export const anthropicPreset: ProviderPreset = {
  id: 'anthropic',
  label: 'Anthropic',
  tagline: 'Anthropic の Claude を直接使う。',
  keyHeader: { name: 'x-api-key' },
  modelsNeedKey: true,
  keyGuide:
    'Anthropic Console（console.anthropic.com）の API Keys でキーを作り、Limits でワークスペースの利用上限（spend limit）を設定してください。キーが万一漏れても被害額が上限で止まります。',
  corsHint: 'ネットワーク接続、または拡張機能が api.anthropic.com をブロックしていないか確認してください。',
  defaults: {
    name: 'Anthropic',
    kind: 'anthropic',
    preset: 'anthropic',
    baseUrl: builtinBaseUrl('anthropic', env),
    extraHeaders: { 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    modelListMode: 'fetch',
    enabled: false
  },
  browserAccess: 'needs-header',
  modelsPath: 'models?limit=100',
  mapModel(raw, providerId) {
    if (!raw?.id) return null;
    return model(providerId, String(raw.id), String(raw.display_name ?? raw.id), {
      contextLength: typeof raw.max_input_tokens === 'number' ? raw.max_input_tokens : undefined,
      maxOutputTokens: typeof raw.max_tokens === 'number' ? raw.max_tokens : undefined,
      capabilities: { tools: true, vision: true }
    });
  },
  validateKey: (cfg, f) => checkKey(joinUrl(cfg.baseUrl, 'models?limit=1'), f, anthropicPreset.corsHint, cfg.extraHeaders as Record<string, string>)
};

// ---- Google Gemini (OpenAI-compatible endpoint) ----
const GEMINI_SKIP = /embedding|tts|image|imagen|veo|live|native-audio|aqa|learnlm/;
export const geminiPreset: ProviderPreset = {
  id: 'gemini',
  label: 'Google Gemini',
  tagline: 'Google の Gemini。無料枠では、送った内容が Google のサービス改善に使われることがあります。',
  modelsNeedKey: true,
  reasoningResend: 'never',
  keyGuide:
    'Google AI Studio（aistudio.google.com）でキーを作ってください。無料枠のキーでは、送った内容が Google のサービス改善に使われ、人が読むこともあります（有料枠では使われません）。有料にする場合は Google Cloud の請求設定で予算を設定してください。',
  corsHint: 'ネットワーク接続、または拡張機能が generativelanguage.googleapis.com をブロックしていないか確認してください。',
  copy: { destinationNote: '無料枠のキーでは、送った内容が Google のサービス改善に使われることがあります' },
  defaults: { name: 'Gemini', kind: 'openai-compatible', preset: 'gemini', baseUrl: builtinBaseUrl('gemini', env), modelListMode: 'fetch', enabled: false },
  browserAccess: 'direct',
  modelsPath: 'models',
  mapModel(raw, providerId) {
    const id = String(raw?.id ?? '').replace(/^models\//, '');
    if (!id || !/gemini|gemma/.test(id) || GEMINI_SKIP.test(id)) return null;
    return model(providerId, id, String(raw.display_name ?? id), { capabilities: { tools: !id.startsWith('gemma'), vision: true, reasoning: /2\.5|thinking|[3-9]\./.test(id) } });
  },
  validateKey: (cfg, f) => checkKey(joinUrl(cfg.baseUrl, 'models'), f, geminiPreset.corsHint)
};

// ---- DeepSeek ----
export const deepseekPreset: ProviderPreset = {
  id: 'deepseek',
  label: 'DeepSeek',
  tagline: 'DeepSeek のモデル。安価。データは中国の事業者のサーバーで処理されます。',
  modelsNeedKey: true,
  // Sending reasoning back on a different message is rejected, so send it back only in the middle of tool calls
  reasoningResend: 'tool-turns',
  keyGuide: 'DeepSeek Platform（platform.deepseek.com）でキーを作ってください。プリペイド式なので、チャージした額が使える上限になります。',
  corsHint: 'ネットワーク接続、または拡張機能が api.deepseek.com をブロックしていないか確認してください。',
  copy: { destinationNote: '中国の事業者（DeepSeek）のサーバーで処理されます' },
  defaults: { name: 'DeepSeek', kind: 'openai-compatible', preset: 'deepseek', baseUrl: builtinBaseUrl('deepseek', env), modelListMode: 'fetch', enabled: false },
  browserAccess: 'direct',
  modelsPath: 'models',
  mapModel(raw, providerId) {
    if (!raw?.id) return null;
    const id = String(raw.id);
    return model(providerId, id, id, { capabilities: { tools: true, reasoning: id.includes('reasoner') }, tags: id === 'deepseek-chat' ? ['default'] : [] });
  },
  validateKey: (cfg, f) => checkKey(joinUrl(cfg.baseUrl, 'models'), f, deepseekPreset.corsHint)
};

// ---- Groq ----
const GROQ_SKIP = /whisper|tts|guard|playai|orpheus|distil/;
export const groqPreset: ProviderPreset = {
  id: 'groq',
  label: 'Groq',
  tagline: '高速な推論。Llama・Qwen・gpt-oss などのオープンなモデル。',
  modelsNeedKey: true,
  reasoningResend: 'never',
  keyGuide: 'GroqCloud（console.groq.com）でキーを作ってください。無料枠には回数とトークン数の上限があります。有料にする場合は利用上限を設定してください。',
  corsHint: 'ネットワーク接続、または拡張機能が api.groq.com をブロックしていないか確認してください。',
  defaults: { name: 'Groq', kind: 'openai-compatible', preset: 'groq', baseUrl: builtinBaseUrl('groq', env), modelListMode: 'fetch', enabled: false },
  browserAccess: 'direct',
  modelsPath: 'models',
  mapModel(raw, providerId) {
    if (!raw?.id || raw.active === false) return null;
    const id = String(raw.id);
    if (GROQ_SKIP.test(id)) return null;
    return model(providerId, id, id, {
      contextLength: typeof raw.context_window === 'number' ? raw.context_window : undefined,
      maxOutputTokens: typeof raw.max_completion_tokens === 'number' ? raw.max_completion_tokens : undefined,
      capabilities: { tools: true, reasoning: /gpt-oss|qwen3|deepseek-r1|qwq/.test(id) }
    });
  },
  validateKey: (cfg, f) => checkKey(joinUrl(cfg.baseUrl, 'models'), f, groqPreset.corsHint)
};

// ---- OpenAI-compatible providers added at build time (VITE_CUSTOM_PROVIDERS) ----
export function customPreset(c: CustomProviderDef): ProviderPreset {
  const host = new URL(c.baseUrl).host;
  return {
    id: c.id,
    label: c.label,
    tagline: `${host} の OpenAI 互換 API（ビルド時に追加した接続先）`,
    keyOptional: c.keyOptional,
    modelsNeedKey: !c.publicModels,
    reasoningResend: 'never',
    keyGuide: c.keyOptional ? 'キーなしでも使えます。キーが必要な場合だけ設定してください。' : `${c.label} の管理画面でキーを作り、可能なら利用上限を設定してください。`,
    corsHint: `${host} がこのサイトからの接続を許可しているか（CORS）確認してください。Ollama なら環境変数 OLLAMA_ORIGINS にこのサイトのオリジンを入れて起動します。`,
    defaults: { name: c.label, kind: 'openai-compatible', preset: c.id, baseUrl: c.baseUrl, modelListMode: 'fetch', enabled: false },
    browserAccess: 'unknown',
    modelsPath: 'models',
    validateKey: c.keyOptional ? undefined : (cfg, f) => checkKey(joinUrl(cfg.baseUrl, 'models'), f, `${host} への接続を確認してください。`)
  };
}

export const customPresets: ProviderPreset[] = parseCustomProviders(env.VITE_CUSTOM_PROVIDERS).map(customPreset);
