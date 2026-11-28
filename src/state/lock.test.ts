import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultState } from '../lib/keys/accounts';
import type { Conversation, MessageRecord } from '../lib/db/schema';

// Conversation encryption follows the key vault's passphrase. The vault is played here: it wraps the data key with its
// current passphrase and unwraps only what that passphrase wrapped, as the real one does.
const vaultSide = vi.hoisted(() => ({ pass: null as string | null, wraps: 0 }));
vi.mock('../lib/vault/client', () => ({
  vault: {
    async dataKey(type: 'wrap-data-key' | 'unwrap-data-key', arg: any) {
      if (vaultSide.pass === null) throw new Error('not unlocked');
      if (type === 'wrap-data-key') {
        vaultSide.wraps++;
        return { pass: vaultSide.pass, raw: arg };
      }
      if (arg.pass !== vaultSide.pass) throw new Error('wrong passphrase');
      return arg.raw;
    },
    command: vi.fn(async () => {})
  }
}));
const toasts = vi.hoisted(() => [] as string[]);
vi.mock('./ui', () => ({ showToast: (text: string) => void toasts.push(text) }));

const reload = vi.fn();
let device = '';
let n = 0;

/** A page of the app opened on this device: a fresh copy of every module, on the device's database */
async function openPage() {
  vi.resetModules();
  const schema = await import('../lib/db/schema');
  schema.setDatabaseName(device);
  const [lock, keys, repo] = await Promise.all([import('./lock'), import('./keys'), import('../lib/db/repo')]);
  const onUnlocked = vi.fn(async () => {});
  await lock.initDataLock(onUnlocked);
  /** The vault's state reaching the app, as connectKeys passes it on */
  const vaultSays = (v: VaultState) => {
    keys.vaultState.value = v;
    keys.vaultStatusKnown.value = true;
  };
  return { lock, repo, db: schema.db, onUnlocked, vaultSays };
}

const conv: Conversation = { id: 'c1', title: '旅行の計画', createdAt: 1, updatedAt: 2, currentLeafId: 'm1', providerId: 'venice', modelId: 'm', systemPrompt: '', webSearch: 'off', pinned: 0, tags: [] };
const msg: MessageRecord = { id: 'm1', conversationId: 'c1', parentId: null, role: 'user', parts: [{ type: 'text', text: '京都の紅葉' }], createdAt: 1, status: 'done' };
const unlocked = (pid: string): VaultState => ({ hasPassphrase: true, locked: false, passphraseId: pid });
const locked = (pid: string): VaultState => ({ hasPassphrase: true, locked: true, passphraseId: pid });
const noPassphrase: VaultState = { hasPassphrase: false, locked: false, passphraseId: null };

/** A device whose conversation is encrypted with passphrase 'one' (the page that did it is left open) */
async function encryptedDevice() {
  const page = await openPage();
  await page.repo.putConversation(conv);
  await page.repo.putMessage(msg);
  vaultSide.pass = 'one';
  page.vaultSays(unlocked('p1'));
  await vi.waitFor(() => expect(page.lock.dataLock.value).toBe('unlocked'));
  return page;
}
const storedText = async (page: Awaited<ReturnType<typeof openPage>>) => JSON.stringify([await page.db().conversations.toArray(), await page.db().messages.toArray()]);

beforeEach(() => {
  device = `lock-test-${++n}`;
  vaultSide.pass = null;
  vaultSide.wraps = 0;
  toasts.length = 0;
  reload.mockReset();
  vi.stubGlobal('location', { reload });
});
afterEach(() => vi.unstubAllGlobals());

describe('conversation encryption follows the passphrase', () => {
  it('encrypts what is stored when a passphrase is set, and says so', async () => {
    const page = await encryptedDevice();
    const stored = await storedText(page);
    expect(stored).not.toContain('京都');
    expect(stored).not.toContain('旅行');
    expect(toasts).toHaveLength(1);
    expect((await page.repo.listMessages('c1'))[0].parts).toEqual(msg.parts);
  });

  it('opens a new page locked, and shows the conversations only once the vault is unlocked', async () => {
    await encryptedDevice();
    vaultSide.pass = null;
    const page = await openPage();
    expect(page.lock.dataLock.value).toBe('locked');
    page.vaultSays(locked('p1'));
    await new Promise((r) => setTimeout(r, 20));
    expect(page.lock.dataLock.value).toBe('locked');
    expect(page.onUnlocked).not.toHaveBeenCalled();

    vaultSide.pass = 'one';
    page.vaultSays(unlocked('p1'));
    await vi.waitFor(() => expect(page.lock.dataLock.value).toBe('unlocked'));
    expect(page.onUnlocked).toHaveBeenCalledOnce();
    expect((await page.repo.listConversations())[0].title).toBe('旅行の計画');
  });

  it('finishes encrypting on the next unlock when the page closed halfway', async () => {
    const first = await openPage();
    await first.repo.putConversation(conv);
    await first.repo.putMessage(msg);
    // The wrapped key is saved before encrypting starts; the page closed right after
    vaultSide.pass = 'one';
    const { generateDataKey } = await import('../lib/crypto/data');
    await first.repo.setSetting('secret:dataKey', { wrapped: { pass: 'one', raw: (await generateDataKey()).raw }, pid: 'p1', complete: false });

    const page = await openPage();
    page.vaultSays(unlocked('p1'));
    await vi.waitFor(() => expect(page.lock.dataLock.value).toBe('unlocked'));
    expect(await storedText(page)).not.toContain('京都');
    expect((await page.repo.listMessages('c1'))[0].parts).toEqual(msg.parts);
  });

  it('keeps the data openable after the passphrase changes', async () => {
    const page = await encryptedDevice();
    const before = vaultSide.wraps;
    vaultSide.pass = 'two';
    page.vaultSays(unlocked('p2'));
    await vi.waitFor(() => expect(vaultSide.wraps).toBe(before + 1));
    await new Promise((r) => setTimeout(r, 20));

    const next = await openPage();
    next.vaultSays(unlocked('p2'));
    await vi.waitFor(() => expect(next.lock.dataLock.value).toBe('unlocked'));
    expect((await next.repo.listMessages('c1'))[0].parts).toEqual(msg.parts);
  });

  it('stores everything unencrypted again when the passphrase is removed, and forgets the key', async () => {
    const page = await encryptedDevice();
    vaultSide.pass = null;
    page.vaultSays(noPassphrase);
    await vi.waitFor(() => expect(page.lock.dataLock.value).toBe('none'));
    expect(await storedText(page)).toContain('京都');
    expect(await page.repo.getSetting('secret:dataKey', 'missing')).toBeNull();

    // A new page opens without asking for a passphrase
    const next = await openPage();
    expect(next.lock.dataLock.value).toBe('none');
    expect((await next.repo.listMessages('c1'))[0].parts).toEqual(msg.parts);
  });

  it('says the conversations are lost when the passphrase was deleted while they were locked', async () => {
    await encryptedDevice();
    vaultSide.pass = null;
    const page = await openPage();
    page.vaultSays(noPassphrase);
    await vi.waitFor(() => expect(page.lock.dataLock.value).toBe('lost'));
    expect(page.onUnlocked).not.toHaveBeenCalled();
  });

  it('reloads the page to clear the conversations from memory when the vault locks', async () => {
    const page = await encryptedDevice();
    page.vaultSays(locked('p1'));
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('stays locked and tells the user when the vault cannot open the key', async () => {
    await encryptedDevice();
    // The vault now holds another passphrase than the one the key was wrapped with
    vaultSide.pass = 'other';
    const page = await openPage();
    page.vaultSays(unlocked('p1'));
    await vi.waitFor(() => expect(toasts.at(-1)).toContain('wrong passphrase'));
    expect(page.lock.dataLock.value).toBe('locked');
    expect(page.onUnlocked).not.toHaveBeenCalled();
  });
});
