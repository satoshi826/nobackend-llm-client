// Build config of a page hosted on its own origin (the key vault, the fetch page): built from <name>/ into
// dist-<name>/ with its _headers (CSP), and the same CSP in its HTML for hosts that send no headers.
//   VITE_APP_ORIGIN : origin(s) of the app allowed to embed it (comma-separated), e.g. https://app.example.com
import { defineConfig, loadEnv, type UserConfigFnObject } from 'vite';
import { resolve } from 'node:path';
import { cspMetaTag } from './csp.config';
import type { Env } from './src/lib/providers/endpoints';

export function separatePage(name: 'vault' | 'fetch', port: number, csp: { policy(env: Env): string; headersFile(env: Env): string }): UserConfigFnObject {
  return defineConfig(({ mode }) => {
    const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
    return {
      root: resolve(__dirname, name),
      publicDir: false,
      envDir: process.cwd(),
      plugins: [
        {
          name: `${name}-headers`,
          generateBundle() {
            this.emitFile({ type: 'asset', fileName: '_headers', source: csp.headersFile(env) });
          },
          transformIndexHtml: { order: 'post', handler: (html) => html.replace('<head>', `<head>\n    ${cspMetaTag(csp.policy(env))}`) }
        }
      ],
      build: {
        outDir: resolve(__dirname, `dist-${name}`),
        emptyOutDir: true,
        target: 'es2022',
        modulePreload: { polyfill: false }
      },
      server: { port, strictPort: true }
    };
  });
}
