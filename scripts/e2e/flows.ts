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
  /** Saves a screenshot of what the page shows now, at its width and (unless phone is false) at a phone's, for a person to look at */
  shot(name: string, o?: { phone?: boolean }): Promise<void>;
}

export interface Flow {
  name: string;
  label: string;
  /** Console errors the flow causes on purpose (parts of their text) */
  expected?: string[];
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

/** Sends a message and waits until the mock's answer to it is complete and saved */
async function ask(page: Page, message: string) {
  await send(page, message);
  await answer(page, message).waitFor();
  await settled(page);
}

/** A provider, and a conversation with one complete answer */
async function conversation(page: Page, url: string, message: string) {
  await page.goto(url);
  await addVenice(page);
  await ask(page, message);
}

const modelButton = (page: Page) => page.getByRole('button', { name: /^Choose a model:/ });

async function pickModel(page: Page, name: string) {
  await modelButton(page).click();
  const picker = page.getByRole('dialog', { name: 'Choose a model' });
  await picker.getByRole('button', { name: new RegExp(`^${name}`) }).last().click();
  await page.getByRole('button', { name: `Choose a model: ${name}` }).waitFor();
}

/**
 * The reply suggestions under the last answer have arrived: until then the list may still grow under the pointer
 * and scroll, moving what a click aims at
 */
const suggested = (page: Page) => page.locator('[data-message-id]').last().getByRole('group', { name: 'Reply suggestions' }).getByRole('button').first().waitFor();

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

const models: Flow = {
  name: 'models',
  label: 'the model picker: search → bookmark → pick → the choice and the bookmark are still there after a reload, and the answer comes from it',
  async run({ page, url, a11y, shot }) {
    await page.goto(url);
    await addVenice(page);
    await shot('new chat');
    await modelButton(page).click();
    const picker = page.getByRole('dialog', { name: 'Choose a model' });
    await picker.getByRole('button', { name: /^Mock Private Reasoner/ }).waitFor();
    await shot('picker');
    await picker.getByRole('textbox', { name: 'Search models' }).fill('reason');
    await until('the search to leave one model', async () => (await picker.getByRole('button', { name: /^Mock / }).count()) === 1);
    await picker.getByRole('button', { name: 'Bookmark Mock Private Reasoner' }).click();
    // Listed under Bookmarks too
    await until('the bookmark to be listed', async () => (await picker.getByRole('button', { name: 'Remove bookmark for Mock Private Reasoner' }).count()) === 2);
    await shot('search and bookmark');
    await a11y('model picker');
    await picker.getByRole('button', { name: /^Mock Private Reasoner/ }).first().click();
    await picker.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Choose a model: Mock Private Reasoner' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Choose a model: Mock Private Reasoner' }).waitFor();
    await modelButton(page).click();
    // The bookmark is listed on its own at the top, with the search cleared
    await picker.getByRole('button', { name: /^Bookmarks/ }).waitFor();
    await shot('bookmarks after a reload');
    await page.keyboard.press('Escape');
    await ask(page, 'Which model answers');
    await page.locator('[data-message-id]').getByText('mock-private-reasoner', { exact: true }).waitFor();
    await shot('answer from the picked model');
  }
};

const temporary: Flow = {
  name: 'temporary',
  label: 'a temporary chat is answered, written nowhere (conversations, usage records), listed until the tab is reloaded, and gone after',
  async run({ page, url, shot }) {
    await page.goto(url);
    await addVenice(page);
    await page.getByRole('button', { name: 'Temporary chat', exact: true }).click();
    await page.getByRole('button', { name: 'Temporary chat: on' }).waitFor();
    await shot('temporary new chat');
    const message = 'A message not to keep';
    await ask(page, message);
    await shot('temporary chat answered');
    const plain = await stored(page, message);
    if (plain) throw new Error(`The temporary chat is stored (${plain})`);
    await openSettings(page, 'Usage');
    await page.getByText('No records for this period').waitFor();
    await page.keyboard.press('Escape');
    // Listed, to go back to, while the tab lives
    await page.getByRole('button', { name: 'New chat' }).click();
    await page.getByRole('navigation').getByRole('button', { name: message }).click();
    await answer(page, message).waitFor();
    await page.reload();
    await page.getByText('No conversations yet').waitFor();
    await shot('after a reload');
  }
};

const skills: Flow = {
  name: 'skills',
  label: 'write a skill in Settings → Skills → choose it in the input box → it is sent with the message',
  async run({ page, url, a11y, shot }) {
    await page.goto(url);
    await addVenice(page);
    await openSettings(page, 'Skills');
    await shot('skills tab');
    await page.getByRole('button', { name: 'New skill' }).click();
    const form = page.getByRole('group', { name: 'New skill' });
    await form.getByLabel('Name').fill('meeting-notes');
    await form.getByLabel('Description').fill('Turns rough meeting notes into decisions and to-dos.');
    await form.getByLabel('Instructions (Markdown)').fill('# Steps\n1. List the decisions\n2. List the to-dos with owners');
    await shot('new skill');
    await a11y('new skill');
    await form.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Edit meeting-notes' }).waitFor();
    await shot('skill saved');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Skills', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: /meeting-notes/ }).click();
    await page.getByRole('button', { name: 'Skills: 1' }).waitFor();
    const message = 'Notes from today';
    await composer(page).fill(message);
    await shot('skill chosen');
    await page.getByRole('button', { name: 'Send' }).click();
    // The mock lists the skills sent with the message
    await page.locator('[data-message-id]').filter({ hasText: 'モック応答' }).getByText('指定スキル: meeting-notes').waitFor();
    await settled(page);
    await shot('answer with the skill');
  }
};

const usage: Flow = {
  name: 'usage',
  label: 'a few answers from two models → the header\'s cost opens Usage → its totals, and its split by model and by use',
  async run({ page, url, a11y, shot }) {
    await page.goto(url);
    await addVenice(page);
    // Each answer, and the reply suggestions made after it: two requests
    const answered = async (message: string) => {
      await ask(page, message);
      await suggested(page);
    };
    await answered('First question');
    await answered('Second question');
    await pickModel(page, 'Mock Uncensored');
    await answered('Third question');
    await page.getByRole('button', { name: /^Estimated cost of this conversation/ }).click();
    const usageTab = page.getByRole('tabpanel');
    await usageTab.getByText('Cost in this period').waitFor();
    const requests = await usageTab.getByRole('term').filter({ hasText: 'Requests' }).locator('xpath=following-sibling::dd[1]').innerText();
    if (requests !== '6') throw new Error(`Usage shows ${requests} requests, not 6`);
    await shot('usage');
    await a11y('usage');
    const split = usageTab.getByRole('tablist', { name: 'Split by' });
    await split.getByRole('tab', { name: 'Model' }).click();
    await usageTab.getByRole('list', { name: 'Model' }).getByText('Mock Uncensored').waitFor();
    await shot('split by model');
    await split.getByRole('tab', { name: 'Use' }).click();
    await usageTab.getByRole('list', { name: 'Use' }).getByText('Reply suggestions').waitFor();
    await shot('split by use');
  }
};

/** Sends a message the mock answers with a failure, and waits until the failure shows */
async function fails(page: Page, message: string) {
  await send(page, message);
  await settled(page);
  await page.locator('[data-message-id]').last().getByRole('alert').waitFor();
}

const errors: Flow = {
  name: 'errors',
  label: 'a refused key → its button opens Connections and keys; a conversation too long for the model → its button opens the compaction panel → compacted → regenerated, now answered',
  // The browser reports the mock's failures
  expected: ['status of 401 (Unauthorized)', 'status of 400 (Bad Request)'],
  async run({ page, url, a11y, shot }) {
    await page.goto(url);
    await addVenice(page);
    await fails(page, 'Hello #err:auth');
    await shot('key refused');
    await a11y('error');
    await page.getByRole('button', { name: 'Open connections and keys' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Connections and keys', selected: true }).waitFor();
    await shot('connections and keys');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'New chat' }).click();
    for (const n of ['one', 'two', 'three', 'four']) await ask(page, `Message ${n}`);
    await fails(page, 'Message five #err:context');
    await shot('too long');
    await page.getByRole('button', { name: 'Compact conversation' }).click();
    const panel = page.getByRole('dialog', { name: 'Context usage' });
    await panel.getByText(/^Keeps the latest/).waitFor();
    await shot('compaction panel');
    await a11y('compaction panel');
    await panel.getByRole('button', { name: 'Compact now' }).click();
    const failed = page.locator('[data-message-id]').last();
    // The summary goes above the question that failed, so sending it again carries the summary
    await page.getByRole('button', { name: /^Summarized the older messages/ }).waitFor();
    await page.keyboard.press('Escape');
    await shot('compacted');
    // The failed answer now offers to send it again in place of compacting
    await failed.getByRole('button', { name: 'Compact conversation' }).waitFor({ state: 'detached' });
    await failed.getByRole('button', { name: 'Regenerate', exact: true }).first().click();
    await answer(page, 'Message five #err:context').waitFor();
    await settled(page);
    await shot('regenerated');
  }
};

const video: Flow = {
  name: 'video',
  label: 'video mode with the mock video model → its options and price → the job is waited for → the video plays from storage',
  async run({ page, url, a11y, shot }) {
    await page.goto(url);
    await addVenice(page);
    await page.getByRole('button', { name: 'Video', exact: true }).click();
    await page.getByRole('button', { name: /^Video model: Mock Video/ }).waitFor();
    await page.getByPlaceholder('Describe the video').fill('Waves on a quiet beach');
    await shot('video mode');
    await page.getByRole('button', { name: /^Video settings/ }).click();
    await page.getByRole('dialog', { name: 'Video settings' }).waitFor();
    await shot('video options');
    await a11y('video options');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText('Making the video').waitFor();
    await shot('making the video');
    // The mock answers on its third ask, five seconds apart
    const play = page.getByRole('button', { name: 'Play the video' });
    await play.waitFor({ timeout: 30_000 });
    await settled(page);
    await shot('video made');
    await play.click();
    const clip = page.locator('[data-message-id] video').first();
    await until('the video to load', () => clip.evaluate((e: HTMLVideoElement) => e.readyState >= 1 && e.duration > 0));
    await a11y('video answer');
  }
};

const sidebar: Flow = {
  name: 'sidebar',
  label: 'three conversations → search finds one → rename it in place → delete another, asked first',
  async run({ page, url, a11y, shot }) {
    await page.goto(url);
    await addVenice(page);
    for (const message of ['Plans for the weekend', 'Recipe ideas', 'Travel checklist']) {
      await page.getByRole('button', { name: 'New chat' }).click();
      await ask(page, message);
    }
    const list = page.getByRole('navigation');
    await shot('three conversations');
    await page.getByRole('textbox', { name: 'Search chats' }).fill('Recipe');
    await until('the search to leave one conversation', async () => (await list.getByRole('button', { name: /^Recipe ideas/ }).count()) === 1 && (await list.getByRole('button', { name: /Travel/ }).count()) === 0);
    await shot('search');
    await a11y('sidebar search');
    await page.getByRole('textbox', { name: 'Search chats' }).fill('');
    const row = list.getByRole('button', { name: 'Recipe ideas', exact: true });
    // A row's own buttons show while it is hovered
    const rowOf = (title: string) => list.locator('div').filter({ has: page.getByRole('button', { name: title, exact: true }) }).last();
    await row.hover();
    await rowOf('Recipe ideas').getByRole('button', { name: 'Rename' }).click();
    const name = page.getByRole('textbox', { name: 'Chat name' });
    await name.fill('Dinner recipes');
    // Not at a phone's width, where the sidebar closes, and the name with it
    await shot('rename', { phone: false });
    await name.press('Enter');
    await list.getByRole('button', { name: 'Dinner recipes', exact: true }).waitFor();
    const travel = list.getByRole('button', { name: 'Travel checklist', exact: true });
    await travel.hover();
    await rowOf('Travel checklist').getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog');
    await confirm.getByText('This deletes "Travel checklist".').waitFor();
    await shot('delete asked');
    await a11y('delete conversation');
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await travel.waitFor({ state: 'detached' });
    await page.reload();
    await list.getByRole('button', { name: 'Dinner recipes', exact: true }).waitFor();
    if (await list.getByRole('button', { name: 'Travel checklist' }).count()) throw new Error('The deleted conversation is back after a reload');
    await shot('after a reload');
  }
};

const branches: Flow = {
  name: 'branches',
  label: 'regenerate an answer and edit a message → each makes a version → switch between versions, also after a reload',
  async run({ page, url, a11y, shot }) {
    await page.goto(url);
    await addVenice(page);
    await ask(page, 'Tell me a story');
    await suggested(page);
    const reply = page.locator('[data-message-id]').filter({ hasText: 'モック応答' }).last();
    await reply.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await settled(page);
    await reply.getByText('2/2').waitFor();
    await suggested(page);
    await shot('regenerated');
    await reply.getByRole('button', { name: 'Previous version' }).click();
    await reply.getByText('1/2').waitFor();
    // By its id: while edited, its text is in a text box
    const id = await page.locator('[data-message-id]').filter({ hasText: 'Tell me a story' }).first().getAttribute('data-message-id');
    const mine = page.locator(`[data-message-id="${id}"]`);
    await mine.hover();
    await mine.getByRole('button', { name: 'Edit' }).click();
    const edit = mine.getByRole('textbox');
    await edit.fill('Tell me a short story');
    await shot('editing');
    await a11y('editing a message');
    await mine.getByRole('button', { name: 'Send' }).click();
    await answer(page, 'Tell me a short story').waitFor();
    await settled(page);
    await suggested(page);
    const edited = page.locator('[data-message-id]').filter({ hasText: 'Tell me a short story' }).first();
    await edited.getByText('2/2').waitFor();
    await shot('edited');
    await edited.getByRole('button', { name: 'Previous version' }).click();
    await mine.getByText('1/2').waitFor();
    // With the newest answer of that version: the regenerated one
    await reply.getByText('2/2').waitFor();
    // Reloaded once the version shown is saved
    const leaf = await reply.getAttribute('data-message-id');
    await until('the version shown to be saved', () => stored(page, `"currentLeafId":"${leaf}"`));
    await page.reload();
    // The versions last shown are the ones shown again
    await mine.getByText('1/2').waitFor();
    await reply.getByText('2/2').waitFor();
    await shot('after a reload');
  }
};

/** At a phone's width the sidebar is a drawer, opened by the header's Menu button, which every screen has */
const phone: Flow = {
  name: 'phone',
  label: 'on a phone, the first-run screen leads to the sidebar and Settings (a backup can be imported before any key) → the new chat passes the accessibility checks',
  async run({ page, url, a11y }) {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(url);
    await page.getByRole('button', { name: /Venice\.ai/ }).waitFor();
    await page.getByRole('button', { name: 'Menu' }).click();
    await openSettings(page, 'Privacy and data');
    await page.getByRole('button', { name: 'Import', exact: true }).waitFor();
    // Settings, then the sidebar: Esc closes the topmost
    await page.keyboard.press('Escape');
    // Once focus is back on the sidebar's Settings button, the sidebar is the topmost
    await until('focus to return to Settings', () => page.getByRole('button', { name: 'Settings' }).evaluate((e) => e === document.activeElement));
    await page.keyboard.press('Escape');
    await addVenice(page);
    await composer(page).waitFor();
    await a11y('new chat');
  }
};

export const FLOWS: Flow[] = [chat, lock, backup, files, images, settings, fetchPage, pdf, update, offline, phone, models, temporary, skills, usage, errors, video, sidebar, branches];
