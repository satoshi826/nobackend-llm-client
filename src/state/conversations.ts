// 会話の一覧・表示中の会話・メッセージ。
// 新しいチャットは「まだ保存していない会話（下書き）」として同じ形で扱い、最初の送信で保存する。
import { batch, computed, effect, signal } from '@preact/signals';
import type { Conversation, MessageRecord } from '../lib/db/schema';
import * as repo from '../lib/db/repo';
import { pathToLeaf } from '../lib/chat/tree';
import { titleFrom } from '../lib/chat/title';
import { settings } from './settings';
import { defaultModel, visibleModels } from './models';
import { sidebarOpen } from './ui';

export const conversations = signal<Conversation[]>([]);
/** 表示中の保存済み会話の ID（null なら下書き） */
export const currentId = signal<string | null>(null);
/** 表示中の会話のメッセージ（会話ツリー全体） */
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

// モデル一覧が後から届いたら、下書きのモデルを埋める
effect(() => {
  const d = draft.peek();
  const vis = visibleModels.value;
  if (!d.modelId && vis.length) {
    const m = defaultModel();
    draft.value = { ...d, providerId: m.providerId, modelId: m.modelId };
  }
});

export const isDraft = computed(() => currentId.value === null);
/** 表示中の会話（下書きを含む。常に存在する） */
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

/** 生成中の下書きなど、DB より新しいメッセージ（generation が登録する） */
export const liveMessages = new Map<string, MessageRecord>();

export async function openConversation(id: string) {
  const stored = await repo.listMessages(id);
  // 生成中のものはメモリ上の最新を使い、生成中のまま残ったもの（再読み込みで中断）は「停止」扱い
  const list = stored.map((m) => liveMessages.get(m.id) ?? (m.status === 'streaming' ? { ...m, status: 'aborted' as const } : m));
  for (const d of liveMessages.values()) if (d.conversationId === id && !list.some((m) => m.id === d.id)) list.push(d);
  batch(() => {
    currentId.value = id;
    messages.value = list;
    sidebarOpen.value = false;
  });
  setHash(id);
}

/** 会話の設定を変える（下書きなら下書きを変える） */
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

/** 下書きなら保存して会話にする */
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

export async function restoreFromHash() {
  const m = /^#\/c\/([\w-]+)$/.exec(location.hash);
  if (m && conversations.value.some((c) => c.id === m[1])) await openConversation(m[1]);
}
