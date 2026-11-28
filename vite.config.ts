import { defineConfig, loadEnv, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { appHeadersFile, appPagePolicies, cspMetaTag, sandboxCsp, separateOrigins } from './csp.config';

/** Where the app is served from: '/' at a domain root, '/repo/' under a subpath (VITE_BASE_PATH, e.g. GitHub Pages project sites) */
function basePath(env: Record<string, string | undefined>): string {
  const p = (env.VITE_BASE_PATH || '/').trim();
  return `/${p.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
}

/** Generates _headers (CSP and other security headers) */
function headersPlugin(env: Record<string, string | undefined>, base: string): Plugin {
  return {
    name: 'security-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: appHeadersFile(env, base) });
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
 * The sandbox page (sandbox/sandbox.html → /sandbox/), with its CSP and sandbox/rewrite.js, storage.js and node.js put in
 * (into its inline script: the page has no origin to load scripts from); served by the dev server too
 */
function sandboxPagePlugin(base: string): Plugin {
  const part = (name: string) => {
    const js = readFileSync(resolve(__dirname, `sandbox/${name}`), 'utf8');
    if (/<\/script/i.test(js)) throw new Error(`sandbox/${name} must not contain a closing script tag`);
    return js;
  };
  const page = () =>
    readFileSync(resolve(__dirname, 'sandbox/sandbox.html'), 'utf8')
      .replace('<!--CSP-->', cspMetaTag(sandboxCsp(false)))
      .replace('/*REWRITE*/', () => part('rewrite.js'))
      .replace('/*STORAGE*/', () => part('storage.js'))
      .replace('/*NODE*/', () => part('node.js'));
  return {
    name: 'sandbox-page',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (path !== `${base}sandbox/` && path !== `${base}sandbox/index.html`) return next();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy', sandboxCsp());
        res.setHeader('X-DNS-Prefetch-Control', 'off');
        res.end(page());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sandbox/index.html', source: page() });
    }
  };
}

/**
 * pdf.js character maps (needed to extract text from many Japanese / Chinese PDFs), served at /pdfjs/cmaps/.
 * They are fetched only when a PDF is attached.
 */
function pdfCmapsPlugin(base: string): Plugin {
  const dir = resolve(__dirname, 'node_modules/pdfjs-dist/cmaps');
  return {
    name: 'pdfjs-cmaps',
    configureServer(server) {
      server.middlewares.use(`${base}pdfjs/cmaps/`, (req, res, next) => {
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
 * The Service Worker (sw/sw.js → /sw.js) with this build's file list, so it can cache every script, stylesheet and
 * font at install, including screens that load their code later (components/lazy.tsx), and its pages: the app, and
 * the key vault when it is built on the app's origin (the app waits for it before its first screen).
 */
function serviceWorkerPlugin(base: string): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    // After Vite's own plugins: it drops the empty JS chunks of CSS-only imports late in generateBundle, and a listed
    // file that is never written makes the worker's install (cache.addAll) fail
    generateBundle: { order: 'post', handler(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((f) => f.startsWith('assets/'))
        .map((f) => `${base}${f}`)
        .sort();
      const precache = assets.filter((f) => /\.(js|css|woff2)$/.test(f));
      const pages = [base, ...('vault/index.html' in bundle ? [`${base}vault/`] : [])];
      const source =
        `self.__PAGES__ = ${JSON.stringify(pages)};\n` +
        `self.__PRECACHE__ = ${JSON.stringify(precache)};\n` +
        `self.__ASSETS__ = ${JSON.stringify(assets)};\n` +
        readFileSync(resolve(__dirname, 'sw/sw.js'), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    } }
  };
}

/**
 * The font's license (SIL OFL), served as licenses-fonts.txt: the font is loaded from CSS, so the bundled licenses
 * (licenses.md) do not list it, and the OFL asks for its text to go with every copy of the font
 */
function fontLicensePlugin(): Plugin {
  return {
    name: 'font-license',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'licenses-fonts.txt', source: readFileSync(resolve(__dirname, 'node_modules/@fontsource-variable/inter/LICENSE'), 'utf8') });
    }
  };
}

/**
 * Which build this is: package version, commit (Cloudflare Workers Builds sets WORKERS_CI_COMMIT_SHA; otherwise
 * git), and the source's date. Shown in Settings → 情報 and written to /version.json, which running pages poll to
 * learn that a newer build is out (state/version.ts).
 * The date is SOURCE_DATE_EPOCH when set, else the commit's time, never the clock: the same source always builds the
 * same files, so anyone can rebuild a release and compare (npm run build:verify).
 */
function buildInfo(env: Record<string, string | undefined>) {
  const git = (args: string) => {
    try {
      return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  const commit = env.WORKERS_CI_COMMIT_SHA || env.CF_PAGES_COMMIT_SHA || env.GITHUB_SHA || git('rev-parse HEAD') || 'unknown';
  const date = env.SOURCE_DATE_EPOCH ? new Date(Number(env.SOURCE_DATE_EPOCH) * 1000) : new Date(git('log -1 --format=%cI'));
  const version = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version as string;
  return { version, commit, builtAt: Number.isNaN(date.getTime()) ? '' : date.toISOString() };
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
  const base = basePath(env);
  return {
    base,
    define: { __APP_BUILD__: JSON.stringify(info) },
    plugins: [preact(), tailwindcss(), headersPlugin(env, base), cspMetaPlugin(appPagePolicies(env)), sandboxPagePlugin(base), pdfCmapsPlugin(base), serviceWorkerPlugin(base), versionFilePlugin(info), fontLicensePlugin()],
    build: {
      target: 'es2022',
      emptyOutDir: true,
      sourcemap: false,
      modulePreload: { polyfill: false }, // emit no inline script (for CSP script-src 'self')
      // The licenses of the bundled packages, served next to the app (their terms ask for them to go with copies)
      license: { fileName: 'licenses.md' },
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
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'vault/**/*.test.ts', 'fetch/**/*.test.ts', 'relay/**/*.test.ts']
    }
  } as any;
});
