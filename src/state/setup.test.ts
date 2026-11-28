// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conversations, loadConversations, openConversation, startNewChat } from './conversations';
import { keyInfos } from './keys';
import { DEFAULT_SETTINGS, settings } from './settings';
import { chatSetup, needsSetup, shownSetup } from './setup';
import * as repo from '../lib/db/repo';
import { db, type Conversation } from '../lib/db/schema';

const conv = (id: string): Conversation => ({ id, title: id, createdAt: 1, updatedAt: 1, currentLeafId: null, providerId: 'venice', modelId: 'm', systemPrompt: '', webSearch: 'off', pinned: 0, tags: [] });

beforeEach(async () => {
  settings.value = { ...DEFAULT_SETTINGS };
  keyInfos.value = {};
  await repo.putConversation(conv('a'));
  await repo.putConversation(conv('b'));
  await loadConversations();
  startNewChat();
});
afterEach(async () => {
  await Promise.all(['conversations', 'messages'].map((t) => db().table(t).clear()));
  conversations.value = [];
});

describe('setup before sending', () => {
  it('shows the first-run choice in a new chat', () => {
    expect(shownSetup.value).toBe('choose');
  });

  it('opens a saved conversation without a key, and asks for one only when the user sends', async () => {
    await openConversation('a');
    expect(chatSetup.value).toBe('choose');
    expect(shownSetup.value).toBeNull();
    expect(needsSetup()).toBe(true);
    expect(shownSetup.value).toBe('choose');
    // Opening another conversation goes back to reading
    await openConversation('b');
    expect(shownSetup.value).toBeNull();
  });

  it('follows a key set from there with the passphrase offer, which never holds a message back', async () => {
    await openConversation('a');
    needsSetup();
    keyInfos.value = { venice: { present: true, encrypted: false, locked: false } };
    settings.value = { ...settings.value, enabledProviders: ['venice'] };
    expect(shownSetup.value).toBe('passphrase');
    expect(needsSetup()).toBe(false);
    settings.value = { ...settings.value, passphrasePrompted: true };
    expect(shownSetup.value).toBeNull();
  });
});
