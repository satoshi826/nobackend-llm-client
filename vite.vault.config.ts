// キー金庫のビルド設定。本体とは別のサイト（別オリジン）に配置する前提で dist-vault/ に出力する。
//   VITE_APP_ORIGIN : 金庫を埋め込んでよい本体のオリジン（カンマ区切り可）。例: https://app.example.com
// 金庫用の _headers（CSP）もここで生成する。
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolve } from 'node:path';

function hostOfUrl(u: string, fallback: string): string {
  try {
    return new URL(u).origin;
  } catch {
    return fallback;
  }
}

function vaultHeaders(env: Record<string, string>): Plugin {
  return {
    name: 'vault-headers',
    generateBundle() {
      const appOrigins = (env.VITE_APP_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
      const connect = [
        hostOfUrl(env.VITE_VENICE_BASE_URL, 'https://api.venice.ai'),
        hostOfUrl(env.VITE_OPENROUTER_BASE_URL, 'https://openrouter.ai'),
        hostOfUrl(env.VITE_TAVILY_BASE_URL, 'https://api.tavily.com'),
        hostOfUrl(env.VITE_JINA_BASE_URL, 'https://r.jina.ai')
      ];
      const csp = [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        `connect-src ${connect.join(' ')}`,
        "base-uri 'none'",
        "form-action 'none'",
        `frame-ancestors ${appOrigins.join(' ')}`,
        "object-src 'none'",
        "require-trusted-types-for 'script'",
        "trusted-types 'none'"
      ].join('; ');
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Cross-Origin-Resource-Policy: same-origin\n`
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    root: resolve(__dirname, 'vault'),
    publicDir: false,
    envDir: process.cwd(),
    plugins: [vaultHeaders(env)],
    build: {
      outDir: resolve(__dirname, 'dist-vault'),
      emptyOutDir: true,
      target: 'es2022',
      modulePreload: { polyfill: false }
    },
    server: { port: 5175, strictPort: true }
  };
});
