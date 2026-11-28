// generate_image: lets a chat model create images with the default image model. Off by default; asks before running.
import type { Tool } from '../../../lib/tools/types';
import { cleanFileName, extOf } from '../../../lib/paths';
import type { ImageModelInfo } from './providers/common';
import { t } from './messages';
import { TranslatedError } from '../../../lib/i18n';

export const GENERATE_IMAGE = 'generate_image';
const ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16'];

export interface ImageToolInput {
  prompt: string;
  aspect_ratio?: string;
  negative_prompt?: string;
  /** Where to save it in the working folder ('assets/hero.png'), cleaned as write_file cleans names */
  path?: string;
}

export interface ImageToolRun {
  /** paths: where they were saved, relative to the working folder when inWorkDir (else in the Files tab) */
  (input: ImageToolInput, signal: AbortSignal): Promise<{ blobIds: string[]; paths: string[]; inWorkDir: boolean; model: string; blurred: boolean; request?: Record<string, unknown> }>;
}

/**
 * The paths `count` images get from the path the model gave, without their extension (the image's type sets it):
 * 'assets/hero.png' → ['assets/hero'], or ['assets/hero-1', 'assets/hero-2'] for two
 */
export function imageStems(path: string, count: number): string[] {
  const stem = path.replace(/\.[^./]*$/, '');
  return count === 1 ? [stem] : Array.from({ length: count }, (_, i) => `${stem}-${i + 1}`);
}

/** The images' paths with their ids: '"assets/hero.png" (id: b1)' */
const listed = (r: { paths: string[]; blobIds: string[] }) => r.paths.map((n, i) => `${JSON.stringify(n)} (id: ${r.blobIds[i]})`).join(', ');

/** Where the images went, for the model: the paths to load them by, and why they differ from the path it gave */
function savedNote(asked: string | undefined, r: { paths: string[]; blobIds: string[]; inWorkDir: boolean }): string {
  if (!r.inWorkDir)
    return `Saved in the Files tab as ${listed(r)}, outside any working folder${asked ? ' (there is none yet), so the path was ignored' : ''}. For a page to load one, move it into the working folder with move_file and its id${asked ? ' (to that path)' : ''}.`;
  const stems = asked ? imageStems(asked, r.paths.length) : [];
  const differs = !!asked && r.paths.some((p, i) => extOf(p) !== extOf(asked) || p.slice(0, -extOf(p).length - 1) !== stems[i]);
  return `Saved in the working folder as ${listed(r)}: pages there can load them by that path.${
    differs ? " That is not exactly the path you gave: the extension follows the image's type, and a path already taken gets a number (nothing is replaced)." : ''
  }`;
}

/** How to write the prompt for the image model (for the model only: English, like the descriptions) */
function promptAdvice(m: ImageToolModel | undefined): { how: string; param: string } {
  const limit = (m?.promptLimit ? ` Keep it within ${m.promptLimit} characters.` : '') + (m?.qualityTags ? ` The app adds the quality tags "${m.qualityTags}" itself; do not write them.` : '');
  return m?.promptStyle === 'tags'
    ? {
        how: `The image model is an anime model prompted with Danbooru tags: write the prompt as comma-separated Danbooru tags in English, with spaces instead of underscores and parentheses escaped with a backslash (hatsune miku \\(cosplay\\)), not as sentences. Start with the subject count (1girl, 1boy, ...), then the character and series if any, then appearance, clothing, pose, setting and style (e.g. "1girl, solo, long hair, school uniform, sitting, classroom, window, sunlight, smile").${limit}`,
        param: `Comma-separated Danbooru tags in English (spaces instead of underscores).${limit}`
      }
    : { how: `Write the prompt in English when possible, describing subject, style, composition and lighting.${limit}`, param: `A detailed description of the image, in English when possible.${limit}` };
}

/** What the description tells the chat model about the image model: its prompt style, the room left, the quality tags the app adds */
export type ImageToolModel = Pick<ImageModelInfo, 'promptStyle' | 'promptLimit'> & { qualityTags?: string };

export function makeImageTool(run: ImageToolRun, model?: ImageToolModel): Tool<ImageToolInput> {
  const advice = promptAdvice(model);
  return {
    name: GENERATE_IMAGE,
    get label() {
      return t('tool.label');
    },
    description: `Create an image from a text description with the user's image model and show it to the user. Use it only when the user asks for an image (a picture, an illustration, a photo, a diagram drawn as an image). ${advice.how} You cannot see the result, so do not describe it as if you could.`,
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: advice.param },
        aspect_ratio: { type: 'string', enum: ASPECTS, description: 'Optional. Width:height; default 1:1.' },
        negative_prompt: { type: 'string', description: 'Optional. Things the image should not contain.' },
        path: {
          type: 'string',
          description:
            'Optional. Where to save it in the working folder, e.g. "assets/hero.png", when a page there will load it by that path; default a name from the time. The extension follows the image\'s type, and a path already taken gets a number. The result gives the path it was saved at. Without a working folder, it is saved in the Files tab; move it in with move_file and its id when a page needs it.'
        }
      },
      required: ['prompt']
    },
    risk: 'network',
    summarize: (i) => i.prompt,
    prepare(raw) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const prompt = typeof r.prompt === 'string' ? r.prompt.trim() : '';
      if (!prompt) throw new TranslatedError(() => t('tool.noPrompt'));
      const aspect = typeof r.aspect_ratio === 'string' && ASPECTS.includes(r.aspect_ratio) ? r.aspect_ratio : undefined;
      const negative = typeof r.negative_prompt === 'string' && r.negative_prompt.trim() ? r.negative_prompt.trim() : undefined;
      const path = typeof r.path === 'string' && r.path.trim() ? cleanFileName(r.path, 'png') : undefined;
      return { prompt: prompt.slice(0, 7000), ...(aspect ? { aspect_ratio: aspect } : {}), ...(negative ? { negative_prompt: negative } : {}), ...(path ? { path } : {}) };
    },
    async execute(input, ctx) {
      const r = await run(input, ctx.signal);
      return {
        // For the model only: English, like the descriptions
        content: `Created ${r.blobIds.length} image(s) with ${r.model}; they are shown to the user.${r.blurred ? ' The provider blurred them (safe mode).' : ''} You cannot see them, so do not describe them as if you could. ${savedNote(input.path, r)}`,
        // request: what was sent and what it cost (shown in full on the card)
        details: { blobIds: r.blobIds, model: r.model, blurred: r.blurred, request: r.request }
      };
    }
  };
}
