import { defineConfig, loadEnv, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { appHeadersFile } from './csp.config';

/** _headers（CSP などのセキュリティヘッダ）を生成する */
function headersPlugin(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'security-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: appHeadersFile(env) });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  return {
    plugins: [preact(), tailwindcss(), headersPlugin(env)],
    build: {
      target: 'es2022',
      emptyOutDir: true,
      sourcemap: false,
      modulePreload: { polyfill: false }, // インラインスクリプトを出さない（CSP script-src 'self' のため）
      rollupOptions: {
        // 本体と、同一オリジンに置くキー金庫（/vault/）
        input: { main: resolve(__dirname, 'index.html'), vault: resolve(__dirname, 'vault/index.html') }
      }
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'vault/**/*.test.ts']
    }
  } as any;
});
