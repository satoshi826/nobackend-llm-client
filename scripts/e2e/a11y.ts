// Accessibility checks for npm run e2e (run.ts): axe-core's WCAG 2.0 and 2.1 A and AA rules (names of controls and
// fields, contrast, roles, …) on a screen a flow reached, at the desktop and the phone size, its frames included
// (the key vault's, the fetch page's) but not the sandbox (it shows a model's page, not ours).
//
// A serious or critical finding fails the flow unless a11y-allowed.json lists it: its rule, a piece of its element
// (target or HTML; an attribute or text that stays, not a utility class) and why it is there for now. Moderate and
// minor findings, and what axe could not decide (contrast over an image or a gradient), go only to the report.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import type axe from 'axe-core';
import type { Page } from 'playwright';

export interface Finding {
  screen: string;
  /** The viewport width it was found at */
  width: number;
  rule: string;
  impact: string;
  /** axe's selector of the element; for one in a frame, the frame's first, joined by " >> " */
  target: string;
  html: string;
  /** What axe says is wrong, first line */
  summary: string;
  /** axe could not tell whether the rule is met (it says why in the summary) */
  undecided: boolean;
}

interface Allowed {
  rule: string;
  /** Found in the finding's target or HTML */
  element: string;
  reason: string;
}

const SIZES = [
  { width: 1280, height: 860 },
  { width: 375, height: 812 }
];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const FAILING = new Set(['serious', 'critical']);
const ALLOWED_FILE = join(import.meta.dirname, 'a11y-allowed.json');
const allowedList: Allowed[] = JSON.parse(readFileSync(ALLOWED_FILE, 'utf8'));
const SANDBOX = 'iframe[src*="/sandbox/"]';

/** Once nothing moves: a check during a transition reads half-faded colours. Endless animations (spinners) are left */
const still = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {}))
    )
  );

/** The colour most of a PNG is: each channel's median, worked out in a blank page (which has no CSP) */
async function commonColour(page: Page, png: Buffer): Promise<string> {
  const blank = await page.context().newPage();
  try {
    return await blank.evaluate(async (b64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const g = canvas.getContext('2d')!;
      g.drawImage(bitmap, 0, 0);
      const { data } = g.getImageData(0, 0, bitmap.width, bitmap.height);
      const median = (c: number) => {
        const v: number[] = [];
        for (let i = c; i < data.length; i += 4) v.push(data[i]);
        return v.sort((a, b) => a - b)[v.length >> 1];
      };
      return `rgb(${median(0)}, ${median(1)}, ${median(2)})`;
    }, png.toString('base64'));
  } finally {
    await blank.close();
  }
}

/**
 * The key vault's and the fetch page's documents are transparent over the app, and axe, inside them, takes white for
 * what is behind. For the check, each such frame gets the colour the app shows behind it (the frame hidden, from a
 * screenshot). Returns how to take it off again
 */
async function backFrames(page: Page): Promise<() => Promise<unknown>> {
  const undo: (() => Promise<unknown>)[] = [];
  const viewport = page.viewportSize()!;
  for (const frame of page.mainFrame().childFrames()) {
    const element = await frame.frameElement();
    if (await element.evaluate((e: Element, sandbox) => e.matches(sandbox), SANDBOX)) continue;
    // A frame below the fold (the key vault's at the phone size) is checked too: what is behind it is read in view
    await element.scrollIntoViewIfNeeded();
    const box = await element.boundingBox();
    if (!box) continue;
    // The part in the viewport
    const x = Math.max(box.x, 0);
    const y = Math.max(box.y, 0);
    const clip = { x, y, width: Math.min(box.x + box.width, viewport.width) - x, height: Math.min(box.y + box.height, viewport.height) - y };
    if (clip.width < 1 || clip.height < 1) continue;
    await element.evaluate((e: HTMLElement) => (e.style.visibility = 'hidden'));
    const shot = await page.screenshot({ clip });
    await element.evaluate((e: HTMLElement) => (e.style.visibility = ''));
    const behind = await commonColour(page, shot);
    const before = await frame.evaluate((c) => {
      const s = document.documentElement.style;
      const was = s.backgroundColor;
      s.backgroundColor = c;
      return was;
    }, behind);
    undo.push(() => frame.evaluate((c) => (document.documentElement.style.backgroundColor = c), before).catch(() => {}));
  }
  return () => Promise.all(undo.map((u) => u()));
}

/** The screen's findings at each size; the page is back at the desktop size after */
export async function check(page: Page, screen: string): Promise<Finding[]> {
  const found: Finding[] = [];
  const add = (width: number, results: axe.Result[], undecided: boolean) => {
    for (const r of results)
      for (const n of r.nodes)
        found.push({
          screen,
          width,
          rule: r.id,
          impact: n.impact ?? r.impact ?? 'unknown',
          target: n.target.map((t) => (Array.isArray(t) ? t.join(' ') : t)).join(' >> '),
          html: n.html.slice(0, 200),
          summary: (n.failureSummary ?? r.help).replace(/^Fix (any|all) of the following:\s*/, '').split('\n')[0].trim(),
          undecided
        });
  };
  // Off any tooltip
  await page.mouse.move(0, 0);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await still(page);
    const unback = await backFrames(page);
    const { violations, incomplete } = await new AxeBuilder({ page }).withTags(TAGS).exclude(SANDBOX).analyze();
    await unback();
    add(size.width, violations, false);
    add(size.width, incomplete, true);
  }
  await page.setViewportSize(SIZES[0]);
  return found;
}

const matches = (a: Allowed, f: Finding) => a.rule === f.rule && (f.target.includes(a.element) || f.html.includes(a.element));
const allowance = (f: Finding) => allowedList.find((a) => matches(a, f));

export const failing = (f: Finding) => !f.undecided && FAILING.has(f.impact) && !allowance(f);

export const describe = (f: Finding) => `${f.impact} ${f.rule} on ${f.target} (${f.screen}, ${f.width} px): ${f.summary}`;

/**
 * Writes every finding to the report, and returns the lines to print: the count by impact, and, when every flow ran,
 * the allowed findings no longer seen (to take out of a11y-allowed.json)
 */
export function report(all: Finding[], file: string, allFlows: boolean): string[] {
  const findings = all.filter((f) => !f.undecided);
  const undecided = all.filter((f) => f.undecided);
  const stale = allFlows ? allowedList.filter((a) => !findings.some((f) => matches(a, f))) : [];
  writeFileSync(file, JSON.stringify({ findings: findings.map((f) => ({ ...f, allowed: allowance(f)?.reason })), undecided, stale }, null, 2) + '\n');
  const byImpact = Object.entries(Object.groupBy(findings, (f) => f.impact)).map(([impact, fs]) => `${fs!.length} ${impact}`);
  return [
    `Accessibility: ${byImpact.join(', ') || 'no findings'} (${findings.filter((f) => allowance(f)).length} allowed), ${undecided.length} undecided. Report: ${file}`,
    ...stale.map((a) => `  no longer found, take it out of ${ALLOWED_FILE}: ${a.rule} on ${a.element}`)
  ];
}
