import { defineConfig, loadEnv, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { appHeadersFile } from './csp.config';

/** Generates _headers (CSP and other security headers) */
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
      modulePreload: { polyfill: false }, // emit no inline script (for CSP script-src 'self')
      rollupOptions: {
        // The app, and the key vault hosted on the same origin (/vault/)
        input: { main: resolve(__dirname, 'index.html'), vault: resolve(__dirname, 'vault/index.html') }
      }
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'vault/**/*.test.ts']
    }
  } as any;
});
