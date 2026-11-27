// Settings owned by a feature, stored as their own record ('settings:<id>') instead of in the core Settings.
// A feature defines them once at import time; they are loaded at startup right after the core settings, or, when
// they hold the user's text (sealed), with the data once it can be read.
import { signal, type Signal } from '@preact/signals';
import * as repo from '../lib/db/repo';
import { registerDataLoader } from './lifecycle';

export interface FeatureSettings<T extends object> {
  value: Signal<T>;
  save(patch: Partial<T>): Promise<void>;
}

const loaders: (() => Promise<void>)[] = [];

export interface FeatureSettingsOptions<T> {
  /**
   * They hold the user's own text (prompts): stored encrypted with a passphrase, and loaded once the data can be read
   * (after unlocking), not at startup
   */
  sealed?: boolean;
  /**
   * Reads the old core settings record once, for settings that used to live there (the values are copied to the
   * feature's record the first time it is loaded)
   */
  legacy?: (old: Record<string, unknown>) => Partial<T>;
}

export function defineFeatureSettings<T extends object>(id: string, defaults: T, { sealed = false, legacy }: FeatureSettingsOptions<T> = {}): FeatureSettings<T> {
  const key = `settings:${id}`;
  const value = signal<T>(defaults);
  const read = sealed ? repo.getSealedSetting : repo.getSetting;
  const write = sealed ? repo.setSealedSetting : repo.setSetting;
  if (sealed) repo.sealSettingKey(key);
  const load = async () => {
    const stored = await read<Partial<T> | null>(key, null);
    if (stored) {
      value.value = { ...defaults, ...stored };
      return;
    }
    if (!legacy) return;
    const migrated = legacy(await repo.getSetting<Record<string, unknown>>('settings', {}));
    value.value = { ...defaults, ...migrated };
    if (Object.keys(migrated).length) await write(key, value.value);
  };
  if (sealed) registerDataLoader(load);
  else loaders.push(load);
  return {
    value,
    async save(patch) {
      value.value = { ...value.value, ...patch };
      await write(key, value.value);
    }
  };
}

/** Load the feature settings read at startup (sealed ones load with the data, state/lifecycle.ts) */
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
