// One measurement in a browser page: the time a step takes until the page is ready, and what the page did for it
// until it settled (CPU time by kind, blocking time, Preact's rendering work). Counting in the page is the app's own
// perf mode (src/perf/counter.ts), switched on by setting window.__PERF__ before it loads.
import type { CDPSession, Page } from 'playwright';

/** Values of one step: 'time' and the rest, in ms or counts */
export type Metrics = Record<string, number>;

const TIMEOUT = 120_000;
/** Settled: no long task for this long after the page is ready */
const QUIET_MS = 1000;
/** CDP Performance.getMetrics durations (seconds) taken before and after a step */
const DURATIONS = { script: 'ScriptDuration', layout: 'LayoutDuration', style: 'RecalcStyleDuration' } as const;

type PageCounts = { renders: number; mounts: number; unmounts: number; commits: number };
type Activity = { longTasks: [start: number, duration: number][]; lastActivity: number };

/** Runs in the page before the app: perf mode on, and long tasks recorded */
function setUp() {
  const w = window as unknown as { __PERF__: boolean; __perfActivity: Activity };
  w.__PERF__ = true;
  const activity: Activity = { longTasks: [], lastActivity: 0 };
  w.__perfActivity = activity;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      activity.longTasks.push([e.startTime, e.duration]);
      activity.lastActivity = Math.max(activity.lastActivity, e.startTime + e.duration);
    }
  }).observe({ type: 'longtask', buffered: true });
}

export class Probe {
  readonly page: Page;
  private readonly cdp: CDPSession;
  private constructor(page: Page, cdp: CDPSession) {
    this.page = page;
    this.cdp = cdp;
  }

  /** Call on a fresh page, before it opens anything */
  static async attach(page: Page): Promise<Probe> {
    await page.addInitScript(`(${setUp})()`);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    return new Probe(page, cdp);
  }

  /** Slow the CPU down (1: full speed). Measurements run slowed, so differences show; setting data up does not */
  async throttle(rate: number) {
    await this.cdp.send('Emulation.setCPUThrottlingRate', { rate });
  }

  /** Open a URL; the step ends when `ready` (run in the page) is true */
  load(url: string, ready: string): Promise<Metrics> {
    return this.measure(
      async () => {
        await this.page.goto(url, { waitUntil: 'commit' });
        return 0;
      },
      ready,
      true
    );
  }

  /** Do something in the page (through Playwright); the step ends when `ready` is true */
  action(act: () => Promise<unknown>, ready: string): Promise<Metrics> {
    return this.measure(
      async () => {
        const start = await this.page.evaluate(() => performance.now());
        await act();
        return start;
      },
      ready,
      false
    );
  }

  /** The JS heap after a garbage collection, in MB */
  async heap(): Promise<number> {
    await this.cdp.send('HeapProfiler.collectGarbage');
    return (await this.cdpMetrics()).JSHeapUsedSize / 1024 / 1024;
  }

  private async cdpMetrics(): Promise<Record<string, number>> {
    const { metrics } = (await this.cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] };
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  }

  private counts(): Promise<PageCounts> {
    return this.page.evaluate(() => {
      const c = (window as unknown as { __perfCounts?: PageCounts }).__perfCounts;
      return { renders: c?.renders ?? 0, mounts: c?.mounts ?? 0, unmounts: c?.unmounts ?? 0, commits: c?.commits ?? 0 };
    });
  }

  /**
   * time: from the start until ready. The rest: until the page settled after it (no long task for QUIET_MS), so work
   * that goes on after the screen is ready (thumbnails, highlighting) counts the same way each time
   */
  private async measure(begin: () => Promise<number>, ready: string, opens: boolean): Promise<Metrics> {
    const before = await this.cdpMetrics();
    // A page that is opened starts counting from zero; an action starts from where the page is
    const countsBefore = opens ? { renders: 0, mounts: 0, unmounts: 0, commits: 0 } : await this.counts();
    const start = await begin();
    await this.page.waitForFunction(ready, undefined, { timeout: TIMEOUT, polling: 'raf' });
    const readyAt = await this.page.evaluate(() => performance.now());
    // Settle
    await this.page.waitForFunction(
      `(() => { const a = window.__perfActivity; return performance.now() - Math.max(a.lastActivity, ${readyAt}) > ${QUIET_MS}; })()`,
      undefined,
      { timeout: TIMEOUT, polling: 100 }
    );
    const after = await this.cdpMetrics();
    const countsAfter = await this.counts();
    const tbt = await this.page.evaluate(
      (from) => (window as unknown as { __perfActivity: Activity }).__perfActivity.longTasks.filter(([s]) => s >= from).reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0),
      start
    );
    const out: Metrics = { time: readyAt - start, tbt };
    for (const [key, name] of Object.entries(DURATIONS)) out[key] = (after[name] - before[name]) * 1000;
    for (const key of ['renders', 'mounts', 'unmounts', 'commits'] as const) out[key] = countsAfter[key] - countsBefore[key];
    return out;
  }
}
