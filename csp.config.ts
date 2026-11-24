// セキュリティヘッダ（Cloudflare Pages の _headers 形式）を 1 か所で組み立てる。
// 本体アプリとキー金庫で許可する通信先を分ける（最小権限）:
//   本体: キーの要らない通信だけ（モデル一覧、キーなしの Jina Reader、キーなしで使う接続先）
//   金庫: キーを付ける通信（LLM・Tavily・Jina）
// 接続先の宛先は src/lib/providers/endpoints.ts から作る（ビルド時の VITE_CUSTOM_PROVIDERS も含む）。
import { appDirectOrigins, keyedProviderOrigins, type Env } from './src/lib/providers/endpoints';

function origin(url: string | undefined, fallback: string): string {
  try {
    return url ? new URL(url).origin : fallback;
  } catch {
    return fallback;
  }
}

export function serviceOrigins(env: Env) {
  return {
    tavily: origin(env.VITE_TAVILY_BASE_URL, 'https://api.tavily.com'),
    jina: origin(env.VITE_JINA_BASE_URL, 'https://r.jina.ai'),
    /** 本体から直接送る LLM の接続先 */
    appProviders: appDirectOrigins(env),
    /** 金庫がキーを付けて送る LLM の接続先 */
    keyedProviders: keyedProviderOrigins(env)
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
    `connect-src 'self' ${[...o.appProviders, o.jina].join(' ')}`,
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
    `connect-src ${[...o.keyedProviders, o.tavily, o.jina].join(' ')}`,
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${appOrigins.join(' ')}`,
    "object-src 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'"
  ].join('; ');
}

/**
 * 本体のデプロイ用 _headers（Cloudflare Pages / Workers の静的アセット共通の形式）。
 * CSP は文書ごとに当てる: 本体のページ（/ と /index.html）と、同一オリジンの金庫（/vault/ 以下）。
 * 「/* に本体の CSP、/vault/* で外す」という書き方は「! ヘッダ」の対応に依存し、
 * 外れないと CSP が 2 つ重なって金庫の通信が止まるため使わない。
 * 本体は # で画面を切り替えるので、ほかのパスで HTML を返すことはない（404）。
 */
export function appHeadersFile(env: Env): string {
  const vaultOrigin = env.VITE_VAULT_URL ? new URL(env.VITE_VAULT_URL).origin : undefined;
  const app = `  Content-Security-Policy: ${appCsp(env, vaultOrigin)}`;
  return [
    '/*',
    ...COMMON.map((h) => '  ' + h),
    '  Cross-Origin-Opener-Policy: same-origin',
    '  Cross-Origin-Resource-Policy: same-origin',
    '',
    '/',
    app,
    '',
    '/index.html',
    app,
    '',
    '/vault/*',
    `  Content-Security-Policy: ${vaultCsp(env, ["'self'"])}`,
    ''
  ].join('\n');
}

/** 別オリジンに置く金庫の _headers */
export function vaultHeadersFile(env: Env): string {
  const appOrigins = (env.VITE_APP_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ['/*', `  Content-Security-Policy: ${vaultCsp(env, appOrigins.length ? appOrigins : ["'self'"])}`, ...COMMON.map((h) => '  ' + h), '  Cross-Origin-Resource-Policy: same-origin', ''].join('\n');
}
