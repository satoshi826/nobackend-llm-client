// セキュリティヘッダ（Cloudflare Pages の _headers 形式）を 1 か所で組み立てる。
// 本体アプリとキー金庫で許可する通信先を分ける（最小権限）:
//   本体: キーの要らない通信だけ（モデル一覧、キーなしの Jina Reader）
//   金庫: キーを付ける通信（LLM・Tavily・Jina）

type Env = Record<string, string | undefined>;

function origin(url: string | undefined, fallback: string): string {
  try {
    return url ? new URL(url).origin : fallback;
  } catch {
    return fallback;
  }
}

export function serviceOrigins(env: Env) {
  return {
    venice: origin(env.VITE_VENICE_BASE_URL, 'https://api.venice.ai'),
    openrouter: origin(env.VITE_OPENROUTER_BASE_URL, 'https://openrouter.ai'),
    tavily: origin(env.VITE_TAVILY_BASE_URL, 'https://api.tavily.com'),
    jina: origin(env.VITE_JINA_BASE_URL, 'https://r.jina.ai')
  };
}

const COMMON = ['X-Content-Type-Options: nosniff', 'Referrer-Policy: no-referrer', 'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()'];

/** 本体アプリの CSP。vaultOrigin は別オリジンの金庫（同一オリジンなら 'self' だけ） */
export function appCsp(env: Env, vaultOrigin?: string): string {
  const o = serviceOrigins(env);
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${o.venice} ${o.openrouter} ${o.jina}`,
    `frame-src 'self'${vaultOrigin ? ' ' + vaultOrigin : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "require-trusted-types-for 'script'",
    'trusted-types app-md dompurify app-sw'
  ].join('; ');
}

/** キー金庫の CSP。appOrigins は金庫を埋め込んでよい本体（同一オリジン配置なら 'self'） */
export function vaultCsp(env: Env, appOrigins: string[]): string {
  const o = serviceOrigins(env);
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `connect-src ${o.venice} ${o.openrouter} ${o.tavily} ${o.jina}`,
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${appOrigins.join(' ')}`,
    "object-src 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'"
  ].join('; ');
}

/** 本体のデプロイ用 _headers（同一オリジンの金庫 /vault/ には金庫用の CSP を当てる） */
export function appHeadersFile(env: Env): string {
  const vaultOrigin = env.VITE_VAULT_URL ? new URL(env.VITE_VAULT_URL).origin : undefined;
  return [
    '/*',
    `  Content-Security-Policy: ${appCsp(env, vaultOrigin)}`,
    ...COMMON.map((h) => '  ' + h),
    '  Cross-Origin-Opener-Policy: same-origin',
    '  Cross-Origin-Resource-Policy: same-origin',
    '',
    '/vault/*',
    '  ! Content-Security-Policy',
    `  Content-Security-Policy: ${vaultCsp(env, ["'self'"])}`,
    ''
  ].join('\n');
}

/** 別オリジンに置く金庫の _headers */
export function vaultHeadersFile(env: Env): string {
  const appOrigins = (env.VITE_APP_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ['/*', `  Content-Security-Policy: ${vaultCsp(env, appOrigins.length ? appOrigins : ["'self'"])}`, ...COMMON.map((h) => '  ' + h), '  Cross-Origin-Resource-Policy: same-origin', ''].join('\n');
}
