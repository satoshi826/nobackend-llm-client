// The flows npm run e2e runs (run.ts), each in a fresh browser context on the production build with mock providers.
// They find things the way a user does: by role and visible (English) label.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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
  /** Serves a new release in place of the one served: the same app with every file under assets/ renamed */
  deploy(): void;
  /** Runs the accessibility checks on what the page shows now (a11y.ts) */
  a11y(screen: string): Promise<void>;
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

/** First run: choose Venice, save the mock key in the key vault, and skip the passphrase; a11y, when given, checks each step */
async function addVenice(page: Page, a11y?: FlowContext['a11y']) {
  await page.getByRole('button', { name: /Venice\.ai/ }).click();
  const keys = vault(page, 'Key settings');
  await keys.getByRole('textbox').waitFor();
  await a11y?.('key entry');
  await keys.getByRole('textbox').fill('mock-key');
  await keys.getByRole('button', { name: /save/i }).click();
  await page.getByRole('button', { name: 'Later' }).waitFor();
  await a11y?.('passphrase offer');
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
  async run({ page, url, a11y }) {
    await page.goto(url);
    await page.getByRole('button', { name: /Venice\.ai/ }).waitFor();
    await a11y('first run');
    await addVenice(page, a11y);
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
    await a11y('chat with an answer');
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
  async run({ page, url, a11y }) {
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
    await vault(page, 'Unlock').getByLabel('Passphrase').waitFor();
    await a11y('locked');
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

/**
 * The imported conversation is readable before any key is entered (backups hold no keys); sending from it asks for
 * a provider and key, and the message typed is sent once they are set
 */
async function restored(page: Page, message: string) {
  await page.keyboard.press('Escape');
  await page.getByText(message, { exact: true }).first().click();
  await answer(page, message).waitFor();
  const next = 'After the restore';
  await composer(page).fill(next);
  await page.getByRole('button', { name: 'Send' }).click();
  await addVenice(page);
  if ((await composer(page).inputValue()) !== next) throw new Error('The message typed before the key was set is gone');
  await page.getByRole('button', { name: 'Send' }).click();
  await answer(page, next).waitFor();
  await settled(page);
}

const backup: Flow = {
  name: 'backup',
  label: 'export a backup, plain and encrypted → import each into an empty app → the conversation reads before a key is set, and sends once it is',
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
  async run({ page, url, a11y }) {
    await page.goto(url);
    await addVenice(page);
    // The mock answers this with write_file: a counter page
    await send(page, 'ページを作って');
    await page.getByText('counter-page/counter.html').first().waitFor();
    await settled(page);
    await page.getByRole('tab', { name: 'Files' }).click();
    await page.getByRole('main').getByText('counter-page').waitFor();
    await a11y('files tab');
    await page.getByRole('main').getByText('counter-page').dblclick();
    await page.getByRole('main').getByText('counter.html').dblclick();
    const preview = page.frameLocator('iframe[src*="/sandbox/"]');
    await preview.getByRole('heading', { name: 'Counter' }).waitFor();
    await preview.getByRole('button', { name: '+1' }).click();
    await preview.getByRole('button', { name: '+1' }).click();
    await preview.getByText('2', { exact: true }).waitFor();
    await a11y('file view');
  }
};

const images: Flow = {
  name: 'images',
  label: 'image mode with the mock image model → the generated image shows → its options → it opens in the viewer',
  async run({ page, url, a11y }) {
    await page.goto(url);
    await addVenice(page);
    await page.getByRole('button', { name: 'Image', exact: true }).click();
    await page.getByRole('button', { name: 'Image model: Mock Image Flux' }).waitFor();
    const prompt = 'A lighthouse at dawn';
    await page.getByPlaceholder('Describe the image').fill(prompt);
    await page.getByRole('button', { name: 'Send' }).click();
    // The mock's PNG, decoded and drawn
    const image = page.locator('[data-message-id] img').first();
    await image.waitFor();
    await until('the image to load', () => image.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0));
    await settled(page);
    await a11y('image answer');
    // The options open over the input box
    await page.getByRole('button', { name: /^Image settings/ }).click();
    await page.getByRole('dialog', { name: 'Image settings' }).waitFor();
    await a11y('image options');
    await page.keyboard.press('Escape');
    await image.click();
    await page.getByRole('dialog').waitFor();
    await a11y('image view');
  }
};

const settings: Flow = {
  name: 'settings',
  label: 'each Settings tab opens and passes the accessibility checks',
  async run({ page, url, a11y }) {
    await page.goto(url);
    await addVenice(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog');
    for (const name of await dialog.getByRole('tab').allInnerTexts()) {
      await dialog.getByRole('tab', { name, exact: true }).click();
      await a11y(`settings: ${name}`);
    }
  }
};

const fetchPage: Flow = {
  name: 'fetch-page',
  label: 'the fetch page (its own page and CSP) opens from Settings → Web and closes',
  async run({ page, url, a11y }) {
    await page.goto(url);
    await addVenice(page);
    await openSettings(page, 'Web');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    const fetchSettings = page.frameLocator('iframe[title="Fetch page settings"]');
    await fetchSettings.getByText('Jina Reader', { exact: true }).waitFor();
    await a11y('fetch page settings');
    await fetchSettings.getByRole('button', { name: 'Close' }).click();
    await page.locator('iframe[title="Fetch page settings"]').waitFor({ state: 'detached' });
  }
};

/**
 * A one-page PDF with a line in a standard font and a line in a Japanese font that is not embedded, whose text pdf.js
 * can only read with its character maps (UniJIS-UCS2-H, Adobe-Japan1-UCS2)
 */
function samplePdf(): string {
  const content = 'BT /F1 14 Tf 20 150 Td (Hello from a PDF) Tj ET\nBT /F2 14 Tf 20 120 Td <30533093306B3061306F> Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UCS2-H /DescendantFonts [7 0 R] >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 8 0 R >>',
    '<< /Type /FontDescriptor /FontName /HeiseiMin-W3 /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((o, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  return pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

/** Attaches the sample PDF from the device and waits until its text, both lines, is read and stored */
async function attachPdf(page: Page, tmp: string) {
  const file = join(tmp, 'sample.pdf');
  writeFileSync(file, samplePdf());
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach' }).click();
  await page.getByRole('menuitem', { name: 'From this device…' }).click();
  await (await chooser).setFiles(file);
  await page.getByRole('button', { name: 'Remove sample.pdf' }).waitFor();
  await until('the PDF text to be stored', async () => (await stored(page, 'Hello from a PDF')) && stored(page, 'こんにちは'));
}

const pdf: Flow = {
  name: 'pdf',
  label: 'attach a PDF → its text, Japanese too, is read by the PDF worker under its own CSP',
  async run({ page, url, tmp }) {
    await page.goto(url);
    await addVenice(page);
    await attachPdf(page, tmp);
  }
};

/** Controlled by the Service Worker, which has cached the build's files */
const swReady = (page: Page) => until('the Service Worker to control the page', () => page.evaluate(() => navigator.serviceWorker.ready.then(() => !!navigator.serviceWorker.controller)));

/**
 * Has the browser check for a new Service Worker now (as it does by itself now and then), and waits until it has
 * activated: done with its activate step, which comes after it takes over the page
 */
const swUpdate = (page: Page) =>
  page.evaluate(async () => {
    const reg = (await navigator.serviceWorker.getRegistration())!;
    const activated = new Promise<void>((ok) =>
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing!;
        sw.addEventListener('statechange', () => sw.state === 'activated' && ok());
      })
    );
    await reg.update();
    await Promise.race([activated, new Promise((_, fail) => setTimeout(() => fail(new Error('No new Service Worker activated')), 20_000))]);
  });

/** The files under assets/ the Service Worker has cached */
const cachedAssets = (page: Page) =>
  page.evaluate(async () => {
    const names: string[] = [];
    for (const key of await caches.keys()) for (const req of await (await caches.open(key)).keys()) if (new URL(req.url).pathname.startsWith('/assets/')) names.push(new URL(req.url).pathname);
    return names;
  });

const update: Flow = {
  name: 'update',
  label: 'a tab opened before a release still loads its build\'s later parts (code highlighting, PDF reading) → reloaded, it runs the new one',
  async run({ page, url, tmp, deploy }) {
    await page.goto(url);
    await addVenice(page);
    await swReady(page);
    const first = await cachedAssets(page);
    deploy();
    await swUpdate(page);
    // Neither part has been loaded yet; the host has only the new release's files
    await send(page, 'コード例を見せて');
    await page.locator('[data-message-id] .hljs-keyword').first().waitFor();
    await settled(page);
    await attachPdf(page, tmp);

    await page.reload();
    await swReady(page);
    const renamed = (await page.evaluate(() => [...document.scripts].map((s) => s.src))).some((src) => src.endsWith('-r1.js'));
    if (!renamed) throw new Error('The reloaded page does not run the new release');
    // One release later the first release's files are gone, and the second's are kept
    const second = (await cachedAssets(page)).filter((f) => !first.includes(f));
    deploy();
    await swUpdate(page);
    const now = await cachedAssets(page);
    if (first.some((f) => now.includes(f))) throw new Error('Files of two releases ago are still cached');
    if (!second.every((f) => now.includes(f))) throw new Error('Files of the release before are no longer cached');
  }
};

/**
 * Installable (what Chrome asks of a web app: manifest, icons, Service Worker), and starts offline after one visit:
 * the Service Worker serves the app, the key vault and every script, stylesheet and font
 */
const offline: Flow = {
  name: 'offline',
  label: 'installable → offline after one visit, a reload starts the app with its conversations',
  async run({ page, url }) {
    const message = 'A conversation to read offline';
    await conversation(page, url, message);
    await swReady(page);
    const cdp = await page.context().newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    if (installabilityErrors.length) throw new Error(`Not installable: ${installabilityErrors.map((e) => e.errorId).join(', ')}`);
    const { errors } = await cdp.send('Page.getAppManifest');
    if (errors.length) throw new Error(`Manifest: ${errors.map((e) => e.message).join('; ')}`);
    await page.context().setOffline(true);
    await page.reload();
    // Within the default timeout: sooner than the app gives up on a vault that does not answer
    await answer(page, message).waitFor();
  }
};

export const FLOWS: Flow[] = [chat, lock, backup, files, images, settings, fetchPage, pdf, update, offline];
