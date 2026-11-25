// Build config for the key vault. Outputs to dist-vault/, assuming it is hosted on a separate site (separate origin) from the app.
//   VITE_APP_ORIGIN : origin(s) of the app allowed to embed the vault (comma-separated). e.g. https://app.example.com
// Also generates the vault's _headers (CSP).
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
