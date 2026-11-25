// generate_image: lets a chat model create images (Venice image API). Off by default; asks before running.
import type { Tool } from '../../lib/tools/types';
import { t } from './messages';

export const GENERATE_IMAGE = 'generate_image';
const ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16'];

export interface ImageToolInput {
  prompt: string;
  aspect_ratio?: string;
  negative_prompt?: string;
}

export interface ImageToolRun {
  (input: ImageToolInput, signal: AbortSignal): Promise<{ blobIds: string[]; model: string; blurred: boolean }>;
}

export function makeImageTool(run: ImageToolRun): Tool<ImageToolInput> {
  return {
    name: GENERATE_IMAGE,
    get label() {
      return t('tool.label');
    },
    description:
      'Generate an image from a text description and show it to the user. Write the prompt in English when possible, describing subject, style, composition and lighting. Use only when the user asks for an image.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed description of the image' },
        aspect_ratio: { type: 'string', enum: ASPECTS, description: 'Default 1:1' },
        negative_prompt: { type: 'string', description: 'Things to avoid (optional)' }
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
        content: t(r.blurred ? 'tool.resultBlurred' : 'tool.result', { n: r.blobIds.length, model: r.model }),
        details: { blobIds: r.blobIds, model: r.model, blurred: r.blurred }
      };
    }
  };
}
