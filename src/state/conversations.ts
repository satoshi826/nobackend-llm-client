// Conversation list, the displayed conversation, and its messages.
// A new chat is treated the same way, as an "unsaved conversation (draft)", and is saved on the first send.
import { batch, computed, effect, signal } from '@preact/signals';
import type { Conversation, MessageRecord } from '../lib/db/schema';
import * as repo from '../lib/db/repo';
import { pathToLeaf, resolveLeaf } from '../lib/chat/tree';
import { titleFrom } from '../lib/chat/title';
import { settings } from './settings';
import { defaultModel, visibleModels } from './models';
import { sidebarOpen } from './ui';

export const conversations = signal<Conversation[]>([]);
/** ID of the displayed saved conversation (null means a draft) */
export const currentId = signal<string | null>(null);
/** Messages of the displayed conversation (the whole conversation tree) */
export const messages = signal<MessageRecord[]>([]);

const DRAFT_ID = 'draft';

function makeDraft(temporary: boolean): Conversation {
  const now = Date.now();
  const m = defaultModel();
  return {
    id: DRAFT_ID,
    title: '新しいチャット',
    createdAt: now,
    updatedAt: now,
    currentLeafId: null,
    providerId: m.providerId,
    modelId: m.modelId,
    systemPrompt: settings.value.defaultSystemPrompt,
    webSearch: 'off',
    pinned: 0,
    tags: [],
    temporary: temporary || undefined
  };
}

export const draft = signal<Conversation>(makeDraft(false));

// When the model list arrives later, fill in the draft's model
effect(() => {
  const d = draft.peek();
  const vis = visibleModels.value;
  if (!d.modelId && vis.length) {
    const m = defaultModel();
    draft.value = { ...d, providerId: m.providerId, modelId: m.modelId };
  }
});

export const isDraft = computed(() => currentId.value === null);
/** The displayed conversation (including a draft; always present) */
export const currentConv = computed<Conversation>(() => (currentId.value ? conversations.value.find((c) => c.id === currentId.value) : undefined) ?? draft.value);

export const currentPath = computed<MessageRecord[]>(() => {
  if (isDraft.value) return [];
  const byId = new Map(messages.value.map((m) => [m.id, m]));
  return pathToLeaf(byId, currentConv.value.currentLeafId);
});

function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => b.pinned - a.pinned || b.updatedAt - a.updatedAt);
}

export async function loadConversations() {
  conversations.value = sortConversations(await repo.listConversations());
}

export function startNewChat(temporary = false) {
  batch(() => {
    currentId.value = null;
    messages.value = [];
    draft.value = makeDraft(temporary);
    sidebarOpen.value = false;
  });
  setHash(null);
}

/** Messages newer than the DB, such as in-progress drafts (registered by generation) */
export const liveMessages = new Map<string, MessageRecord>();

export async function openConversation(id: string) {
  const stored = await repo.listMessages(id);
  // For in-progress messages use the latest copy in memory; ones left in progress (interrupted by a reload) are treated as stopped
  const list = stored.map((m) => liveMessages.get(m.id) ?? (m.status === 'streaming' ? { ...m, status: 'aborted' as const } : m));
  for (const d of liveMessages.values()) if (d.conversationId === id && !list.some((m) => m.id === d.id)) list.push(d);
  batch(() => {
    currentId.value = id;
    messages.value = list;
    sidebarOpen.value = false;
  });
  setHash(id);
  // Repair a leaf that points at a message that was never written (closed right as a reply started)
  const conv = conversations.value.find((c) => c.id === id);
  if (conv) {
    const leaf = resolveLeaf(list, conv.currentLeafId);
    if (leaf !== conv.currentLeafId) await updateConversation({ currentLeafId: leaf }, id);
  }
}

/** Change the conversation's settings (changes the draft if it is a draft) */
export async function updateConversation(patch: Partial<Conversation>, id: string | null = currentId.value) {
  if (!id) {
    draft.value = { ...draft.value, ...patch, id: DRAFT_ID };
    return;
  }
  const conv = conversations.value.find((c) => c.id === id);
  if (!conv) return;
  const next = { ...conv, ...patch };
  conversations.value = conversations.value.map((c) => (c.id === id ? next : c));
  await repo.putConversation(next);
}

export function touchConversation(id: string) {
  conversations.value = sortConversations(conversations.value);
  void updateConversation({ updatedAt: Date.now() }, id);
}

/** If it is a draft, save it as a conversation */
export async function persistDraft(firstText: string): Promise<Conversation> {
  if (!isDraft.value) return currentConv.value;
  const now = Date.now();
  const conv: Conversation = { ...draft.value, id: repo.newId(), title: titleFrom(firstText), createdAt: now, updatedAt: now };
  await repo.putConversation(conv);
  batch(() => {
    conversations.value = [conv, ...conversations.value];
    currentId.value = conv.id;
    messages.value = [];
  });
  setHash(conv.id);
  return conv;
}

export async function removeConversation(id: string, beforeRemove?: (id: string) => void) {
  beforeRemove?.(id);
  await repo.deleteConversation(id);
  if (currentId.value === id) startNewChat();
  conversations.value = conversations.value.filter((c) => c.id !== id);
}

export async function putMessage(m: MessageRecord, conv: Conversation) {
  await repo.putMessage(m, !!conv.temporary);
}

// ---- URL（#/c/<id>）----
function setHash(id: string | null) {
  const conv = id ? conversations.value.find((c) => c.id === id) : null;
  const next = conv && !conv.temporary ? `#/c/${id}` : '';
  if (location.hash !== next) history.replaceState(null, '', next || location.pathname);
}

/** Open the conversation named in the URL (pass the hash read before anything resets it) */
export async function restoreFromHash(hash = location.hash) {
  const m = /^#\/c\/([\w-]+)$/.exec(hash);
  if (m && conversations.value.some((c) => c.id === m[1])) await openConversation(m[1]);
}
