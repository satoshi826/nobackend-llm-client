// The flows npm run e2e runs (run.ts), each in a fresh browser context on the production build with mock providers.
// They find things the way a user does: by role and visible (English) label.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';

export interface FlowContext {
  page: Page;
  /** The app's address */
  url: string;
  /** Another browser that has never opened the app, watched like the first */
  newContext(): Promise<BrowserContext>;
  /** A folder for downloads, removed after the run */
  tmp: string;
}

export interface Flow {
  name: string;
  label: string;
  run(c: FlowContext): Promise<void>;
}

/** Waits until check() returns a truthy value; fails with what it waited for */
async function until<T>(what: string, check: () => Promise<T> | T, timeout = 10_000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const vault = (page: Page, title: string) => page.frameLocator(`iframe[title="${title}"]`);

/** First run: choose Venice, save the mock key in the key vault, and skip the passphrase */
async function addVenice(page: Page) {
  await page.getByRole('button', { name: /Venice\.ai/ }).click();
  const keys = vault(page, 'Key settings');
  await keys.getByRole('textbox').fill('mock-key');
  await keys.getByRole('button', { name: /save/i }).click();
  await page.getByRole('button', { name: 'Later' }).click();
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' });

/** Sends a message (once the Send button is enabled: the model list has arrived), and waits until it is shown */
async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('[data-message-id]').filter({ hasText: text }).first().waitFor();
}

/** The reply has ended and is saved (the composer's Stop button turns back into Send) */
const settled = (page: Page) => page.getByRole('button', { name: 'Stop' }).waitFor({ state: 'detached' });

/** The mock's plain answer to a message (scripts/mock-venice.mjs), complete */
const answer = (page: Page, message: string) => page.locator('[data-message-id]').filter({ hasText: 'モック応答' }).filter({ hasText: message }).getByText('temperature');

const chat: Flow = {
  name: 'chat',
  label: 'first run → Venice key in the vault → a streamed answer → still there after a reload',
  async run({ page, url }) {
    await page.goto(url);
    await addVenice(page);
    const message = 'Hello from the e2e test';
    await send(page, message);
    // Streamed: the answer is seen growing before it is complete
    const lengths = new Set<number>();
    const reply = page.locator('[data-message-id]').filter({ hasText: 'モック応答' });
    await until('the answer to stream to its end', async () => {
      const text = (await reply.count()) ? await reply.first().innerText() : '';
      if (text) lengths.add(text.length);
      return text.includes('temperature');
    });
    if (lengths.size < 3) throw new Error(`The answer did not stream (seen at ${lengths.size} lengths)`);
    await settled(page);
    await page.reload();
    await answer(page, message).waitFor();
  }
};

/** A provider, and a conversation with one complete answer */
async function conversation(page: Page, url: string, message: string) {
  await page.goto(url);
  await addVenice(page);
  await send(page, message);
  await answer(page, message).waitFor();
  await settled(page);
}

/** Whether any record in the page's IndexedDB databases holds the text as it is */
const stored = (page: Page, text: string) =>
  page.evaluate(async (text) => {
    const read = (db: IDBDatabase, name: string) =>
      new Promise<unknown[]>((ok, fail) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => ok(r.result);
        r.onerror = () => fail(r.error);
      });
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((ok, fail) => {
        const r = indexedDB.open(name!);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => fail(r.error);
      });
      for (const store of db.objectStoreNames) if (JSON.stringify(await read(db, store)).includes(text)) return `${name}/${store}`;
      db.close();
    }
    return null;
  }, text);

async function openSettings(page: Page, tab: string) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: tab }).click();
}

const lock: Flow = {
  name: 'lock',
  label: 'set a passphrase → reload → locked → unlock → the conversation is readable',
  async run({ page, url }) {
    const message = 'A conversation to encrypt';
    await conversation(page, url, message);
    // So that not finding it later means it is encrypted
    if (!(await stored(page, message))) throw new Error('The unencrypted conversation is not found in IndexedDB');
    await openSettings(page, 'Connections and keys');
    const security = vault(page, 'Key protection');
    const passphrase = `e2e-${randomUUID()}`;
    await security.getByLabel('Passphrase', { exact: true }).fill(passphrase);
    await security.getByLabel('Passphrase (confirm)').fill(passphrase);
    await security.getByRole('button', { name: 'Set passphrase' }).click();
    await security.getByText('encrypted with your passphrase (unlocked)').waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Locked' }).waitFor();
    if (await page.getByText(message).count()) throw new Error('The conversation shows while locked');
    const plain = await stored(page, message);
    if (plain) throw new Error(`The conversation is stored unencrypted (${plain})`);
    const unlock = vault(page, 'Unlock');
    await unlock.getByLabel('Passphrase').fill(passphrase);
    await unlock.getByRole('button', { name: 'Unlock' }).click();
    await answer(page, message).waitFor();
  }
};

async function exportBackup(page: Page, file: string) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  await (await download).saveAs(file);
  return readFileSync(file, 'utf8');
}

/** Imports a backup in Settings → Privacy and data (asking for its password when it has one) */
async function importBackup(page: Page, file: string, password?: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles(file);
  if (password) {
    await page.getByLabel('Backup password').fill(password);
    await page.getByRole('button', { name: 'Decrypt and import' }).click();
  }
  await page.getByText(/^Imported conversations: 1\b/).waitFor();
}

/** The imported conversation with its answer, once the key is entered again (backups hold no keys) */
async function restored(page: Page, message: string) {
  await page.keyboard.press('Escape');
  await page.getByText(message, { exact: true }).first().click();
  await addVenice(page);
  await answer(page, message).waitFor();
}

const backup: Flow = {
  name: 'backup',
  label: 'export a backup, plain and encrypted → import each into an empty app → the conversation is back',
  async run({ page, url, newContext, tmp }) {
    const message = 'A conversation to back up';
    await conversation(page, url, message);
    await openSettings(page, 'Privacy and data');
    const plainFile = join(tmp, 'backup.json');
    if (!(await exportBackup(page, plainFile)).includes(message)) throw new Error('The plain backup does not hold the conversation');
    const password = `e2e-${randomUUID()}`;
    await page.getByRole('switch', { name: /Encrypt the export/ }).check();
    await page.getByLabel('Backup password', { exact: true }).fill(password);
    await page.getByLabel('Backup password (confirm)').fill(password);
    const encryptedFile = join(tmp, 'backup-encrypted.json');
    if ((await exportBackup(page, encryptedFile)).includes(message)) throw new Error('The encrypted backup holds the conversation as plain text');

    // The plain one in a browser that has never opened the app
    const other = await (await newContext()).newPage();
    await other.goto(url);
    await openSettings(other, 'Privacy and data');
    await importBackup(other, plainFile);
    await restored(other, message);
    await other.close();

    // The encrypted one here, after deleting everything
    await page.getByRole('button', { name: 'Delete all data' }).click();
    const confirm = page.getByRole('alertdialog');
    // Typed once the dialog has focused its field (opening it clears the field)
    await until('the confirmation field to be focused', () => confirm.getByRole('textbox').evaluate((e) => e === document.activeElement));
    await confirm.getByRole('textbox').fill('delete');
    await confirm.getByRole('button', { name: 'Delete everything' }).click();
    await page.getByText('Add your first provider').waitFor();
    await openSettings(page, 'Privacy and data');
    await importBackup(page, encryptedFile, password);
    await restored(page, message);
  }
};

const files: Flow = {
  name: 'files',
  label: 'a model writes an HTML page with a tool → open it from the Files tab → its script runs in the sandbox',
  async run({ page, url }) {
    await page.goto(url);
    await addVenice(page);
    // The mock answers this with write_file: a counter page
    await send(page, 'ページを作って');
    await page.getByText('counter-page/counter.html').first().waitFor();
    await settled(page);
    await page.getByRole('tab', { name: 'Files' }).click();
    await page.getByRole('main').getByText('counter-page').dblclick();
    await page.getByRole('main').getByText('counter.html').dblclick();
    const preview = page.frameLocator('iframe[src*="/sandbox/"]');
    await preview.getByRole('heading', { name: 'Counter' }).waitFor();
    await preview.getByRole('button', { name: '+1' }).click();
    await preview.getByRole('button', { name: '+1' }).click();
    await preview.getByText('2', { exact: true }).waitFor();
  }
};

const images: Flow = {
  name: 'images',
  label: 'image mode with the mock image model → the generated image shows',
  async run({ page, url }) {
    await page.goto(url);
    await addVenice(page);
    await page.getByRole('button', { name: 'Image', exact: true }).click();
    await page.getByRole('combobox').filter({ hasText: 'Mock Image Flux' }).first().waitFor();
    const prompt = 'A lighthouse at dawn';
    await page.getByPlaceholder('Describe the image').fill(prompt);
    await page.getByRole('button', { name: 'Send' }).click();
    // The mock's PNG, decoded and drawn
    const image = page.locator('[data-message-id] img').first();
    await image.waitFor();
    await until('the image to load', () => image.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0));
  }
};

const fetchPage: Flow = {
  name: 'fetch-page',
  label: 'the fetch page (its own page and CSP) opens from Settings → Web and closes',
  async run({ page, url }) {
    await page.goto(url);
    await addVenice(page);
    await openSettings(page, 'Web');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    const fetchSettings = page.frameLocator('iframe[title="Fetch page settings"]');
    await fetchSettings.getByText('Jina Reader', { exact: true }).waitFor();
    await fetchSettings.getByRole('button', { name: 'Close' }).click();
    await page.locator('iframe[title="Fetch page settings"]').waitFor({ state: 'detached' });
  }
};

export const FLOWS: Flow[] = [chat, lock, backup, files, images, fetchPage];
