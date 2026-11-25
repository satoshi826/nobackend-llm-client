import { defineConfig, loadEnv, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
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

/**
 * pdf.js character maps (needed to extract text from many Japanese / Chinese PDFs), served at /pdfjs/cmaps/.
 * They are fetched only when a PDF is attached.
 */
function pdfCmapsPlugin(): Plugin {
  const dir = resolve(__dirname, 'node_modules/pdfjs-dist/cmaps');
  return {
    name: 'pdfjs-cmaps',
    configureServer(server) {
      server.middlewares.use('/pdfjs/cmaps/', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\//, ''));
        if (!/^[\w.-]+$/.test(name)) return next();
        try {
          res.setHeader('Content-Type', 'application/octet-stream');
          res.end(readFileSync(resolve(dir, name)));
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const f of readdirSync(dir)) this.emitFile({ type: 'asset', fileName: `pdfjs/cmaps/${f}`, source: readFileSync(resolve(dir, f)) });
    }
  };
}

/**
 * The Service Worker (sw/sw.js → /sw.js) with this build's file list, so it can cache every script and
 * stylesheet at install, including screens that load their code later (components/lazy.tsx).
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((f) => f.startsWith('assets/'))
        .map((f) => `/${f}`)
        .sort();
      const precache = assets.filter((f) => /\.(js|css)$/.test(f));
      const source =
        `self.__PRECACHE__ = ${JSON.stringify(precache)};\n` + `self.__ASSETS__ = ${JSON.stringify(assets)};\n` + readFileSync(resolve(__dirname, 'sw/sw.js'), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  return {
    plugins: [preact(), tailwindcss(), headersPlugin(env), pdfCmapsPlugin(), serviceWorkerPlugin()],
    build: {
      target: 'es2022',
      emptyOutDir: true,
      sourcemap: false,
      modulePreload: { polyfill: false }, // emit no inline script (for CSP script-src 'self')
      rollupOptions: {
        // The app, and the key vault hosted on the same origin (/vault/)
        input: { main: resolve(__dirname, 'index.html'), vault: resolve(__dirname, 'vault/index.html') },
        // Emit .mjs assets (the pdf.js worker) as .js so every static host serves them as JavaScript
        output: { assetFileNames: (info: { names?: string[] }) => (info.names?.[0]?.endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]') }
      }
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'vault/**/*.test.ts']
    }
  } as any;
});
