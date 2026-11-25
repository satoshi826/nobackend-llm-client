// Reply suggestions after an answer
import { signal } from '@preact/signals';
import type { Conversation, MessageRecord } from '../lib/db/schema';
import * as repo from '../lib/db/repo';
import { getPreset } from '../lib/providers/registry';
import { generateSuggestions } from '../lib/chat/suggest';
import { vaultTransport as transport } from '../lib/vault/client';
import { settings } from './settings';
import { authFor, keyReady } from './keys';
import { providerById } from './models';
import { messages, putMessage } from './conversations';
import { accountById } from '../lib/keys/accounts';
import { parseModelRef, providerOptionsFor, recordUsage } from './request-helpers';

// ---- Reply suggestions ----
/** ID of the answer whose reply suggestions are being generated */
export const suggestingFor = signal<string | null>(null);
let suggestCtrl: AbortController | null = null;

/** Cancel in-progress reply suggestions (on send, or when the user starts typing) */
export function cancelSuggestions() {
  suggestCtrl?.abort();
  suggestCtrl = null;
  suggestingFor.value = null;
}

/** After an answer, generate reply suggestions and save them on the answer (shows nothing on failure) */
export async function suggestReplies(conv: Conversation, final: MessageRecord, history: MessageRecord[]) {
  const s = settings.value;
  if (!s.replySuggestions || final.status !== 'done') return;
  if (!final.parts.some((p) => p.type === 'text' && p.text.trim())) return;
  const ref = parseModelRef(s.suggestionModel) ?? { providerId: conv.providerId, modelId: conv.modelId };
  const cfg = providerById(ref.providerId);
  if (!cfg || !ref.modelId || !(keyReady(cfg.id) || accountById(cfg.id)?.keyOptional)) return;
  cancelSuggestions();
  const ctrl = new AbortController();
  suggestCtrl = ctrl;
  suggestingFor.value = final.id;
  try {
    const list = await generateSuggestions([...history, final], Math.max(1, s.suggestionTurns), Math.max(1, s.suggestionCount), {
      provider: cfg,
      preset: getPreset(cfg.preset),
      auth: authFor(cfg.id),
      transport,
      model: ref.modelId,
      providerOptions: providerOptionsFor(cfg.id, 'summary'),
      signal: ctrl.signal,
      onUsage: (usage, costUsd) => recordUsage({ id: repo.newId(), providerId: cfg.id, model: ref.modelId, kind: 'suggest', usage, costUsd, temporary: conv.temporary })
    });
    if (ctrl.signal.aborted || !list.length) return;
    const latest = messages.value.find((m) => m.id === final.id) ?? final;
    const updated: MessageRecord = { ...latest, suggestions: list };
    await putMessage(updated, conv);
    if (messages.value.some((m) => m.id === final.id)) messages.value = messages.value.map((m) => (m.id === final.id ? updated : m));
  } catch {
    /* Reply suggestions are only an aid, so failures are not reported */
  } finally {
    if (suggestCtrl === ctrl) {
      suggestCtrl = null;
      suggestingFor.value = null;
    }
  }
}
