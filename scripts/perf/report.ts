// Comparing two builds: medians, a spread, and whether a difference is beyond noise (Mann–Whitney U test). Marked when
// p < 0.01 and the medians differ by 3% or more. Counts that are the same every run are compared as they are.
import type { Metrics } from './measure.ts';

/** Runs of one build: scenario → step → one Metrics per run */
export type Runs = Record<string, Record<string, Metrics[]>>;

const P_LIMIT = 0.01;
const MIN_CHANGE = 0.03;
const TIMES = ['time', 'tbt', 'script', 'layout', 'style'];
// images: images still shown in the page at the end of a scenario (scenarios.ts, images)
const COUNTS = ['renders', 'mounts', 'unmounts', 'commits', 'images'];

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
function quantile(xs: number[], q: number) {
  const s = sorted(xs);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
}
export const median = (xs: number[]) => quantile(xs, 0.5);
const spread = (xs: number[]) => (quantile(xs, 0.75) - quantile(xs, 0.25)) / 2;

/** Two-sided p of the Mann–Whitney U test (normal approximation, ties corrected) */
export function mannWhitney(a: number[], b: number[]): number {
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks: number[] = Array.from({ length: all.length }, () => 0);
  let tie = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const t = j - i + 1;
    tie += t ** 3 - t;
    for (let k = i; k <= j; k++) ranks[k] = (i + j) / 2 + 1;
    i = j + 1;
  }
  const n1 = a.length;
  const n2 = b.length;
  const r1 = all.reduce((sum, x, i) => sum + (x.g === 0 ? ranks[i] : 0), 0);
  const u = r1 - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const n = n1 + n2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tie / (n * (n - 1))));
  if (!sigma) return 1;
  const z = (Math.abs(u - mu) - 0.5) / sigma;
  // Two-sided tail of the normal distribution (Abramowitz–Stegun 7.1.26 for erfc)
  const x = z / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erfc = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return Math.min(1, Math.max(0, erfc));
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en') : v.toFixed(1));
const show = (xs: number[]) => `${fmt(median(xs))} ±${fmt(spread(xs))}`;
const showCount = (xs: number[]) => (Math.min(...xs) === Math.max(...xs) ? Math.round(xs[0]).toLocaleString('en') : `${Math.round(Math.min(...xs)).toLocaleString('en')}–${Math.round(Math.max(...xs)).toLocaleString('en')}`);

/** One value compared: the mark and the change, when it is beyond noise */
function compare(a: number[], b: number[], isCount: boolean): { mark: string; diff: string } {
  const ma = median(a);
  const mb = median(b);
  const change = ma ? (mb - ma) / ma : 0;
  const steady = isCount && Math.min(...a) === Math.max(...a) && Math.min(...b) === Math.max(...b);
  if (steady) return ma === mb ? { mark: '', diff: '' } : { mark: mb < ma ? '🟢' : '🔴', diff: `${mb > ma ? '+' : ''}${Math.round(mb - ma).toLocaleString('en')} (${(change * 100).toFixed(1)}%)` };
  const p = mannWhitney(a, b);
  if (p >= P_LIMIT || Math.abs(change) < MIN_CHANGE) return { mark: '', diff: '' };
  return { mark: mb < ma ? '🟢' : '🔴', diff: `${(change * 100).toFixed(1)}% (p=${p.toFixed(3)})` };
}

const values = (runs: Metrics[], key: string) => runs.map((m) => m[key]).filter((v) => typeof v === 'number');

/** The report in Markdown: base against head, or head alone (base null) */
export function report(o: { base: Runs | null; head: Runs; labels: Record<string, string>; title: string }): string {
  const lines = [`## ${o.title}`, ''];
  for (const [scenario, steps] of Object.entries(o.head)) {
    lines.push(`### ${o.labels[scenario] ?? scenario}`, '');
    for (const [step, headRuns] of Object.entries(steps)) {
      const baseRuns = o.base?.[scenario]?.[step];
      lines.push(`**${step}**`, '');
      lines.push(baseRuns ? '| | base | head | | |' : '| | head |', baseRuns ? '| --- | ---: | ---: | :---: | ---: |' : '| --- | ---: |');
      for (const key of [...TIMES, ...COUNTS, 'heap']) {
        const h = values(headRuns, key);
        if (!h.length) continue;
        const isCount = COUNTS.includes(key);
        const label = isCount ? key : key === 'heap' ? 'heap (MB)' : `${key} (ms)`;
        const cell = (xs: number[]) => (isCount ? showCount(xs) : show(xs));
        if (!baseRuns) {
          lines.push(`| ${label} | ${cell(h)} |`);
          continue;
        }
        const b = values(baseRuns, key);
        const c = compare(b, h, isCount);
        lines.push(`| ${label} | ${cell(b)} | ${cell(h)} | ${c.mark} | ${c.diff} |`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
