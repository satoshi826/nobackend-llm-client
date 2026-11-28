// Context usage and compaction (summarizing the older part of a conversation)
import { computed, signal } from '@preact/signals';
import type { MessageRecord } from '../lib/db/schema';
import * as repo from '../lib/db/repo';
import { getPreset } from '../lib/providers/registry';
import { formatNumber } from '../lib/i18n';
import { buildTranscript, estimateRequest, planCompaction, summarize, summaryInstruction, type RequestEstimate } from '../lib/chat/compact';
import { estimateTokens } from '../lib/chat/context';
import { moveChildren } from '../lib/chat/tree';
import { vaultTransport as transport } from '../lib/vault/client';
import { settings } from './settings';
import { authFor } from './keys';
import { accountInUse, modelOf, providerById } from './models';
import { currentConv, currentId, currentPath, messages, saveMessage, updateConversation } from './conversations';
import { showToast } from './ui';
import { contributedSystemNotes } from './tool-registry';
import { beginRun, endRun, runs } from './runs';
import { parseModelRef, providerOptionsFor, recordUsage } from './request-helpers';
import { t } from './messages';

export const compactingConv = signal<string | null>(null);

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
  return ref && modelOf(ref.providerId, ref.modelId) && accountInUse(ref.providerId) ? ref : { providerId: conv.providerId, modelId: conv.modelId };
}

/** What compacting now would do: how many messages are summarized and kept, by which model, and what it sends. null when too short */
export const compactionPreview = computed(() => {
  const plan = planCompaction(currentPath.value);
  if (!plan) return null;
  const ref = compactionModel();
  const model = modelOf(ref.providerId, ref.modelId);
  const tokens = estimateTokens(summaryInstruction()) + estimateTokens(buildTranscript(plan, null));
  const price = model?.pricing?.inputPerMTok;
  // The summarizing model can be called now (its connection is on and unlocked)
  const ready = accountInUse(ref.providerId);
  return { count: plan.toSummarize.length, kept: plan.kept, model: model?.name ?? ref.modelId, tokens, inputUsd: price != null ? (tokens * price) / 1e6 : null, ready };
});

/** The compaction in effect (the last one on the current path) */
export const lastCompaction = computed(() => currentPath.value.findLast((m) => m.compaction)?.compaction ?? null);

/** Failed answers on the current path with a compaction above them made after they failed: sending them again uses the summary */
export const compactedSinceFailed = computed(() => {
  const out = new Set<string>();
  let compactedAt = -Infinity;
  for (const m of currentPath.value) {
    if (m.compaction) compactedAt = Math.max(compactedAt, m.createdAt);
    else if (m.status === 'error' && compactedAt > m.createdAt) out.add(m.id);
  }
  return out;
});

/**
 * Summarize the older part and put a compaction node above the last question (the original history is kept), so
 * regenerating its answer or editing it keeps the summary. Returns true if compacted
 */
export async function compactConversation(auto = false): Promise<boolean> {
  const conv = currentConv.value;
  if (!currentId.value || runs.value.has(conv.id)) return false;
  const plan = planCompaction(currentPath.value);
  if (!plan) {
    if (!auto) showToast(t('compact.tooShort'));
    return false;
  }
  const ref = compactionModel();
  const cfg = providerById(ref.providerId);
  if (!cfg) return false;
  const nodeId = repo.newId();
  // Taken now: the run keeps this conversation's tree as it is, and the user may open another one meanwhile
  const below = moveChildren(messages.value, plan.parentId, nodeId);
  const ctrl = beginRun(conv.id);
  compactingConv.value = conv.id;
  try {
    const summary = await summarize(plan, {
      provider: cfg,
      preset: getPreset(cfg.id),
      auth: authFor(cfg.id),
      transport,
      model: ref.modelId,
      contextLength: modelOf(ref.providerId, ref.modelId)?.contextLength,
      providerOptions: providerOptionsFor(cfg.id, 'summary'),
      onUsage: (usage, costUsd) => recordUsage({ id: repo.newId(), conversationId: conv.id, providerId: cfg.id, model: ref.modelId, kind: 'summary', usage, costUsd, temporary: conv.temporary }),
      signal: ctrl.signal
    });
    const node: MessageRecord = {
      id: nodeId,
      conversationId: conv.id,
      parentId: plan.parentId,
      role: 'system',
      parts: [{ type: 'text', text: summary }],
      createdAt: Date.now(),
      status: 'done',
      meta: { providerId: cfg.id, model: ref.modelId },
      compaction: { summary, coversUntilId: plan.coversUntilId, count: plan.toSummarize.length, model: ref.modelId, auto }
    };
    // The node before what goes under it: stopped in between, the tree stays whole (the node is a leaf off the path)
    await saveMessage(node);
    for (const m of below) await saveMessage(m);
    await updateConversation({ updatedAt: Date.now() }, conv.id);
    showToast(t(auto ? 'compact.autoDone' : 'compact.done', { n: formatNumber(plan.toSummarize.length) }));
    return true;
  } catch (e) {
    if (!ctrl.signal.aborted) showToast(t('compact.failed', { message: (e as Error).message }), 'error');
    return false;
  } finally {
    endRun(conv.id);
    compactingConv.value = null;
  }
}
