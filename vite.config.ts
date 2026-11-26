import { defineConfig, loadEnv, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { appHeadersFile, appPagePolicies, cspMetaTag, separateOrigins } from './csp.config';

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

/** Puts each page's CSP in its HTML too, for hosts that do not send _headers (GitHub Pages) */
function cspMetaPlugin(policies: Record<string, string>): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html, ctx) => (policies[ctx.path] ? html.replace('<head>', `<head>\n    ${cspMetaTag(policies[ctx.path])}`) : html)
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

/**
 * Which build this is: package version, commit (Cloudflare Workers Builds sets WORKERS_CI_COMMIT_SHA; otherwise
 * git), build time. Shown in Settings → 情報 and written to /version.json, which running pages poll to learn
 * that a newer build is out (state/version.ts).
 */
function buildInfo(env: Record<string, string | undefined>) {
  let commit = env.WORKERS_CI_COMMIT_SHA || env.CF_PAGES_COMMIT_SHA || env.GITHUB_SHA || '';
  if (!commit) {
    try {
      commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      commit = 'unknown';
    }
  }
  const version = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version as string;
  return { version, commit, builtAt: new Date().toISOString() };
}

function versionFilePlugin(info: ReturnType<typeof buildInfo>): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(info) });
    }
  };
}

export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  const info = command === 'build' ? buildInfo(env) : { version: 'dev', commit: 'dev', builtAt: '' };
  return {
    define: { __APP_BUILD__: JSON.stringify(info) },
    plugins: [preact(), tailwindcss(), headersPlugin(env), cspMetaPlugin(appPagePolicies(env)), pdfCmapsPlugin(), serviceWorkerPlugin(), versionFilePlugin(info)],
    build: {
      target: 'es2022',
      emptyOutDir: true,
      sourcemap: false,
      modulePreload: { polyfill: false }, // emit no inline script (for CSP script-src 'self')
      rollupOptions: {
        // The app, and the key vault and the fetch page on the same origin (/vault/, /fetch/) unless they have their own
        input: {
          main: resolve(__dirname, 'index.html'),
          ...(separateOrigins(env).vaultOrigin ? {} : { vault: resolve(__dirname, 'vault/index.html') }),
          ...(separateOrigins(env).fetchOrigin ? {} : { fetch: resolve(__dirname, 'fetch/index.html') })
        },
        // Emit .mjs assets (the pdf.js worker) as .js so every static host serves them as JavaScript
        output: { assetFileNames: (info: { names?: string[] }) => (info.names?.[0]?.endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]') }
      }
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'vault/**/*.test.ts', 'fetch/**/*.test.ts', 'relay/**/*.test.ts']
    }
  } as any;
});
