// Provider destinations (fixed at build time). Presets, the key vault's allowlist and the CSP destinations are all built from here.
// Used from both the browser (import.meta.env) and Node (vite config, csp.config.ts), so it depends on no other module.

export type Env = Record<string, string | undefined>;

/** Default URLs of the built-in providers (overridable with VITE_<ID>_BASE_URL, for mocks during development) */
export const BUILTIN_BASE_URLS: Record<string, { env: string; url: string }> = {
  venice: { env: 'VITE_VENICE_BASE_URL', url: 'https://api.venice.ai/api/v1' },
  openrouter: { env: 'VITE_OPENROUTER_BASE_URL', url: 'https://openrouter.ai/api/v1' },
  anthropic: { env: 'VITE_ANTHROPIC_BASE_URL', url: 'https://api.anthropic.com/v1' },
  gemini: { env: 'VITE_GEMINI_BASE_URL', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  deepseek: { env: 'VITE_DEEPSEEK_BASE_URL', url: 'https://api.deepseek.com' },
  groq: { env: 'VITE_GROQ_BASE_URL', url: 'https://api.groq.com/openai/v1' }
};

export function builtinBaseUrl(id: string, env: Env): string {
  const b = BUILTIN_BASE_URLS[id];
  return (b && env[b.env]) || b?.url || '';
}

/**
 * OpenAI-compatible providers added at build time (VITE_CUSTOM_PROVIDERS, as a JSON array).
 * e.g. [{"id":"ollama","label":"Ollama","baseUrl":"http://localhost:11434/v1","keyOptional":true}]
 */
export interface CustomProviderDef {
  id: string;
  label: string;
  baseUrl: string;
  /** Usable without a key (e.g. local Ollama) */
  keyOptional?: boolean;
  /** Model list can be fetched without a key */
  publicModels?: boolean;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function isLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** Invalid entries throw (so the build stops and it gets noticed) */
export function parseCustomProviders(json: string | undefined): CustomProviderDef[] {
  if (!json || !json.trim()) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('VITE_CUSTOM_PROVIDERS が JSON として読めません。');
  }
  if (!Array.isArray(raw)) throw new Error('VITE_CUSTOM_PROVIDERS は配列で指定してください。');
  const seen = new Set<string>();
  return raw.map((r: any, i) => {
    const where = `VITE_CUSTOM_PROVIDERS[${i}]`;
    if (typeof r?.id !== 'string' || !ID_RE.test(r.id)) throw new Error(`${where}.id は半角の小文字・数字・ハイフンで指定してください。`);
    if (BUILTIN_BASE_URLS[r.id] || r.id === 'tavily' || r.id === 'jina' || seen.has(r.id)) throw new Error(`${where}.id「${r.id}」は使えません（重複）。`);
    seen.add(r.id);
    let u: URL;
    try {
      u = new URL(String(r.baseUrl));
    } catch {
      throw new Error(`${where}.baseUrl が URL ではありません。`);
    }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal(u.hostname))) throw new Error(`${where}.baseUrl は https（ローカルなら http）にしてください。`);
    if (u.username || u.password || u.search || u.hash) throw new Error(`${where}.baseUrl に認証情報やクエリは書けません。`);
    return {
      id: r.id,
      label: typeof r.label === 'string' && r.label.trim() ? r.label.trim().slice(0, 40) : r.id,
      baseUrl: u.toString().replace(/\/+$/, ''),
      keyOptional: !!r.keyOptional,
      publicModels: !!r.publicModels || !!r.keyOptional
    };
  });
}

/** Providers the app may call directly without the vault (keyless model lists, keyless providers) */
export function appDirectOrigins(env: Env): string[] {
  const out = [builtinBaseUrl('venice', env), builtinBaseUrl('openrouter', env)].map((u) => new URL(u).origin);
  for (const c of parseCustomProviders(env.VITE_CUSTOM_PROVIDERS)) if (c.publicModels || c.keyOptional) out.push(new URL(c.baseUrl).origin);
  return [...new Set(out)];
}

/** Providers called with a key attached (the vault's destinations) */
export function keyedProviderOrigins(env: Env): string[] {
  const out = Object.keys(BUILTIN_BASE_URLS).map((id) => new URL(builtinBaseUrl(id, env)).origin);
  for (const c of parseCustomProviders(env.VITE_CUSTOM_PROVIDERS)) out.push(new URL(c.baseUrl).origin);
  return [...new Set(out)];
}
