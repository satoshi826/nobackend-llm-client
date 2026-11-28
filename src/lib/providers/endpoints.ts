// The providers' connections, fixed at build time: where requests go, how a key is sent and checked, and whether the
// model list needs one. Presets, the key vault's accounts and allowlist, and the CSP destinations are all built from
// here. Used from both the browser (import.meta.env) and Node (vite config, csp.config.ts), so it depends on no other
// module (its messages use only the dependency-free i18n).
import { t as tp } from './messages';

export type Env = Record<string, string | undefined>;
export type AdapterKind = 'openai-compatible' | 'anthropic' | 'gemini';

export interface Endpoint {
  id: string;
  /** Shown wherever providers are listed */
  label: string;
  /** Shorter name, in messages and model lists */
  name: string;
  kind: AdapterKind;
  baseUrl: string;
  /** The model list needs no key, so the app fetches it directly (its origin joins the app's CSP) */
  publicModels: boolean;
  /** Usable without a key (e.g. local Ollama) */
  keyOptional: boolean;
  /** Header the key goes in (default: Authorization: Bearer <key>) */
  keyHeader?: { name: string; prefix?: string };
  /** Headers every request carries */
  headers?: Record<string, string>;
  /** A GET (relative to baseUrl) that fails without a valid key: the vault tries a key with it before saving it */
  keyCheck?: string;
  /**
   * The API paths (relative to baseUrl) the app calls with the key: the vault attaches it to no other path on the host.
   * `*` stands for one path parameter (part of one segment, without `/` or `:`)
   */
  paths: string[];
  /** Response headers the key vault may pass back to the app (balance etc.) */
  responseHeaders?: string[];
  /** Hosts that hand out one-time keyless download addresses (Venice videos), fetched by the app (its CSP) */
  downloads?: string[];
}

type Builtin = Omit<Endpoint, 'id' | 'baseUrl' | 'name' | 'kind' | 'publicModels' | 'keyOptional' | 'paths'> &
  Partial<Pick<Endpoint, 'name' | 'kind' | 'publicModels' | 'paths'>> & {
    /** Default base URL, overridable with this variable (for mocks during development) */
    url: string;
    env: string;
  };

/** Paths every provider of a kind is called on (chat and the model list); a provider's own paths add to these */
const KIND_PATHS: Record<AdapterKind, string[]> = {
  'openai-compatible': ['chat/completions', 'models'],
  anthropic: ['messages', 'models'],
  gemini: ['models', 'models/*:streamGenerateContent']
};

const BUILTIN: Record<string, Builtin> = {
  venice: {
    label: 'Venice.ai',
    name: 'Venice',
    url: 'https://api.venice.ai/api/v1',
    env: 'VITE_VENICE_BASE_URL',
    publicModels: true,
    keyCheck: 'api_keys/rate_limits',
    paths: ['api_keys/rate_limits', 'image/styles', 'image/generate', 'image/edit', 'image/upscale', 'image/background-remove', 'video/quote', 'video/queue', 'video/retrieve', 'video/complete'],
    responseHeaders: ['x-venice-balance-usd', 'x-venice-balance-diem', 'x-venice-is-blurred', 'x-venice-is-content-violation', 'x-venice-content-violation-count', 'x-venice-enhanced-prompt'],
    downloads: ['https://private-share.venice.ai']
  },
  openrouter: {
    label: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1',
    env: 'VITE_OPENROUTER_BASE_URL',
    publicModels: true,
    keyCheck: 'key',
    paths: ['key', 'images', 'videos', 'videos/*', 'videos/*/content']
  },
  nanogpt: { label: 'NanoGPT', url: 'https://api.nano-gpt.com/api/v1', env: 'VITE_NANOGPT_BASE_URL', publicModels: true, paths: ['../check-balance', 'images/generations'] },
  deepinfra: { label: 'DeepInfra', url: 'https://api.deepinfra.com/v1/openai', env: 'VITE_DEEPINFRA_BASE_URL', publicModels: true, paths: ['images/generations'] },
  cerebras: { label: 'Cerebras', url: 'https://api.cerebras.ai/v1', env: 'VITE_CEREBRAS_BASE_URL', publicModels: true, keyCheck: 'models' },
  novita: { label: 'Novita', url: 'https://api.novita.ai/openai/v1', env: 'VITE_NOVITA_BASE_URL', publicModels: true },
  chutes: { label: 'Chutes', url: 'https://llm.chutes.ai/v1', env: 'VITE_CHUTES_BASE_URL', publicModels: true },
  together: { label: 'Together', url: 'https://api.together.ai/v1', env: 'VITE_TOGETHER_BASE_URL', keyCheck: 'models', paths: ['images/generations'] },
  anthropic: {
    label: 'Anthropic',
    kind: 'anthropic',
    url: 'https://api.anthropic.com/v1',
    env: 'VITE_ANTHROPIC_BASE_URL',
    keyHeader: { name: 'x-api-key' },
    headers: { 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    keyCheck: 'models?limit=1'
  },
  gemini: {
    label: 'Google Gemini',
    name: 'Gemini',
    kind: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta',
    env: 'VITE_GEMINI_BASE_URL',
    keyHeader: { name: 'x-goog-api-key' },
    keyCheck: 'models?pageSize=1',
    // Images, video, and the file a video answer may point to
    paths: ['models/*:generateContent', 'interactions', 'files/*:download']
  },
  deepseek: { label: 'DeepSeek', url: 'https://api.deepseek.com', env: 'VITE_DEEPSEEK_BASE_URL', keyCheck: 'models', paths: ['user/balance'] },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1', env: 'VITE_OPENAI_BASE_URL', keyCheck: 'models', paths: ['images/generations', 'images/edits'] },
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1', env: 'VITE_GROQ_BASE_URL', keyCheck: 'models' }
};

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function isLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/**
 * OpenAI-compatible providers added at build time (VITE_CUSTOM_PROVIDERS, as a JSON array).
 * e.g. [{"id":"ollama","label":"Ollama","baseUrl":"http://localhost:11434/v1","keyOptional":true}]
 * Invalid entries throw (so the build stops and it gets noticed)
 */
export function parseCustomProviders(json: string | undefined): Endpoint[] {
  if (!json || !json.trim()) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error(tp('custom.notJson'));
  }
  if (!Array.isArray(raw)) throw new Error(tp('custom.notArray'));
  const seen = new Set<string>();
  return raw.map((r: any, i) => {
    const where = `VITE_CUSTOM_PROVIDERS[${i}]`;
    if (typeof r?.id !== 'string' || !ID_RE.test(r.id)) throw new Error(tp('custom.badId', { where }));
    if (BUILTIN[r.id] || r.id === 'tavily' || seen.has(r.id)) throw new Error(tp('custom.duplicateId', { where, id: r.id }));
    seen.add(r.id);
    let u: URL;
    try {
      u = new URL(String(r.baseUrl));
    } catch {
      throw new Error(tp('custom.badUrl', { where }));
    }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal(u.hostname))) throw new Error(tp('custom.insecureUrl', { where }));
    if (u.username || u.password || u.search || u.hash) throw new Error(tp('custom.urlExtras', { where }));
    const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 40) : r.id;
    const keyOptional = !!r.keyOptional;
    return {
      id: r.id,
      label,
      name: label,
      kind: 'openai-compatible',
      baseUrl: u.toString().replace(/\/+$/, ''),
      publicModels: !!r.publicModels || keyOptional,
      keyOptional,
      paths: KIND_PATHS['openai-compatible'],
      ...(keyOptional ? {} : { keyCheck: 'models' })
    };
  });
}

/** Every provider's connection: the built-in ones (base URLs overridable from `env`), then the custom ones */
export function endpointsOf(env: Env): Endpoint[] {
  const builtins = Object.entries(BUILTIN).map(([id, { url, env: name, ...b }]): Endpoint => ({
    id,
    name: b.label,
    kind: 'openai-compatible',
    publicModels: false,
    keyOptional: false,
    ...b,
    baseUrl: env[name] || url,
    paths: [...KIND_PATHS[b.kind ?? 'openai-compatible'], ...(b.paths ?? [])]
  }));
  return [...builtins, ...parseCustomProviders(env.VITE_CUSTOM_PROVIDERS)];
}

/** The connections of this build (in Node, with no build environment, the defaults) */
export const ENDPOINTS: Record<string, Endpoint> = Object.fromEntries(endpointsOf((import.meta as any).env ?? {}).map((e) => [e.id, e]));

/** Providers the app may call directly without the vault (keyless model lists and downloads, keyless providers) */
export function appDirectOrigins(env: Env): string[] {
  const out: string[] = [];
  for (const e of endpointsOf(env)) {
    if (e.publicModels) out.push(new URL(e.baseUrl).origin);
    out.push(...(e.downloads ?? []));
  }
  return [...new Set(out)];
}

/** Providers called with a key attached (the vault's destinations) */
export function keyedProviderOrigins(env: Env): string[] {
  return [...new Set(endpointsOf(env).map((e) => new URL(e.baseUrl).origin))];
}
