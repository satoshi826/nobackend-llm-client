// "To tags": the chat model rewrites a prompt written in sentences (any language) as Danbooru tags for a tag model.
// One call with no tools to the conversation's chat model (else the default one), recorded in usage as image work.
import * as repo from '../../../lib/db/repo';
import { completeText } from '../../../lib/chat/extract';
import { getPreset } from '../../../lib/providers/registry';
import { vaultTransport as transport } from '../../../lib/vault/client';
import { authFor } from '../../../state/keys';
import { accountInUse, defaultModel, providerById } from '../../../state/models';
import { providerOptionsFor, recordUsage } from '../../../state/request-helpers';
import { currentConv } from '../../../state/conversations';

/** For the model only: English, like the tool descriptions */
const INSTRUCTION = [
  'You turn a description of an image into the prompt for an anime image model that is prompted with Danbooru tags.',
  'Reply with the prompt only: comma-separated Danbooru tags in English, with spaces instead of underscores and parentheses escaped with a backslash (hatsune miku \\(cosplay\\)).',
  'Start with the subject count (1girl, 1boy, 2girls, no humans, ...), then the character and series if named, then appearance, clothing, expression, pose, setting, lighting and style.',
  'Use only tags that exist on Danbooru, keep tags the text already has, and describe nothing the text does not ask for.',
  'Leave out quality tags (masterpiece, best quality, score_9, ...): the app adds them. No sentences, no explanations, no quotes.'
].join(' ');

/** The chat model that rewrites: the conversation's, else the default one; undefined when none can be used now */
export function tagWriter(): { providerId: string; modelId: string } | undefined {
  const conv = currentConv.value;
  const ref = conv.modelId && accountInUse(conv.providerId) ? { providerId: conv.providerId, modelId: conv.modelId } : defaultModel();
  return ref.modelId && providerById(ref.providerId) && accountInUse(ref.providerId) ? ref : undefined;
}

/** The answer as one line of tags: without quotes or code fences, lines joined by commas */
export function cleanTags(answer: string): string {
  return answer
    .replace(/^```\w*\n?|\n?```$/g, '')
    .split('\n')
    .map((l) =>
      l
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/,$/, '')
    )
    .filter(Boolean)
    .join(', ');
}

/** The text rewritten as tags; limit: characters the tags may take */
export async function toTags(text: string, limit: number | undefined, signal: AbortSignal): Promise<string> {
  const ref = tagWriter();
  const cfg = ref && providerById(ref.providerId);
  if (!ref || !cfg) throw new Error('No chat model');
  const conv = currentConv.value;
  const answer = await completeText(
    [
      { id: 's', role: 'system', parts: [{ type: 'text', text: INSTRUCTION + (limit ? ` Keep it within ${limit} characters.` : '') }] },
      { id: 'u', role: 'user', parts: [{ type: 'text', text }] }
    ],
    { maxTokens: 1024, temperature: 0.3 },
    {
      provider: cfg,
      preset: getPreset(cfg.id),
      auth: authFor(cfg.id),
      transport,
      model: ref.modelId,
      providerOptions: providerOptionsFor(cfg.id, 'summary'),
      signal,
      onUsage: (usage, costUsd) => recordUsage({ id: repo.newId(), conversationId: conv.id, providerId: cfg.id, model: ref.modelId, kind: 'image', usage, costUsd, temporary: conv.temporary })
    }
  );
  return cleanTags(answer);
}
