// What a measurement does: each scenario seeds its data (not measured), then measures its steps in order.
// `ready` conditions run in the page; they look at what is on screen (data-message-id, data-entry).
import type { Probe, Metrics } from './measure.ts';

/** The data every scenario starts from (src/perf/index.ts seed) */
export const SEED = { conversations: 150, longMessages: 300, files: 2000, folders: 20, images: 40 };
const LAST_MESSAGE = `perf-long-${SEED.longMessages - 1}`;

export interface Scenario {
  name: string;
  label: string;
  run(probe: Probe, base: string, cpu: number): Promise<Record<string, Metrics>>;
}

/** Open the app with an empty database, fill it, and slow the CPU for what follows */
async function prepare(probe: Probe, base: string, cpu: number) {
  await probe.page.goto(`${base}/`);
  await probe.page.waitForFunction(() => !!(window as unknown as { __perf?: unknown }).__perf, undefined, { timeout: 60_000 });
  await probe.page.evaluate((spec) => (window as unknown as { __perf: { seed(s: unknown): Promise<void> } }).__perf.seed(spec), SEED);
  // Leave the page, so the next step opens the app anew (a change of the hash alone would not reload it)
  await probe.page.goto('about:blank');
  await probe.throttle(cpu);
}

const shown = (id: string) => `!!document.querySelector('[data-message-id="${id}"]')`;
const entries = () => `document.querySelectorAll('[data-entry]').length`;

export const SCENARIOS: Scenario[] = [
  {
    name: 'chat',
    label: `Chat (a conversation of ${SEED.longMessages} messages)`,
    async run(probe, base, cpu) {
      await prepare(probe, base, cpu);
      const out: Record<string, Metrics> = {};
      out.open = await probe.load(`${base}/#/c/perf-long`, shown(LAST_MESSAGE));
      // An answer written again, 1,200 pieces of text, 3 a frame, through the app's own updates
      out.stream = await probe.action(
        () => probe.page.evaluate(() => (window as unknown as { __perf: { stream(o: unknown): Promise<void> } }).__perf.stream({ tokens: 1200, perFrame: 3 })),
        'true'
      );
      const text = 'Typing a question of a usual length into the input box, one key at a time.';
      out.type = await probe.action(async () => {
        await probe.page.locator('textarea').first().click();
        await probe.page.keyboard.type(text);
      }, `document.querySelector('textarea')?.value.length === ${text.length}`);
      out.heap = { heap: await probe.heap() };
      return out;
    }
  },
  {
    name: 'switch',
    label: 'Switching conversations',
    async run(probe, base, cpu) {
      await prepare(probe, base, cpu);
      await probe.load(`${base}/#/c/perf-long`, shown(LAST_MESSAGE));
      const out: Record<string, Metrics> = {};
      // To a short one and back to the long one, through the sidebar
      out.toShort = await probe.action(() => probe.page.getByRole('button', { name: 'Conversation 0', exact: true }).first().click(), shown('perf-c0-a'));
      out.toLong = await probe.action(() => probe.page.getByRole('button', { name: 'Long conversation', exact: true }).first().click(), shown(LAST_MESSAGE));
      return out;
    }
  },
  {
    name: 'files',
    label: `Files tab (${SEED.files} files)`,
    async run(probe, base, cpu) {
      await prepare(probe, base, cpu);
      const out: Record<string, Metrics> = {};
      // Ready when a screenful shows (an app that draws every entry first is ready only after all of them)
      out.open = await probe.load(`${base}/#/files?type=text`, `${entries()} >= 60`);
      // Pick five entries one by one (their check boxes show on hover; clicked directly)
      out.select = await probe.action(async () => {
        const boxes = probe.page.locator('[data-entry] input[type="checkbox"]');
        for (let i = 0; i < 5; i++) await boxes.nth(i).click({ force: true });
      }, `document.querySelectorAll('[data-entry] input[type="checkbox"]:checked').length === 5`);
      await probe.page.keyboard.press('Escape');
      out.search = await probe.action(() => probe.page.getByRole('textbox').first().fill('notes-17'), `${entries()} < ${SEED.files} && ${entries()} > 0`);
      await probe.page.getByRole('textbox').first().fill('');
      // Into a folder, as a link in the app does (the hash changes; the app does not reload)
      out.folder = await probe.action(
        () => probe.page.evaluate(() => (location.hash = '#/files/folder-3/')),
        `${entries()} >= ${SEED.files / SEED.folders}`
      );
      out.heap = { heap: await probe.heap() };
      return out;
    }
  }
];
