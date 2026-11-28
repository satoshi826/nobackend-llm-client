// Conversation list, the displayed conversation, and its messages.
// A new chat is treated the same way, as an "unsaved conversation (draft)", and is saved on the first send.
import { batch, computed, effect, signal, type Signal } from '@preact/signals';
import type { Conversation, MessageRecord } from '../lib/db/schema';
import * as repo from '../lib/db/repo';
import { pathToLeaf, resolveLeaf } from '../lib/chat/tree';
import { titleFrom } from '../lib/chat/title';
import { textSettings } from './settings';
import { accountInUse, defaultModel, visibleModels } from './models';
import { moveChatOptions } from './chat-options';
import { mainView, sidebarOpen, sidebarTab } from './ui';
import { registerRoute, setHash as setRouteHash } from './router';
import { keyInfos, vaultStatusKnown } from './keys';
import { t } from './messages';

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
    title: t('conv.newChat'),
    createdAt: now,
    updatedAt: now,
    currentLeafId: null,
    providerId: m.providerId,
    modelId: m.modelId,
    systemPrompt: textSettings.value.value.defaultSystemPrompt,
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

// Once the key status is known, a new chat that landed on a provider without a usable key
// switches to one that can be used right away (the default is chosen before keys are known at startup)
effect(() => {
  if (!vaultStatusKnown.value) return;
  void keyInfos.value;
  void visibleModels.value;
  const d = draft.peek();
  if (currentId.peek() !== null || accountInUse(d.providerId)) return;
  const m = defaultModel();
  if (m.modelId && m.providerId !== d.providerId && accountInUse(m.providerId)) draft.value = { ...d, providerId: m.providerId, modelId: m.modelId };
});

export const isDraft = computed(() => currentId.value === null);
/** The displayed conversation (including a draft; always present) */
export const currentConv = computed<Conversation>(() => (currentId.value ? conversations.value.find((c) => c.id === currentId.value) : undefined) ?? draft.value);

/** The open conversation's messages by id */
export const messagesById = computed(() => new Map(messages.value.map((m) => [m.id, m])));

export const currentPath = computed<MessageRecord[]>(() => {
  if (isDraft.value) return [];
  return pathToLeaf(messagesById.value, currentConv.value.currentLeafId);
});

function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => b.pinned - a.pinned || b.updatedAt - a.updatedAt);
}

export type { SearchHit } from '../lib/db/repo';
/** Messages whose text matches a search (the sidebar's search) */
let titles = new Map<string, string>();
/**
 * Each conversation's title by id. The same Map until a title changes, is added or goes, so what shows titles is not
 * drawn again when a conversation only moves (a message sent in it)
 */
export const conversationTitles = computed(() => {
  const next = new Map(conversations.value.map((c) => [c.id, c.title]));
  if (next.size !== titles.size || [...next].some(([id, title]) => titles.get(id) !== title)) titles = next;
  return titles;
});

export const searchMessages = (query: string, signal?: AbortSignal): Promise<repo.SearchHit[]> => repo.searchMessages(query, signal);

/** How many saved things (files, images) a chat made: they can go with it when it is deleted */
export const countMadeIn = (id: string): Promise<number> => repo.countMadeIn(id);

export async function loadConversations() {
  conversations.value = sortConversations(await repo.listConversations());
}

export function startNewChat(temporary = false) {
  batch(() => {
    currentId.value = null;
    messages.value = [];
    draft.value = makeDraft(temporary);
    sidebarOpen.value = false;
    mainView.value = { kind: 'chat' };
    sidebarTab.value = 'chats';
  });
  setHash(null);
}

/** Messages being written (status 'streaming'), newer than their saved copy: reopening their conversation shows these */
export const liveMessages = new Map<string, MessageRecord>();

/**
 * Each message being written, as it grows: only that message's view reads it, so `messages` (and the lists, the path
 * and the context meter made from it) change when a message starts or ends, not with every piece of text
 */
const writing = new Map<string, Signal<MessageRecord>>();
export const writingOf = (id: string): Signal<MessageRecord> | undefined => writing.get(id);

/** A message is no longer written (it ended, also while another conversation was open, or its run failed) */
export function endWriting(id: string) {
  liveMessages.delete(id);
  writing.delete(id);
}

/**
 * Take updates of messages: the ones still being written go to their own signal; the others (one that started or
 * ended, or any other change) are returned, for `messages`
 */
export function takeWriting(updates: Map<string, MessageRecord>): Map<string, MessageRecord> {
  const settled = new Map<string, MessageRecord>();
  for (const [id, m] of updates) {
    const live = writing.get(id);
    if (live && m.status === 'streaming') {
      live.value = m;
      continue;
    }
    settled.set(id, m);
    if (m.status === 'streaming') writing.set(id, signal(m));
    else writing.delete(id);
  }
  return settled;
}

/** Changes to messages being written, shown once per frame */
const pending = new Map<string, MessageRecord>();
let pendingFrame = 0;
function flushPending() {
  pendingFrame = 0;
  if (!pending.size) return;
  const ups = new Map(pending);
  pending.clear();
  batch(() => {
    const settled = takeWriting(ups);
    if (settled.size) messages.value = messages.value.map((m) => settled.get(m.id) ?? m);
  });
}

/**
 * Show a message without saving it: added to the open conversation, or in place of its older copy there. A message
 * being written is kept in memory until it ends, and its changes are shown once per frame; any other change at once
 */
export function showMessage(m: MessageRecord) {
  // The runner keeps changing the message it writes
  const copy = { ...m, parts: m.parts.map((p) => ({ ...p })) };
  if (copy.status === 'streaming') liveMessages.set(copy.id, copy);
  else endWriting(copy.id);
  if (copy.conversationId !== currentId.value) return;
  if (!messagesById.value.has(copy.id)) messages.value = [...messages.value, copy];
  else if (copy.status === 'streaming') {
    pending.set(copy.id, copy);
    if (!pendingFrame) pendingFrame = requestAnimationFrame(flushPending);
  } else {
    pending.delete(copy.id);
    messages.value = messages.value.map((x) => (x.id === copy.id ? copy : x));
  }
}

/** Save a message and show it (a temporary conversation's stays in memory: the storage decides from its conversation) */
export async function saveMessage(m: MessageRecord) {
  await repo.putMessage(m);
  showMessage(m);
}

export async function openConversation(id: string) {
  const stored = await repo.listMessages(id);
  // For in-progress messages use the latest copy in memory; ones left in progress (interrupted by a reload) are treated as stopped
  const list = stored.map((m) => liveMessages.get(m.id) ?? (m.status === 'streaming' ? { ...m, status: 'aborted' as const } : m));
  // `messages` holds each message's latest copy from here; one still written gets its own signal again with its next piece
  writing.clear();
  for (const d of liveMessages.values()) if (d.conversationId === id && !list.some((m) => m.id === d.id)) list.push(d);
  batch(() => {
    currentId.value = id;
    messages.value = list;
    sidebarOpen.value = false;
    mainView.value = { kind: 'chat' };
    sidebarTab.value = 'chats';
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
  // What was chosen for the new chat (tools, answer length, reasoning) stays with it
  moveChatOptions(DRAFT_ID, conv.id);
  batch(() => {
    conversations.value = [conv, ...conversations.value];
    currentId.value = conv.id;
    messages.value = [];
  });
  setHash(conv.id);
  return conv;
}

/** beforeRemove: e.g. stop its running answer; withItems: also delete the images and files made in it */
export async function removeConversation(id: string, { beforeRemove, withItems = false }: { beforeRemove?(id: string): void; withItems?: boolean } = {}) {
  beforeRemove?.(id);
  await repo.deleteConversation(id, withItems);
  if (currentId.value === id) startNewChat();
  // A file or image of it may be open: back to the chat rather than show what is gone
  else if (withItems && mainView.value.kind !== 'chat') showChat();
  conversations.value = conversations.value.filter((c) => c.id !== id);
}

/** Save a message without showing it. Only for the image and video features until they move to saveMessage */
export async function putMessage(m: MessageRecord, _conv?: Conversation) {
  await repo.putMessage(m);
}

// ---- URL（#/c/<id>）----
function setHash(id: string | null) {
  const conv = id ? conversations.value.find((c) => c.id === id) : null;
  setRouteHash(conv && !conv.temporary ? `#/c/${id}` : '');
}

/** Show the chat again (the conversation that was open, or the draft) */
export function showChat() {
  batch(() => {
    mainView.value = { kind: 'chat' };
    sidebarTab.value = 'chats';
  });
  setHash(currentId.value);
}

registerRoute({
  pattern: /^#\/c\/([\w-]+)$/,
  open: async (m) => {
    if (conversations.value.some((c) => c.id === m[1])) await openConversation(m[1]);
  }
});
