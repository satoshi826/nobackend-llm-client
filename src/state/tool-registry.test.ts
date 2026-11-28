import { beforeAll, describe, expect, it, vi } from 'vitest';
import { OUTSIDE_CONTENT_NOTE, contributedBuiltinWebSearch, contributedSystemNotes, contributedTools, registerToolProvider, systemPromptFor, toolGroups } from './tool-registry';
import { setChatOptions, moveChatOptions, chatOptionsOf } from './chat-options';
import type { Tool } from '../lib/tools/types';
import type { Conversation, MessageRecord } from '../lib/db/schema';
import type { ModelInfo } from '../lib/providers/types';

const conv = { systemPrompt: 'Be brief.' } as Conversation;
const model = (capabilities: ModelInfo['capabilities']) => ({ capabilities }) as ModelInfo;

describe('system prompt', () => {
  it('tells models that may see outside content to treat it as data, after the user’s own prompt', () => {
    const withTools = systemPromptFor({ conv, messageId: 'm', model: model({ tools: true }), history: [] });
    expect(withTools.startsWith('Be brief.')).toBe(true);
    expect(withTools.endsWith(OUTSIDE_CONTENT_NOTE)).toBe(true);
    const attached = [{ attachments: [{ fileId: 'f' }] }] as unknown as MessageRecord[];
    expect(systemPromptFor({ conv, messageId: 'm', model: model({}), history: attached })).toContain(OUTSIDE_CONTENT_NOTE);
  });
  it('gives them today’s date on this device, the same in every language', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 28, 23, 59) });
    try {
      expect(systemPromptFor({ conv, messageId: 'm', model: model({ webSearch: true }), history: [] })).toBe(`Be brief.\n\nToday's date: 2026-11-28 (Saturday).\n\n${OUTSIDE_CONTENT_NOTE}`);
    } finally {
      vi.useRealTimers();
    }
  });
  it('leaves it out of a plain chat with no tools, search or files', () => {
    expect(systemPromptFor({ conv, messageId: 'm', model: model({}), history: [] })).toBe('Be brief.');
  });
});

describe('a chat’s tool options', () => {
  const tool = (name: string) => ({ name, label: name.toUpperCase(), description: `does ${name}`, parameters: { type: 'object' }, risk: 'read' }) as unknown as Tool;
  // Registered for these tests only (the registry is shared: the tests above must not see them)
  beforeAll(() => {
    registerToolProvider({ id: 'test-a', label: () => 'A', tools: () => [tool('a1'), tool('a2')], systemNote: () => 'note A' });
    registerToolProvider({ id: 'test-b', label: () => 'B', tools: () => [tool('b1')], systemNote: () => 'note B', builtinWebSearch: () => 'auto' });
  });
  const ctx = (id: string) => ({ conv: { ...conv, id } as Conversation, messageId: 'm', model: model({ tools: true }), history: [] });
  const names = (id: string) => contributedTools(ctx(id)).map((x) => x.name);

  it('offers everything by default, and lists each group with what it costs', () => {
    expect(names('c0')).toEqual(['a1', 'a2', 'b1']);
    const groups = toolGroups(ctx('c0'));
    expect(groups.map((g) => [g.id, g.label, g.tools.map((x) => x.name)])).toEqual([['test-a', 'A', ['a1', 'a2']], ['test-b', 'B', ['b1']]]);
    expect(groups[0].tools.every((x) => x.tokens > 0)).toBe(true);
  });

  it('leaves out a tool or a whole group, and a group’s note and built-in search once all of it is off', () => {
    setChatOptions('c1', { off: new Set(['a1']) });
    expect(names('c1')).toEqual(['a2', 'b1']);
    expect(contributedSystemNotes(ctx('c1'))).toBe('note A\n\nnote B');
    setChatOptions('c1', { off: new Set(['a1', 'a2', 'test-b']) });
    expect(names('c1')).toEqual([]);
    expect(contributedSystemNotes(ctx('c1'))).toBe('');
    expect(contributedBuiltinWebSearch(ctx('c1'))).toBe('off');
    // Other chats are not touched
    expect(names('c0')).toEqual(['a1', 'a2', 'b1']);
  });

  it('moves the new chat’s options to the chat it becomes', () => {
    setChatOptions('draft-x', { maxTokens: 2000 });
    moveChatOptions('draft-x', 'c2');
    expect(chatOptionsOf('c2').maxTokens).toBe(2000);
    expect(chatOptionsOf('draft-x').maxTokens).toBeNull();
  });
});
