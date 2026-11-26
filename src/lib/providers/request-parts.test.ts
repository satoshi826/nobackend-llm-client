import { describe, expect, it } from 'vitest';
import { systemOf, toolsOf } from './request-parts';

describe('reading a request body back', () => {
  it('finds the system prompt where each provider puts it', () => {
    expect(systemOf({ messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }] })).toBe('S');
    expect(systemOf({ system: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] })).toBe('A\nB');
    expect(systemOf({ systemInstruction: { parts: [{ text: 'G' }] } })).toBe('G');
    expect(systemOf({ messages: [{ role: 'user', content: 'u' }] })).toBeUndefined();
  });
  it('lists function tools of every shape, and provider tools by their type', () => {
    expect(toolsOf({ tools: [{ type: 'function', function: { name: 'a', description: 'A' } }] })).toEqual([{ name: 'a', description: 'A' }]);
    expect(toolsOf({ tools: [{ name: 'b', description: 'B', input_schema: {} }, { type: 'web_search_20250305', name: 'web_search' }] }).map((x) => x.name)).toEqual(['b', 'web_search']);
    expect(toolsOf({ tools: [{ google_search: {} }, { functionDeclarations: [{ name: 'c', description: 'C' }] }] }).map((x) => x.name)).toEqual(['google_search', 'c']);
  });
});
