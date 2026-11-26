import { describe, expect, it } from 'vitest';
import { OUTSIDE_CONTENT_NOTE, systemPromptFor } from './tool-registry';
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
  it('leaves it out of a plain chat with no tools, search or files', () => {
    expect(systemPromptFor({ conv, messageId: 'm', model: model({}), history: [] })).toBe('Be brief.');
  });
});
