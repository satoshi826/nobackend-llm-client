// キー金庫のビルド設定。本体とは別のサイト（別オリジン）に配置する前提で dist-vault/ に出力する。
//   VITE_APP_ORIGIN : 金庫を埋め込んでよい本体のオリジン（カンマ区切り可）。例: https://app.example.com
// 金庫用の _headers（CSP）もここで生成する。
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { vaultHeadersFile } from './csp.config';

function vaultHeaders(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'vault-headers',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: vaultHeadersFile(env) });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
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
