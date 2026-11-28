// generate_image: lets a chat model create images with the default image model. Off by default; asks before running.
import type { Tool } from '../../lib/tools/types';
import type { ImageModelInfo } from './providers/common';
import { t } from './messages';

export const GENERATE_IMAGE = 'generate_image';
const ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16'];

export interface ImageToolInput {
  prompt: string;
  aspect_ratio?: string;
  negative_prompt?: string;
}

export interface ImageToolRun {
  /** names: what they were saved as; inWorkDir: in the conversation's working folder (else at the top of the Files tab) */
  (input: ImageToolInput, signal: AbortSignal): Promise<{ blobIds: string[]; names: string[]; inWorkDir: boolean; model: string; blurred: boolean; request?: Record<string, unknown> }>;
}

/** How to write the prompt for the image model (for the model only: English, like the descriptions) */
function promptAdvice(m: Pick<ImageModelInfo, 'promptStyle' | 'promptLimit'> | undefined): { how: string; param: string } {
  const limit = m?.promptLimit ? ` Keep it within ${m.promptLimit} characters.` : '';
  return m?.promptStyle === 'tags'
    ? {
        how: `The image model is an anime model prompted with Danbooru tags: write the prompt as comma-separated Danbooru tags in English, with spaces instead of underscores and parentheses escaped with a backslash (hatsune miku \\(cosplay\\)), not as sentences. Start with the subject count (1girl, 1boy, ...), then the character and series if any, then appearance, clothing, pose, setting and style (e.g. "1girl, solo, long hair, school uniform, sitting, classroom, window, sunlight, smile").${limit}`,
        param: `Comma-separated Danbooru tags in English (spaces instead of underscores).${limit}`
      }
    : { how: `Write the prompt in English when possible, describing subject, style, composition and lighting.${limit}`, param: `A detailed description of the image, in English when possible.${limit}` };
}

/** model: the image model it will use, whose prompt style and limit the description tells the chat model */
export function makeImageTool(run: ImageToolRun, model?: Pick<ImageModelInfo, 'promptStyle' | 'promptLimit'>): Tool<ImageToolInput> {
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
        negative_prompt: { type: 'string', description: 'Optional. Things the image should not contain.' }
      },
      required: ['prompt']
    },
    risk: 'network',
    summarize: (i) => i.prompt,
    prepare(raw) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const prompt = typeof r.prompt === 'string' ? r.prompt.trim() : '';
      if (!prompt) throw new Error(t('tool.noPrompt'));
      const aspect = typeof r.aspect_ratio === 'string' && ASPECTS.includes(r.aspect_ratio) ? r.aspect_ratio : undefined;
      const negative = typeof r.negative_prompt === 'string' && r.negative_prompt.trim() ? r.negative_prompt.trim() : undefined;
      return { prompt: prompt.slice(0, 7000), ...(aspect ? { aspect_ratio: aspect } : {}), ...(negative ? { negative_prompt: negative } : {}) };
    },
    async execute(input, ctx) {
      const r = await run(input, ctx.signal);
      return {
        // For the model only: English, like the descriptions
        content: `Created ${r.blobIds.length} image(s) with ${r.model}; they are shown to the user.${r.blurred ? ' The provider blurred them (safe mode).' : ''} You cannot see them, so do not describe them as if you could. ${
          r.inWorkDir ? `Saved in the working folder as ${r.names.map((n) => JSON.stringify(n)).join(', ')}: pages there can load them by that path.` : `Saved in the Files tab as ${r.names.map((n) => JSON.stringify(n)).join(', ')}.`
        }`,
        // request: what was sent and what it cost (shown in full on the card)
        details: { blobIds: r.blobIds, model: r.model, blurred: r.blurred, request: r.request }
      };
    }
  };
}
