// Recommended quality tags and negative prompts of the anime model families, as their authors give them:
// Animagine XL 4.0 (huggingface.co/cagliostrolab/animagine-xl-4.0), NoobAI-XL (huggingface.co/Laxhar/noobai-XL-1.1,
// without its rating tags "safe" / "nsfw"), WAI-Illustrious for Illustrious models (civitai.com/models/827184), and
// Pony Diffusion V6 XL (civitai.com/models/257749; it needs no negative prompt).
import type { ImageParams } from '../../../lib/db/schema';
import type { TagFamily } from './providers/common';

export interface TagPreset {
  /** Quality tags, and whether they go before or after the prompt */
  quality: string;
  at: 'start' | 'end';
  negative: string;
}

export const TAG_PRESETS: Record<TagFamily, TagPreset> = {
  animagine: {
    quality: 'masterpiece, high score, great score, absurdres',
    at: 'end',
    negative:
      'lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry'
  },
  noobai: {
    quality: 'masterpiece, best quality, newest, absurdres, highres',
    at: 'start',
    negative: 'worst quality, old, early, low quality, lowres, signature, username, logo, bad hands, mutated hands, mammal, anthro, furry, ambiguous form, feral, semi-anthro'
  },
  pony: { quality: 'score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up', at: 'start', negative: '' },
  illustrious: { quality: 'masterpiece, best quality, amazing quality', at: 'start', negative: 'bad quality, worst quality, worst detail, sketch, censor' }
};

/** Whether a negative prompt is one of the presets (filled in by the app, not written by the user) */
export const isPresetNegative = (s: string) => Object.values(TAG_PRESETS).some((p) => p.negative === s);

/** The prompt as it is sent: with the quality tags the request asked for, joined by a comma */
export function sentPrompt(p: Pick<ImageParams, 'prompt' | 'qualityTags'>): string {
  const q = p.qualityTags;
  if (!q) return p.prompt;
  return q.at === 'start' ? `${q.text}, ${p.prompt.replace(/^[\s,]+/, '')}` : `${p.prompt.replace(/[\s,]+$/, '')}, ${q.text}`;
}
