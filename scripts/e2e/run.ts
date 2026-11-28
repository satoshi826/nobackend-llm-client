// End-to-end tests on the production build: builds the app against the mock providers, serves it with the real
// security headers (CSP, Trusted Types), and runs each flow in a fresh browser with no CSP violation, console error,
// uncaught error or request to another origin than the app's and the mock's allowed in any of its pages (the app, the
// key vault, the fetch page, the sandbox) and workers, and accessibility checks on the screens they reach (a11y.ts).
//
//   npm run e2e                       every flow
//   npm run e2e -- --flows chat,lock  some of them
//   npm run e2e -- --headed           in a visible browser
//
// Starts its own mock server (scripts/mock-venice.mjs, on a free port: one already running may be an older version) and
// stops everything it started. A screenshot at the end of each flow (and of a failing one), the screenshots a flow takes
// at its steps (in a folder named after it, at the width it runs at and at a phone's), and the accessibility report
// (a11y-report.json) go to .claude/artifacts/branches/<branch>/screens/e2e/.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Request } from 'playwright';
import { check, describe, failing, report, type Finding } from './a11y.ts';
import { FLOWS } from './flows.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const TMP = join(ROOT, 'tmp/e2e');
/** The providers the flows use, answered by the mock (README "Try it without real APIs") */
const mockEnv = (mock: string) => ({
  VITE_VENICE_BASE_URL: `${mock}/api/v1`,
  VITE_ANTHROPIC_BASE_URL: `${mock}/anthropic/v1`,
  VITE_TAVILY_BASE_URL: `${mock}/tavily`,
  VITE_JINA_BASE_URL: `${mock}/jina`
});

function args() {
  const a = process.argv.slice(2);
  const i = a.indexOf('--flows');
  return { flows: i >= 0 ? a[i + 1].split(',') : FLOWS.map((f) => f.name), headed: a.includes('--headed') };
}

async function up(url: string) {
  for (let i = 0; i < 100; i++) {
    if (await fetch(url).then(() => true, () => false)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });
}

function screensDir() {
  let branch = 'main';
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    /* not a checkout: the default name */
  }
  const dir = join(ROOT, '.claude/artifacts/branches', branch, 'screens/e2e');
  // Only this run's: no failure shot left from an earlier one
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The phone size each step screenshot is also taken at */
const PHONE = { width: 375, height: 812 };

/** Waits until nothing scrolls for a few frames (after a resize, the conversation keeps its end in view) */
const still = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        let last = '';
        let same = 0;
        const frame = () => {
          const now = [...document.querySelectorAll('*')].map((e) => e.scrollTop).join();
          same = now === last ? same + 1 : 0;
          last = now;
          if (same >= 3) done();
          else requestAnimationFrame(frame);
        };
        frame();
      })
  );

/** Console errors that are expected */
const EXPECTED = [
  // The sandbox's CSP refuses peer connections in browsers that know the directive; Chrome does not, and says so
  "Unrecognized Content-Security-Policy directive 'webrtc'",
  // Requests made while offline (the offline flow): the update check, model lists
  'net::ERR_INTERNET_DISCONNECTED'
];

/**
 * Collects what must not happen in any page or frame of the context: console errors, which include every CSP and
 * Trusted Types violation (the sandbox's too), uncaught errors and rejections, and requests (fetches, navigations,
 * windows, workers' and the Service Worker's requests, web sockets) to an origin not in allowed. The violation
 * listener adds a plain line naming the directive and the page; the browser runs it before each document's own
 * scripts, out of the CSP's reach (not in the sandbox, which has no origin)
 */
async function watch(context: BrowserContext, problems: Set<string>, allowed: Set<string>, expected: string[]) {
  const leaves = (url: string, from: string) => {
    const u = new URL(url);
    if (/^(https?|wss?):$/.test(u.protocol) && !allowed.has(u.origin.replace(/^ws/, 'http'))) problems.add(`request to ${u.origin}${u.pathname} from ${from}`);
  };
  const by = (r: Request) => {
    if (r.serviceWorker()) return 'the Service Worker';
    try {
      return r.frame().url().split(/[?#]/)[0] || 'a new page';
    } catch {
      return 'a navigation';
    }
  };
  context.on('request', (r) => leaves(r.url(), by(r)));
  context.on('page', (p) => p.on('websocket', (w) => leaves(w.url(), p.url())));
  context.on('console', (m) => {
    if (m.type() === 'error' && ![...EXPECTED, ...expected].some((x) => m.text().includes(x))) problems.add(`console error${m.location().url ? ` in ${m.location().url}` : ''}: ${m.text()}`);
  });
  context.on('weberror', (e) => problems.add(`uncaught: ${e.error().message}`));
  await context.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.effectiveDirective} blocked ${e.blockedURI || 'inline'} in ${location.href.split(/[?#]/)[0]}`))
  );
}

/** A fresh, watched browser context. English, so the flows can find things by their labels */
async function newContext(browser: Browser, problems: Set<string>, allowed: Set<string>, expected: string[]) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  context.setDefaultTimeout(10_000);
  await watch(context, problems, allowed, expected);
  return context;
}

async function main() {
  const o = args();
  const flows = FLOWS.filter((f) => o.flows.includes(f.name));
  const children: ChildProcess[] = [];
  const stop = () => children.forEach((c) => c.kill());
  process.on('exit', stop);
  process.on('SIGINT', () => process.exit(130));
  const started = Date.now();
  try {
    const mockPort = await freePort();
    const mock = `http://localhost:${mockPort}`;
    children.push(spawn('node', [join(ROOT, 'scripts/mock-venice.mjs'), String(mockPort)], { stdio: 'ignore' }));
    if (!(await up(`${mock}/api/v1/models`))) throw new Error(`The mock server did not start on ${mock}`);
    // The folder served; deploy() puts a new build in its place
    const live = join(TMP, 'live');
    const build = (outDir: string, extra: string[] = [], env: Record<string, string> = {}) =>
      execFileSync('npx', ['vite', 'build', ...extra, '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd: ROOT, env: { ...process.env, ...mockEnv(mock), ...env }, stdio: 'inherit' });
    console.error('Building the app against the mock providers…');
    build(live);
    let releases = 0;
    const deploy = () => {
      const next = join(TMP, 'next');
      build(next, ['--config', join(ROOT, 'scripts/e2e/vite.renamed.config.ts')], { E2E_RENAME: `r${++releases}` });
      const old = join(TMP, 'old');
      renameSync(live, old);
      renameSync(next, live);
      rmSync(old, { recursive: true, force: true });
    };
    const port = await freePort();
    children.push(spawn('node', [join(ROOT, 'scripts/serve-with-headers.mjs'), live, String(port)], { stdio: 'ignore' }));
    const url = `http://localhost:${port}/`;
    if (!(await up(url))) throw new Error(`The build is not served at ${url}`);
    // Where requests may go: the app (with the vault and the fetch page on its origin) and the providers it was built
    // with, all answered by the mock
    const allowed = new Set([new URL(url).origin, ...Object.values(mockEnv(mock)).map((u) => new URL(u).origin)]);

    const screens = screensDir();
    const browser = await chromium.launch({ headless: !o.headed });
    const failed: string[] = [];
    const findings: Finding[] = [];
    for (const flow of flows) {
      const t0 = Date.now();
      const problems = new Set<string>();
      const contexts: BrowserContext[] = [];
      const open = async () => {
        contexts.push(await newContext(browser, problems, allowed, flow.expected ?? []));
        return contexts.at(-1)!;
      };
      const page = await (await open()).newPage();
      const a11y = async (screen: string) => {
        const found = await check(page, screen);
        findings.push(...found);
        for (const f of found.filter(failing)) problems.add(`accessibility: ${describe(f)}`);
      };
      let shots = 0;
      const shot = async (name: string, { phone = true } = {}) => {
        const n = String(++shots).padStart(2, '0');
        const file = (width: number) => join(screens, flow.name, `${n}-${name.replace(/ /g, '-')}-${width}.png`);
        // Off any tooltip
        await page.mouse.move(0, 0);
        const size = page.viewportSize()!;
        await page.screenshot({ path: file(size.width), animations: 'disabled' });
        if (!phone || size.width === PHONE.width) return;
        await page.setViewportSize(PHONE);
        await still(page);
        await page.screenshot({ path: file(PHONE.width), animations: 'disabled' });
        await page.setViewportSize(size);
        // Before the flow goes on: what it clicks next is where it was
        await still(page);
      };
      try {
        await flow.run({ page, url, newContext: open, tmp: TMP, deploy, a11y, shot });
        // Off any tooltip
        await page.mouse.move(0, 0);
        await page.screenshot({ path: join(screens, `${flow.name}.png`), animations: 'disabled' });
        if (problems.size) throw new Error('Problems in the pages');
        console.error(`  ✓ ${flow.name}: ${flow.label} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      } catch (e) {
        failed.push(flow.name);
        console.error(`  ✗ ${flow.name}: ${flow.label}\n    ${(e as Error).message.trim().replace(/\n+/g, '\n    ')}`);
        for (const p of problems) console.error(`    ${p}`);
        const pages = contexts.flatMap((c) => c.pages());
        for (const [i, p] of pages.entries()) {
          const path = join(screens, `failed-${flow.name}${i ? `-${i + 1}` : ''}.png`);
          await p.screenshot({ path }).catch(() => {});
          console.error(`    screenshot: ${path}`);
        }
      } finally {
        for (const c of contexts) await c.close();
      }
    }
    await browser.close();
    for (const line of report(findings, join(screens, 'a11y-report.json'), flows.length === FLOWS.length)) console.error(line);
    console.error(`${flows.length - failed.length}/${flows.length} flows passed in ${Math.round((Date.now() - started) / 1000)} s. Screenshots: ${screens}`);
    if (failed.length) process.exitCode = 1;
  } finally {
    stop();
    rmSync(TMP, { recursive: true, force: true });
  }
}

await main();
