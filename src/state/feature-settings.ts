// Settings owned by a feature, stored as their own record ('settings:<id>') instead of in the core Settings.
// A feature defines them once at import time; they are loaded at startup right after the core settings.
import { signal, type Signal } from '@preact/signals';
import * as repo from '../lib/db/repo';

export interface FeatureSettings<T extends object> {
  value: Signal<T>;
  save(patch: Partial<T>): Promise<void>;
}

const loaders: (() => Promise<void>)[] = [];

/**
 * legacy: reads the old core settings record once, for settings that used to live there
 * (the values are copied to the feature's record the first time it is loaded).
 */
export function defineFeatureSettings<T extends object>(id: string, defaults: T, legacy?: (old: Record<string, unknown>) => Partial<T>): FeatureSettings<T> {
  const key = `settings:${id}`;
  const value = signal<T>(defaults);
  loaders.push(async () => {
    const stored = await repo.getSetting<Partial<T> | null>(key, null);
    if (stored) {
      value.value = { ...defaults, ...stored };
      return;
    }
    if (!legacy) return;
    const migrated = legacy(await repo.getSetting<Record<string, unknown>>('settings', {}));
    value.value = { ...defaults, ...migrated };
    if (Object.keys(migrated).length) await repo.setSetting(key, value.value);
  });
  return {
    value,
    async save(patch) {
      value.value = { ...value.value, ...patch };
      await repo.setSetting(key, value.value);
    }
  };
}

export async function loadFeatureSettings() {
  for (const load of loaders) await load();
}

/** Copy the given fields of an old settings record that have the expected type */
export function pickLegacy<T extends object>(old: Record<string, unknown>, defaults: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(defaults) as (keyof T & string)[]) {
    const v = old[k];
    if (v !== undefined && typeof v === typeof defaults[k]) out[k] = v as T[keyof T & string];
  }
  return out;
}
