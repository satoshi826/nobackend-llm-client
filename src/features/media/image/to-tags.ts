// "To tags": the chat model rewrites a prompt written in sentences (any language) as Danbooru tags for a tag model.
// One call with no tools to the conversation's chat model (else the default one), recorded in usage as image work.
import * as repo from '../../../lib/db/repo';
import type { ExtractOptions } from '../../../lib/chat/extract';
import { getAdapter, getPreset } from '../../../lib/providers/registry';
import { TranslatedError } from '../../../lib/i18n';
import { vaultTransport as transport } from '../../../lib/vault/client';
import { authFor } from '../../../state/keys';
import { accountInUse, defaultModel, modelOf, providerById } from '../../../state/models';
import { providerOptionsFor, recordUsage } from '../../../state/request-helpers';
import { currentConv } from '../../../state/conversations';
import { t } from './messages';

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

/** Reasoning efforts from least to most; an effort not listed counts as more */
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const rank = (e: string) => (EFFORTS.includes(e) ? EFFORTS.indexOf(e) : EFFORTS.length);

/** The least reasoning a model lets be chosen (tags need none), else undefined */
export const leastEffort = (efforts: string[] | undefined) => efforts?.reduce((a, b) => (rank(b) < rank(a) ? b : a));

/**
 * The text rewritten as tags by one call with no tools. limit: characters the tags may take. efforts: the reasoning
 * efforts the model offers. No answer length and no temperature are sent: a reasoning model would spend a short length
 * on thinking, and some models refuse a temperature; an answer cut at its length is refused rather than put in half.
 */
export async function rewriteAsTags(text: string, limit: number | undefined, o: ExtractOptions & { efforts?: string[] }): Promise<string> {
  const effort = leastEffort(o.efforts);
  let answer = '';
  let cut = false;
  const request = {
    model: o.model,
    messages: [
      { id: 's', role: 'system' as const, parts: [{ type: 'text' as const, text: INSTRUCTION + (limit ? ` Keep it within ${limit} characters.` : '') }] },
      { id: 'u', role: 'user' as const, parts: [{ type: 'text' as const, text }] }
    ],
    params: effort ? { reasoningEffort: effort } : {},
    providerOptions: o.providerOptions,
    signal: o.signal
  };
  for await (const ev of getAdapter(o.provider).chat(o.provider, o.preset, o.auth, request, o.transport)) {
    if (ev.type === 'text-delta') answer += ev.delta;
    else if (ev.type === 'usage') o.onUsage?.(ev.usage, ev.costUsd);
    else if (ev.type === 'done') cut = ev.reason === 'length';
    else if (ev.type === 'error') throw new Error(ev.error.message);
  }
  if (cut) throw new TranslatedError(() => t('bar.toTagsCut'));
  const tags = cleanTags(answer);
  if (!tags) throw new TranslatedError(() => t('bar.toTagsEmpty'));
  return tags;
}

/** The text rewritten as tags by the chat model that rewrites (tagWriter) */
export async function toTags(text: string, limit: number | undefined, signal: AbortSignal): Promise<string> {
  const ref = tagWriter();
  const cfg = ref && providerById(ref.providerId);
  if (!ref || !cfg) throw new Error('No chat model');
  const conv = currentConv.value;
  return rewriteAsTags(text, limit, {
    provider: cfg,
    preset: getPreset(cfg.id),
    auth: authFor(cfg.id),
    transport,
    model: ref.modelId,
    efforts: modelOf(ref.providerId, ref.modelId)?.capabilities.reasoningEffort,
    providerOptions: providerOptionsFor(cfg.id, 'summary'),
    signal,
    onUsage: (usage, costUsd) => recordUsage({ id: repo.newId(), conversationId: conv.id, providerId: cfg.id, model: ref.modelId, kind: 'image', usage, costUsd, temporary: conv.temporary })
  });
}
