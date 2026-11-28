// What a measurement does: each scenario seeds its data (not measured), then measures its steps in order.
// `ready` conditions run in the page; they look at what is on screen (data-message-id, data-entry).
import type { Probe, Metrics } from './measure.ts';

/** The data every scenario starts from (src/perf/index.ts seed) */
export const SEED = { conversations: 150, longMessages: 300, files: 2000, folders: 20, images: 40 };
/** Many conversations, with the files spread over them */
export const SEED_MANY = { ...SEED, conversations: 5000, filesInConversations: true };
const LAST_MESSAGE = `perf-long-${SEED.longMessages - 1}`;

export interface Scenario {
  name: string;
  label: string;
  run(probe: Probe, base: string, cpu: number): Promise<Record<string, Metrics>>;
}

/** Open the app with an empty database, fill it, and slow the CPU for what follows */
async function prepare(probe: Probe, base: string, cpu: number, seed: object = SEED) {
  await probe.page.goto(`${base}/`);
  await probe.page.waitForFunction(() => !!(window as unknown as { __perf?: unknown }).__perf, undefined, { timeout: 60_000 });
  await probe.page.evaluate((spec) => (window as unknown as { __perf: { seed(s: unknown): Promise<void> } }).__perf.seed(spec), seed);
  // Leave the page, so the next step opens the app anew (a change of the hash alone would not reload it)
  await probe.page.goto('about:blank');
  await probe.throttle(cpu);
}

const shown = (id: string) => `!!document.querySelector('[data-message-id="${id}"]')`;
type Tools = { __perf: { touch(id: string): void; openModels(): void; settingsTab(tab: string): void; addFiles(n: number): Promise<void>; encrypt(): Promise<void>; seed(s: unknown): Promise<void>; search(q: string): Promise<number> } };
const touch = (probe: Probe, id: string) => probe.page.evaluate((x) => (window as unknown as Tools).__perf.touch(x), id);
const entries = () => `document.querySelectorAll('[data-entry]').length`;
const MODELS = 600;
const modelRows = () => `document.querySelectorAll('[role="dialog"] li').length`;

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
  },
  {
    name: 'many',
    label: `Many conversations (${SEED_MANY.conversations}) with ${SEED_MANY.files} files spread over them`,
    async run(probe, base, cpu) {
      await prepare(probe, base, cpu, SEED_MANY);
      const out: Record<string, Metrics> = {};
      out.open = await probe.load(`${base}/#/c/perf-long`, shown(LAST_MESSAGE));
      out.switch = await probe.action(() => probe.page.getByRole('button', { name: 'Conversation 0', exact: true }).first().click(), shown('perf-c0-a'));
      // A message sent in an old conversation moves it to the top
      out.send = await probe.action(() => touch(probe, 'perf-c4000'), 'true');
      out.files = await probe.action(() => probe.page.evaluate(() => (location.hash = '#/files?type=text')), `${entries()} >= 60`);
      // The same while the Files tab is open: its rows show conversation names
      out.sendInFiles = await probe.action(() => touch(probe, 'perf-c3000'), 'true');
      // 50 files saved one after another (each save announces a change)
      out.addFiles = await probe.action(
        () => probe.page.evaluate(() => (window as unknown as Tools).__perf.addFiles(50)),
        'true'
      );
      out.heap = { heap: await probe.heap() };
      return out;
    }
  },
  {
    name: 'search',
    label: 'Full-text search with a passphrase (5000 conversations, 10,000 messages)',
    async run(probe, base, cpu) {
      // In one page: the data key lives only in the page, as after unlocking
      await probe.page.goto(`${base}/`);
      await probe.page.waitForFunction(() => !!(window as unknown as { __perf?: unknown }).__perf, undefined, { timeout: 60_000 });
      await probe.page.evaluate(async () => {
        const { __perf } = window as unknown as Tools;
        await __perf.encrypt();
        await __perf.seed({ conversations: 5000 });
      });
      await probe.throttle(cpu);
      const search = (q: string) => () => probe.page.evaluate((x) => (window as unknown as Tools).__perf.search(x), q);
      const out: Record<string, Metrics> = {};
      // The first search decrypts every message; later ones read what it kept
      out.first = await probe.action(search('step 4321'), 'true');
      out.again = await probe.action(search('step 1234'), 'true');
      // Found nowhere: every message is looked at
      out.none = await probe.action(search('no such words'), 'true');
      out.heap = { heap: await probe.heap() };
      return out;
    }
  }
,
  {
    name: 'models',
    label: `Model picker (${MODELS} models)`,
    async run(probe, base, cpu) {
      await prepare(probe, base, cpu, { ...SEED, conversations: 3, longMessages: 0, files: 0, images: 0, models: MODELS });
      await probe.page.goto(`${base}/#/c/perf-c0`);
      await probe.page.waitForFunction(shown('perf-c0-a'), undefined, { timeout: 60_000 });
      const out: Record<string, Metrics> = {};
      out.open = await probe.action(() => probe.page.evaluate(() => (window as unknown as Tools).__perf.openModels()), `${modelRows()} >= 20`);
      // A search typed one key at a time, as a person types it
      out.search = await probe.action(async () => {
        await probe.page.locator('[role="dialog"] input').first().click();
        await probe.page.keyboard.type('model 12');
      }, `${modelRows()} > 0 && ${modelRows()} < ${MODELS}`);
      await probe.page.locator('[role="dialog"] input').first().fill('');
      // Down to the end of the list, a screenful at a time
      out.scroll = await probe.action(async () => {
        for (let i = 0; i < 200; i++) {
          const done = await probe.page.evaluate(() => {
            const area = document.querySelector('[role="dialog"] li')?.closest('.overflow-y-auto') as HTMLElement | null;
            if (!area) return false;
            area.scrollBy(0, area.clientHeight);
            return area.scrollTop + area.clientHeight >= area.scrollHeight - 2;
          });
          if (done) break;
          await probe.page.waitForTimeout(50);
        }
      }, 'true');
      out.heap = { heap: await probe.heap() };
      return out;
    }
  },
  {
    name: 'usage',
    label: 'Usage tab (20,000 requests over a year)',
    async run(probe, base, cpu) {
      await prepare(probe, base, cpu, { conversations: 3, usage: 20_000 });
      await probe.page.goto(`${base}/#/c/perf-c0`);
      await probe.page.waitForFunction(shown('perf-c0-a'), undefined, { timeout: 60_000 });
      const out: Record<string, Metrics> = {};
      const table = `document.querySelectorAll('[role="dialog"] tbody tr').length`;
      out.open = await probe.action(() => probe.page.evaluate(() => (window as unknown as Tools).__perf.settingsTab('usage')), `${table} > 0`);
      out.all = await probe.action(() => probe.page.locator('[role="dialog"]').getByText('All', { exact: true }).first().click(), `${table} > 0 && !document.querySelector('[role="dialog"]')?.textContent?.includes('Loading')`);
      out.heap = { heap: await probe.heap() };
      return out;
    }
  },
  {
    name: 'skills',
    label: 'Skills (300 of the user\'s own)',
    async run(probe, base, cpu) {
      await prepare(probe, base, cpu, { conversations: 3, skills: 300 });
      await probe.page.goto(`${base}/#/c/perf-c0`);
      await probe.page.waitForFunction(shown('perf-c0-a'), undefined, { timeout: 60_000 });
      const out: Record<string, Metrics> = {};
      // The menu by the input box, as a person opens it to attach one
      out.menu = await probe.action(() => probe.page.getByRole('button', { name: 'Skills', exact: true }).first().click(), `document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemcheckbox"]').length > 0`);
      await probe.page.keyboard.press('Escape');
      out.tab = await probe.action(() => probe.page.evaluate(() => (window as unknown as Tools).__perf.settingsTab('skills')), `document.body.textContent.includes('skill-299')`);
      out.heap = { heap: await probe.heap() };
      return out;
    }
  },
  {
    name: 'imagePage',
    label: 'An image among 1,500, and the next ones',
    async run(probe, base, cpu) {
      await probe.page.goto(`${base}/`);
      await probe.page.waitForFunction(() => !!(window as unknown as { __perf?: unknown }).__perf, undefined, { timeout: 60_000 });
      await probe.page.evaluate(() => (window as unknown as Tools).__perf.seed({ images: 1500 }));
      await probe.page.goto('about:blank');
      await probe.page.goto(`${base}/#/files?type=image`);
      await probe.page.waitForFunction(`${entries()} >= 30`, undefined, { timeout: 60_000 });
      await probe.throttle(cpu);
      const out: Record<string, Metrics> = {};
      const img = `document.querySelector('main img, [data-image-page] img')`;
      out.open = await probe.action(() => probe.page.locator('[data-entry] img').first().click(), `!document.querySelector('[data-entry]') && !!document.querySelector('img')`);
      out.next = await probe.action(async () => {
        for (let i = 0; i < 10; i++) await probe.page.getByRole('button', { name: 'Next image', exact: true }).click();
      }, `!!${img} || !!document.querySelector('img')`);
      out.heap = { heap: await probe.heap() };
      return out;
    }
  },
  {
    name: 'images',
    label: 'Scrolling through 1,500 images with a passphrase',
    async run(probe, base, cpu) {
      await probe.page.goto(`${base}/`);
      await probe.page.waitForFunction(() => !!(window as unknown as { __perf?: unknown }).__perf, undefined, { timeout: 60_000 });
      await probe.page.evaluate(async () => {
        const { __perf } = window as unknown as Tools;
        await __perf.encrypt();
        await __perf.seed({ images: 1500 });
      });
      await probe.throttle(cpu);
      const out: Record<string, Metrics> = {};
      out.open = await probe.action(() => probe.page.evaluate(() => (location.hash = '#/files?type=image')), `${entries()} >= 30`);
      // Down to the end, a screenful at a time, as a person scrolls
      out.scroll = await probe.action(async () => {
        for (let i = 0; i < 400; i++) {
          const done = await probe.page.evaluate(() => {
            const area = document.querySelector('[data-entry]')?.closest('.overflow-y-auto') as HTMLElement | null;
            if (!area) return false;
            area.scrollBy(0, area.clientHeight);
            return area.scrollTop + area.clientHeight >= area.scrollHeight - 2 && document.querySelectorAll('[data-entry]').length >= 1500;
          });
          if (done) break;
          await probe.page.waitForTimeout(50);
        }
      }, `${entries()} >= 1500`);
      // What stays loaded at the end: images shown in the page, and the JS heap
      await probe.page.waitForTimeout(1000);
      out.kept = { images: await probe.page.evaluate(() => [...document.querySelectorAll('[data-entry] img')].filter((i) => (i as HTMLImageElement).src).length) };
      out.heap = { heap: await probe.heap() };
      return out;
    }
  }
];
