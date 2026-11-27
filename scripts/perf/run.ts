// Measuring the UI's performance: builds two versions of the app (base and head), serves each, and measures the same
// scenarios on both in turn, each run in a fresh browser with the CPU slowed down. Prints a Markdown report and keeps
// every value in tmp/perf/results/<time>/.
//
//   npm run perf                                  the last commit (base) against the working tree (head)
//   npm run perf -- --base HEAD~1 --head HEAD     any two commits
//   npm run perf -- --only                        the working tree alone (no comparison)
//   npm run perf -- --scenarios chat,files --runs 7 --cpu 4
//
// Needs the mock server for the provider the perf build adds (started here when it is not running).
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { Probe, type Metrics } from './measure.ts';
import { SCENARIOS } from './scenarios.ts';
import { report, type Runs } from './report.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const TMP = join(ROOT, 'tmp/perf');
const MOCK_PORT = 8787;
/** The provider perf builds add: no key needed, answers from the mock server (src/perf/index.ts PERF_PROVIDER) */
const PERF_PROVIDERS = JSON.stringify([{ id: 'perf', label: 'Perf', baseUrl: `http://localhost:${MOCK_PORT}/api/v1`, keyOptional: true }]);

function args() {
  const a = process.argv.slice(2);
  const get = (name: string, fallback: string) => {
    const i = a.indexOf(`--${name}`);
    return i >= 0 ? a[i + 1] : fallback;
  };
  return {
    base: get('base', 'HEAD'),
    head: get('head', 'working'),
    only: a.includes('--only'),
    // 7 at least for a mark: with 5 a side, even two sets that do not overlap give p ≈ 0.012 (above the 0.01 limit)
    runs: Number(get('runs', '7')),
    cpu: Number(get('cpu', '4')),
    scenarios: get('scenarios', SCENARIOS.map((s) => s.name).join(',')).split(',')
  };
}

const git = (...a: string[]) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

/** Build a version into tmp/perf/builds/<name>: 'working' is the checkout as it is (uncommitted changes too) */
function build(ref: string, name: string): string {
  const out = join(TMP, 'builds', name);
  const env = { ...process.env, VITE_CUSTOM_PROVIDERS: PERF_PROVIDERS };
  let cwd = ROOT;
  if (ref !== 'working') {
    cwd = join(TMP, 'src', name);
    rmSync(cwd, { recursive: true, force: true });
    git('worktree', 'add', '--force', '--detach', cwd, ref);
    symlinkSync(join(ROOT, 'node_modules'), join(cwd, 'node_modules'));
  }
  console.error(`Building ${name} (${ref === 'working' ? 'working tree' : git('rev-parse', '--short', ref)})…`);
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd, env, stdio: 'inherit' });
  if (ref !== 'working') git('worktree', 'remove', '--force', cwd);
  return out;
}

function serve(dir: string, port: number): ChildProcess {
  return spawn('node', [join(ROOT, 'scripts/serve-with-headers.mjs'), dir, String(port)], { stdio: 'ignore' });
}

const answers = (url: string) => fetch(url).then(() => true, () => false);

async function up(url: string) {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(url);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return false;
}

async function main() {
  const o = args();
  const scenarios = SCENARIOS.filter((s) => o.scenarios.includes(s.name));
  const children: ChildProcess[] = [];
  const stop = () => children.forEach((c) => c.kill());
  process.on('exit', stop);
  try {
    if (!(await answers(`http://localhost:${MOCK_PORT}/api/v1/models`))) {
      children.push(spawn('node', [join(ROOT, 'scripts/mock-venice.mjs'), String(MOCK_PORT)], { stdio: 'ignore' }));
      await up(`http://localhost:${MOCK_PORT}/api/v1/models`);
    }
    const sides: { name: 'base' | 'head'; url: string }[] = [];
    const headDir = build(o.head, 'head');
    children.push(serve(headDir, 4301));
    sides.push({ name: 'head', url: 'http://localhost:4301' });
    if (!o.only) {
      const baseDir = build(o.base, 'base');
      children.push(serve(baseDir, 4302));
      sides.unshift({ name: 'base', url: 'http://localhost:4302' });
    }
    for (const s of sides) if (!(await up(s.url))) throw new Error(`The ${s.name} build is not served at ${s.url}`);

    const results: Record<'base' | 'head', Runs> = { base: {}, head: {} };
    const browser = await chromium.launch();
    const started = Date.now();
    for (const scenario of scenarios) {
      for (let run = 0; run < o.runs; run++) {
        // In turn, so whatever the machine does meanwhile falls on both
        for (const side of run % 2 ? [...sides].reverse() : sides) {
          // The app's CSP forbids evaluating strings, which Playwright's conditions do; it costs nothing to rendering
          const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
          const page = await context.newPage();
          try {
            const probe = await Probe.attach(page);
            const steps = await scenario.run(probe, side.url, o.cpu);
            for (const [step, m] of Object.entries(steps)) ((results[side.name][scenario.name] ??= {})[step] ??= []).push(m as Metrics);
            console.error(`  ${scenario.name} ${side.name} ${run + 1}/${o.runs}`);
          } catch (e) {
            const shot = join(TMP, `failed-${scenario.name}-${side.name}.png`);
            await page.screenshot({ path: shot }).catch(() => {});
            throw new Error(`${scenario.name} on ${side.name} failed (screenshot: ${shot}): ${(e as Error).message}`);
          } finally {
            await context.close();
          }
        }
      }
    }
    await browser.close();

    const title = o.only
      ? `head ${o.head === 'working' ? 'working tree' : git('rev-parse', '--short', o.head)} · ${o.runs} runs · CPU ${o.cpu}× slower · ${Math.round((Date.now() - started) / 60000)} min`
      : `base ${git('rev-parse', '--short', o.base)} → head ${o.head === 'working' ? 'working tree' : git('rev-parse', '--short', o.head)} · ${o.runs} runs each, in turn · CPU ${o.cpu}× slower · ${Math.round((Date.now() - started) / 60000)} min`;
    const md = report({ base: o.only ? null : results.base, head: results.head, labels: Object.fromEntries(SCENARIOS.map((s) => [s.name, s.label])), title });
    const dir = join(TMP, 'results', new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'results.json'), JSON.stringify(results, null, 2));
    writeFileSync(join(dir, 'report.md'), md);
    console.log(md);
    console.error(`\nSaved in ${dir}`);
  } finally {
    stop();
  }
}

if (!existsSync(join(ROOT, 'node_modules/playwright'))) throw new Error('Install the dev dependencies first (npm install)');
await main();
