// One tab at a time uses the app's data (Web Locks): two tabs would write over each other's changes, since each keeps
// its own copy in memory (settings are written back whole). A tab that finds the data in use waits until the user
// chooses to use it there; the tab that had it then stops for good.
import { signal } from '@preact/signals';
import { closeDatabase, databaseName } from '../lib/db/schema';

/** active: this tab uses the data; waiting: another tab does; left: another tab took it over (this one stopped) */
export const tabState = signal<'active' | 'waiting' | 'left'>('active');

/** Set before a reload: the reloaded tab takes the data over from the other tab */
const TAKE = 'nbl-take-over';

/** Hold the data for this tab, taking it over when the user chose so. false: another tab holds it */
export function holdData(): Promise<boolean> {
  // Browsers without Web Locks: every tab uses the data (and writes it)
  if (!navigator.locks) return Promise.resolve(true);
  const steal = sessionStorage.getItem(TAKE) === '1';
  sessionStorage.removeItem(TAKE);
  return new Promise((resolve) => {
    navigator.locks
      .request(databaseName(), steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        resolve(!!lock);
        // Held until the tab closes
        return lock ? new Promise<never>(() => {}) : undefined;
      })
      // Taken over by another tab: stop using the data
      .catch(() => {
        closeDatabase();
        tabState.value = 'left';
      });
  });
}

/** Use the app in this tab: reload and take the data over (the other tab stops) */
export function takeOver() {
  sessionStorage.setItem(TAKE, '1');
  location.reload();
}
