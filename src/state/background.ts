// The page background (Settings → 表示): moving light in one of several colour sets, a solid colour, or the
// user's own picture. The choice lives in the core settings; the picture is stored apart as a data URL
// (downscaled), so loading settings stays small. Neither is encrypted; both are part of backups.
import { signal } from '@preact/signals';
import * as repo from '../lib/db/repo';
import { saveSettings, settings } from './settings';

export type GlowPreset = 'moonlight' | 'aurora' | 'ocean' | 'dusk' | 'ember' | 'forest' | 'sakura' | 'glacier' | 'aurum' | 'mono';

export interface BackgroundSetting {
  kind: 'glow' | 'solid' | 'image';
  preset: GlowPreset;
  /** How fast the light drifts: 1 = normal, 0 = still (0–3) */
  speed: number;
  /** Solid colour */
  color: string;
  /** How much the picture is darkened under the text (0–0.8) */
  dim: number;
}

export const DEFAULT_BACKGROUND: BackgroundSetting = { kind: 'glow', preset: 'moonlight', speed: 1, color: '#0b0d17', dim: 0.45 };

/** Colours and strengths of the three light blobs per set (dark theme) */
export const GLOW_PRESETS: Record<GlowPreset, { colors: [string, string, string]; opacity: [number, number, number] }> = {
  moonlight: { colors: ['#64748b', '#6366f1', '#94a3b8'], opacity: [0.3, 0.24, 0.13] },
  aurora: { colors: ['#14b8a6', '#8b5cf6', '#22c55e'], opacity: [0.24, 0.2, 0.1] },
  ocean: { colors: ['#0ea5e9', '#2563eb', '#06b6d4'], opacity: [0.24, 0.22, 0.1] },
  dusk: { colors: ['#a855f7', '#ec4899', '#6366f1'], opacity: [0.22, 0.18, 0.12] },
  ember: { colors: ['#f97316', '#e11d48', '#f59e0b'], opacity: [0.2, 0.16, 0.08] },
  forest: { colors: ['#10b981', '#15803d', '#84cc16'], opacity: [0.22, 0.2, 0.08] },
  sakura: { colors: ['#f472b6', '#fb7185', '#e9d5ff'], opacity: [0.2, 0.16, 0.1] },
  glacier: { colors: ['#67e8f9', '#a5b4fc', '#e0f2fe'], opacity: [0.18, 0.18, 0.08] },
  aurum: { colors: ['#ca8a04', '#b45309', '#fde68a'], opacity: [0.2, 0.16, 0.08] },
  mono: { colors: ['#52525b', '#71717a', '#a1a1aa'], opacity: [0.3, 0.22, 0.1] }
};
export const GLOW_ORDER: GlowPreset[] = ['moonlight', 'aurora', 'ocean', 'dusk', 'ember', 'forest', 'sakura', 'glacier', 'aurum', 'mono'];
export const MAX_SPEED = 3;

export const backgroundOf = (): BackgroundSetting => ({ ...DEFAULT_BACKGROUND, ...settings.value.background });

export function saveBackground(patch: Partial<BackgroundSetting>) {
  return saveSettings({ background: { ...backgroundOf(), ...patch } });
}

// ---- the picture ----
const IMAGE_KEY = 'appearance:backgroundImage';
/** The picture as a data URL (null: none) */
export const backgroundImage = signal<string | null>(null);
let loaded = false;

export async function loadBackgroundImage() {
  if (loaded) return;
  loaded = true;
  backgroundImage.value = await repo.getSetting<string | null>(IMAGE_KEY, null);
}

/** Downscale (long edge 2560 px) and store a picture from the device */
export async function setBackgroundImage(file: File): Promise<void> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const url = canvas.toDataURL('image/jpeg', 0.85);
  await repo.setSetting(IMAGE_KEY, url);
  backgroundImage.value = url;
  loaded = true;
  await saveBackground({ kind: 'image' });
}

export async function clearBackgroundImage() {
  await repo.setSetting(IMAGE_KEY, null);
  backgroundImage.value = null;
  if (backgroundOf().kind === 'image') await saveBackground({ kind: 'glow' });
}
