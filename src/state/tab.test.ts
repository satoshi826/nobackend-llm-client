import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One tab at a time uses the data. Web Locks as the browser gives them (one origin, shared by its tabs): a request
// with ifAvailable gets null while another tab holds the lock; one with steal takes it, and the holder's request fails.
function fakeLocks() {
  let holder: { reject(e: unknown): void } | null = null;
  return {
    request(_name: string, opts: { ifAvailable?: boolean; steal?: boolean }, cb: (lock: object | null) => unknown) {
      if (holder && opts.ifAvailable) return Promise.resolve(cb(null));
      if (holder && opts.steal) holder.reject(new DOMException('stolen', 'AbortError'));
      return new Promise((resolve, reject) => {
        holder = { reject };
        Promise.resolve(cb({})).then(resolve, reject);
      });
    }
  };
}

function fakeSessionStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

let locks: ReturnType<typeof fakeLocks> | undefined;
let n = 0;
const dbName = () => `tab-test-${n}`;

/** A tab (its own modules, memory and session storage); `reload` opens it again with the same session storage */
async function openTab(session = fakeSessionStorage()) {
  vi.stubGlobal('navigator', { locks });
  vi.stubGlobal('sessionStorage', session);
  const reload = vi.fn();
  vi.stubGlobal('location', { reload });
  vi.resetModules();
  const schema = await import('../lib/db/schema');
  schema.setDatabaseName(dbName());
  const tab = await import('./tab');
  const holds = await tab.holdData();
  return { tab, db: schema.db, holds, session, reload };
}

beforeEach(() => {
  n++;
  locks = fakeLocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('one tab at a time uses the data', () => {
  it('lets the first tab use the data, and makes a second one wait', async () => {
    const first = await openTab();
    expect(first.holds).toBe(true);
    const second = await openTab();
    expect(second.holds).toBe(false);
    expect(first.tab.tabState.value).toBe('active');
  });

  it('moves the data to the waiting tab when the user chooses it there, and stops the other tab for good', async () => {
    const first = await openTab();
    await first.db().settings.put({ key: 'x', value: 1 });
    const second = await openTab();
    expect(second.holds).toBe(false);

    second.tab.takeOver();
    expect(second.reload).toHaveBeenCalledOnce();
    const reloaded = await openTab(second.session);
    expect(reloaded.holds).toBe(true);

    await vi.waitFor(() => expect(first.tab.tabState.value).toBe('left'));
    // The tab that had the data writes nothing more (its copy in memory would overwrite the new tab's changes)
    await expect(first.db().settings.put({ key: 'x', value: 2 })).rejects.toThrow();
    expect((await reloaded.db().settings.get('x'))?.value).toBe(1);
  });

  it('takes over only on the reload the user asked for, not on later reloads of that tab', async () => {
    await openTab();
    const second = await openTab();
    second.tab.takeOver();
    await openTab(second.session);
    // A third tab takes the data over in turn; the second tab reloading on its own then waits
    const third = await openTab();
    third.tab.takeOver();
    const thirdReloaded = await openTab(third.session);
    expect(thirdReloaded.holds).toBe(true);
    expect((await openTab(second.session)).holds).toBe(false);
    expect(thirdReloaded.tab.tabState.value).toBe('active');
  });

  it('uses the data in every tab where the browser has no Web Locks', async () => {
    locks = undefined;
    expect((await openTab()).holds).toBe(true);
    expect((await openTab()).holds).toBe(true);
  });
});
