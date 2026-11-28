// The model lists of image and video providers: every provider in use, each list cached for 6 hours
import { computed, effect, signal, type ReadonlySignal } from '@preact/signals';
import * as repo from '../../lib/db/repo';

export interface ModelLists<M> {
  models: ReadonlySignal<M[]>;
  /** What failed in the last load, per provider ('' when nothing did) */
  error: ReadonlySignal<string>;
  load(force?: boolean): Promise<void>;
  /** Change the loaded list (e.g. prices fetched later for one model) */
  set(list: M[]): void;
}

export function modelLists<P extends { id: string; label: string }, M>(o: {
  /** Providers in use (key set, connection on); the loaded lists follow them */
  providers: ReadonlySignal<P[]>;
  cacheKey(id: string): string;
  fetch(p: P): Promise<M[]>;
}): ModelLists<M> {
  const models = signal<M[]>([]);
  const error = signal('');
  let loading: Promise<void> | null = null;
  const load = (force = false): Promise<void> => {
    if (loading) return loading;
    loading = (async () => {
      const errors: string[] = [];
      const lists = await Promise.all(
        o.providers.value.map(async (p) => {
          const cached = await repo.getSetting<{ at: number; list: M[] } | null>(o.cacheKey(p.id), null);
          if (cached && !force && Date.now() - cached.at < 6 * 3600_000) return cached.list;
          try {
            const list = await o.fetch(p);
            await repo.setSetting(o.cacheKey(p.id), { at: Date.now(), list });
            return list;
          } catch (e) {
            errors.push(`${p.label}: ${(e as Error).message}`);
            return cached?.list ?? [];
          }
        })
      );
      models.value = lists.flat();
      error.value = errors.join(' / ');
    })().finally(() => (loading = null));
    return loading;
  };
  // Turning a connection on or off, or setting, removing or locking a key, loads them again (from the caches)
  const ids = computed(() => o.providers.value.map((p) => p.id).join(' '));
  effect(() => {
    void ids.value;
    if (models.peek().length) void load();
  });
  return { models, error, load, set: (list) => (models.value = list) };
}
