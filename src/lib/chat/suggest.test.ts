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
    expect(one).toBe('User: third question\n\nAssistant: third answer');
    const two = recentExchanges(path, 2);
    expect(two.startsWith('User: second question')).toBe(true);
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
    expect((msgs[0].parts[0] as { text: string }).text).toContain('write 4 messages');
    expect(msgs[1].role).toBe('user');
  });

  it('asks in English in every UI language, for replies in the user’s language (the UI language when unclear)', () => {
    const sent = () => suggestionMessages(path, 1, 3).map((m) => (m.parts[0] as { text: string }).text);
    const ja = sent();
    expect(ja[0]).toContain('in the language the user writes in (if unclear, in Japanese)');
    expect(ja[1]).toBe('Conversation:\n\nUser: third question\n\nAssistant: third answer');
    setLang('zh');
    try {
      expect(sent()).toEqual([ja[0].replace('Japanese', 'Simplified Chinese'), ja[1]]);
    } finally {
      setLang('ja');
    }
  });

  it('parses JSON arrays, code fences and bullet lists', () => {
    expect(parseSuggestions('["A", "B", "C", "D"]', 3)).toEqual(['A', 'B', 'C']);
    expect(parseSuggestions('Here you go:\n```json\n["もっと詳しく", "例は？"]\n```', 3)).toEqual(['もっと詳しく', '例は？']);
    expect(parseSuggestions('1. 一つ目\n2. 二つ目\n- 三つ目', 3)).toEqual(['一つ目', '二つ目', '三つ目']);
    expect(parseSuggestions('- “Tell me more”\n- 「例は？」', 3)).toEqual(['Tell me more', '例は？']);
    expect(parseSuggestions('["A", "A", 3, "  B  "]', 5)).toEqual(['A', 'B']);
    expect(parseSuggestions('', 3)).toEqual([]);
  });
});
