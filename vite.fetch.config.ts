// Build config for the fetch page hosted on a separate origin (optional). Outputs to dist-fetch/.
//   VITE_APP_ORIGIN       : origin(s) of the app allowed to embed it (comma-separated), e.g. https://app.example.com
//   VITE_FETCH_RELAY_URL  : optional relay for sites that do not allow fetching from a browser (relay/worker.js)
//   VITE_JINA_BASE_URL    : Jina Reader's address; only for the mock (defaults to https://r.jina.ai)
// The app is then built with VITE_FETCH_URL pointing at it, and with the same VITE_FETCH_RELAY_URL (Settings → Web
// shows it). Also generates the page's _headers (CSP).
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { cspMetaTag, fetchHeadersFile, fetchPagePolicy } from './csp.config';

function fetchHeaders(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'fetch-headers',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: fetchHeadersFile(env) });
    },
    // The same CSP in the HTML, for hosts that do not send _headers
    transformIndexHtml: { order: 'post', handler: (html) => html.replace('<head>', `<head>\n    ${cspMetaTag(fetchPagePolicy(env))}`) }
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  return {
    root: resolve(__dirname, 'fetch'),
    publicDir: false,
    envDir: process.cwd(),
    plugins: [fetchHeaders(env)],
    build: {
      outDir: resolve(__dirname, 'dist-fetch'),
      emptyOutDir: true,
      target: 'es2022',
      modulePreload: { polyfill: false }
    },
    server: { port: 5176, strictPort: true }
  };
});
