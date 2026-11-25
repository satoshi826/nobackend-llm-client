import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '../db/schema';
import { parseSuggestions, recentExchanges, suggestionMessages } from './suggest';
import { setLang } from '../i18n';

const rec = (id: string, role: MessageRecord['role'], text: string, extra: Partial<MessageRecord> = {}): MessageRecord => ({
  id,
  conversationId: 'c',
  parentId: null,
  role,
  parts: text ? [{ type: 'text', text }] : [],
  createdAt: 0,
  status: 'done',
  ...extra
});

const path = [
  rec('u1', 'user', 'first question'),
  rec('a1', 'assistant', 'first answer'),
  rec('s', 'system', '', { compaction: { summary: 'x', coversUntilId: 'a1', count: 2 } }),
  rec('u2', 'user', 'second question'),
  rec('a2', 'assistant', 'second answer'),
  rec('u3', 'user', 'third question'),
  rec('a3', 'assistant', 'third answer')
];

describe('reply suggestions', () => {
  it('sends only the last N exchanges', () => {
    const one = recentExchanges(path, 1);
    expect(one).toBe('ユーザー: third question\n\nアシスタント: third answer');
    const two = recentExchanges(path, 2);
    expect(two.startsWith('ユーザー: second question')).toBe(true);
    expect(two).not.toContain('first');
    expect(recentExchanges(path, 10)).toContain('first question');
  });

  it('clips long messages, keeping the end', () => {
    const long = recentExchanges([rec('u', 'user', 'q'), rec('a', 'assistant', 'x'.repeat(5000) + 'END')], 1);
    expect(long.length).toBeLessThan(3200);
    expect(long.endsWith('END')).toBe(true);
  });

  it('asks for the requested count as a system instruction', () => {
    const msgs = suggestionMessages(path, 2, 4);
    expect(msgs[0].role).toBe('system');
    expect((msgs[0].parts[0] as { text: string }).text).toContain('4 個');
    expect(msgs[1].role).toBe('user');
  });

  it('asks in the UI language', () => {
    setLang('en');
    try {
      const msgs = suggestionMessages(path, 1, 3);
      const sys = (msgs[0].parts[0] as { text: string }).text;
      expect(sys).toContain('come up with 3 messages');
      expect(sys).toContain('Write in English');
      expect((msgs[1].parts[0] as { text: string }).text).toBe('Conversation:\n\nUser: third question\n\nAssistant: third answer');
    } finally {
      setLang('ja');
    }
    expect((suggestionMessages(path, 1, 3)[0].parts[0] as { text: string }).text).toContain('日本語で書く');
  });

  it('parses JSON arrays, code fences and bullet lists', () => {
    expect(parseSuggestions('["A", "B", "C", "D"]', 3)).toEqual(['A', 'B', 'C']);
    expect(parseSuggestions('Here you go:\n```json\n["もっと詳しく", "例は？"]\n```', 3)).toEqual(['もっと詳しく', '例は？']);
    expect(parseSuggestions('1. 一つ目\n2. 二つ目\n- 三つ目', 3)).toEqual(['一つ目', '二つ目', '三つ目']);
    expect(parseSuggestions('["A", "A", 3, "  B  "]', 5)).toEqual(['A', 'B']);
    expect(parseSuggestions('', 3)).toEqual([]);
  });
});
