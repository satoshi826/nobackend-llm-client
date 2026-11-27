// Context usage and compaction (summarizing the older part of a conversation)
import { computed, signal } from '@preact/signals';
import type { MessageRecord } from '../lib/db/schema';
import * as repo from '../lib/db/repo';
import { getPreset } from '../lib/providers/registry';
import { accountById } from '../lib/keys/accounts';
import { formatNumber } from '../lib/i18n';
import { buildTranscript, estimateRequest, planCompaction, summarize, summaryInstruction, type RequestEstimate } from '../lib/chat/compact';
import { estimateTokens } from '../lib/chat/context';
import { vaultTransport as transport } from '../lib/vault/client';
import { settings } from './settings';
import { authFor, keyReady } from './keys';
import { modelOf, providerById } from './models';
import { currentConv, currentId, currentPath, messages, putMessage, updateConversation } from './conversations';
import { showToast } from './ui';
import { contributedSystemNotes } from './tool-registry';
import { controllers, setStreaming, streamingConv } from './runs';
import { parseModelRef, providerOptionsFor, recordUsage } from './request-helpers';
import { t } from './messages';

export const compactingConv = signal<string | null>(null);

// ---- Context usage and compaction ----
export const contextUsage = computed<RequestEstimate & { limit: number | null; ratio: number | null }>(() => {
  const conv = currentConv.value;
  const model = modelOf(conv.providerId, conv.modelId);
  const e = estimateRequest(currentPath.value, conv.systemPrompt.trim(), contributedSystemNotes({ conv, messageId: '', model, history: currentPath.value }));
  const limit = model?.contextLength ?? null;
  return { ...e, limit, ratio: limit ? e.total / limit : null };
});

/** The model that writes summaries: the one set in settings if it can be used, else the conversation's own */
function compactionModel(): { providerId: string; modelId: string } {
  const conv = currentConv.value;
  const ref = parseModelRef(settings.value.compactModel);
  return ref && modelOf(ref.providerId, ref.modelId) && keyReady(ref.providerId) ? ref : { providerId: conv.providerId, modelId: conv.modelId };
}

/** What compacting now would do: how many messages are summarized and kept, by which model, and what it sends. null when too short */
export const compactionPreview = computed(() => {
  const plan = planCompaction(currentPath.value);
  if (!plan) return null;
  const ref = compactionModel();
  const model = modelOf(ref.providerId, ref.modelId);
  const tokens = estimateTokens(summaryInstruction()) + estimateTokens(buildTranscript(plan, null));
  const price = model?.pricing?.inputPerMTok;
  // The summarizing model can be called now (its key is ready, or it needs none)
  const ready = keyReady(ref.providerId) || !!accountById(ref.providerId)?.keyOptional;
  return { count: plan.toSummarize.length, kept: plan.kept, model: model?.name ?? ref.modelId, tokens, inputUsd: price != null ? (tokens * price) / 1e6 : null, ready };
});

/** The compaction in effect (the last one on the current path) */
export const lastCompaction = computed(() => currentPath.value.findLast((m) => m.compaction)?.compaction ?? null);

/** Summarize the older part and add a compaction node (the original history is kept). Returns true if compacted */
export async function compactConversation(auto = false): Promise<boolean> {
  const conv = currentConv.value;
  if (!currentId.value || streamingConv.value.has(conv.id)) return false;
  const plan = planCompaction(currentPath.value);
  if (!plan) {
    if (!auto) showToast(t('compact.tooShort'));
    return false;
  }
  const ref = compactionModel();
  const cfg = providerById(ref.providerId);
  if (!cfg) return false;
  const ctrl = new AbortController();
  controllers.set(conv.id, ctrl);
  setStreaming(conv.id, true);
  compactingConv.value = conv.id;
  try {
    const summary = await summarize(plan, {
      provider: cfg,
      preset: getPreset(cfg.preset),
      auth: authFor(cfg.id),
      transport,
      model: ref.modelId,
      contextLength: modelOf(ref.providerId, ref.modelId)?.contextLength,
      providerOptions: providerOptionsFor(cfg.id, 'summary'),
      onUsage: (usage, costUsd) => recordUsage({ id: repo.newId(), conversationId: conv.id, providerId: cfg.id, model: ref.modelId, kind: 'summary', usage, costUsd, temporary: conv.temporary }),
      signal: ctrl.signal
    });
    const node: MessageRecord = {
      id: repo.newId(),
      conversationId: conv.id,
      parentId: conv.currentLeafId,
      role: 'system',
      parts: [{ type: 'text', text: summary }],
      createdAt: Date.now(),
      status: 'done',
      meta: { providerId: cfg.id, model: ref.modelId },
      compaction: { summary, coversUntilId: plan.coversUntilId, count: plan.toSummarize.length, model: ref.modelId, auto }
    };
    await putMessage(node, conv);
    messages.value = [...messages.value, node];
    await updateConversation({ currentLeafId: node.id, updatedAt: Date.now() }, conv.id);
    showToast(t(auto ? 'compact.autoDone' : 'compact.done', { n: formatNumber(plan.toSummarize.length) }));
    return true;
  } catch (e) {
    if (!ctrl.signal.aborted) showToast(t('compact.failed', { message: (e as Error).message }), 'error');
    return false;
  } finally {
    controllers.delete(conv.id);
    setStreaming(conv.id, false);
    compactingConv.value = null;
  }
}
