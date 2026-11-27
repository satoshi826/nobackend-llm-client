import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as repo from '../lib/db/repo';
import { defineFeatureSettings, loadFeatureSettings, pickLegacy } from './feature-settings';

describe('feature settings', () => {
  it('copies values from the old core settings once, then reads their own record', async () => {
    await repo.setSetting('settings', { imageTool: true, imageFormat: 'png', theme: 'dark', fileTools: 'yes' });
    const defaults = { imageTool: false, imageFormat: 'webp' as 'webp' | 'png', fileTools: true };
    const s = defineFeatureSettings('test-images', defaults, { legacy: (old) => pickLegacy(old, defaults) });
    await loadFeatureSettings();
    // fileTools had the wrong type in the old record, so the default stays
    expect(s.value.value).toEqual({ imageTool: true, imageFormat: 'png', fileTools: true });
    expect(await repo.getSetting('settings:test-images', null)).toEqual({ imageTool: true, imageFormat: 'png', fileTools: true });
    await s.save({ imageTool: false });
    await repo.setSetting('settings', { imageTool: true });
    await loadFeatureSettings();
    expect(s.value.value.imageTool).toBe(false);
  });
  it('keeps the defaults when there is nothing to migrate', async () => {
    const s = defineFeatureSettings('test-empty', { on: true });
    await loadFeatureSettings();
    expect(s.value.value).toEqual({ on: true });
    expect(await repo.getSetting('settings:test-empty', null)).toBeNull();
  });
});
