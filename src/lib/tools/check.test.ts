import { describe, expect, it } from 'vitest';
import { checkArguments } from './check';
import { TranslatedError } from '../i18n';

const readFile = {
  name: 'read_file',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string' },
      offset: { type: 'number' },
      limit: { type: 'integer' },
      previous: { type: 'boolean' },
      mode: { type: 'string', enum: ['a', 'b'] },
      ids: { type: 'array', items: { type: 'string' } },
      note: { type: ['string', 'null'] }
    },
    required: ['file_id']
  }
};

/** What the model reads when the arguments do not fit (undefined when they do) */
function refusal(raw: unknown, tool: { name: string; parameters: Record<string, unknown> } = readFile): string | undefined {
  try {
    checkArguments(tool, raw);
    return undefined;
  } catch (e) {
    expect(e).toBeInstanceOf(TranslatedError);
    return (e as TranslatedError).english;
  }
}

describe('checking a call against its parameters', () => {
  it('passes arguments that fit, leaving out optional ones given as null', () => {
    const args = { file_id: 'a.md', offset: 1.5, limit: 3, previous: true, mode: 'b', ids: ['x'], note: 'n' };
    expect(checkArguments(readFile, args)).toEqual(args);
    expect(checkArguments(readFile, { file_id: 'a.md', offset: null, note: null })).toEqual({ file_id: 'a.md' });
  });

  it('names an unknown parameter and lists what the tool takes', () => {
    expect(refusal({ file_id: 'a', name: 'x' })).toBe('Unknown parameter "name". read_file takes: file_id (required), offset, limit, previous, mode, ids, note.');
    expect(refusal({ x: 1 }, { name: 'list', parameters: { type: 'object' } })).toBe('Unknown parameter "x". list takes: nothing.');
  });

  it('names a missing required parameter, null counting as missing', () => {
    expect(refusal({})).toBe('Missing required parameter "file_id".');
    expect(refusal(undefined)).toBe('Missing required parameter "file_id".');
    expect(refusal({ file_id: null })).toBe('Parameter "file_id" must be a string.');
  });

  it('names a value of the wrong type', () => {
    expect(refusal({ file_id: 3 })).toBe('Parameter "file_id" must be a string.');
    expect(refusal({ file_id: 'a', offset: '5' })).toBe('Parameter "offset" must be a number.');
    expect(refusal({ file_id: 'a', limit: 2.5 })).toBe('Parameter "limit" must be an integer.');
    expect(refusal({ file_id: 'a', previous: 'true' })).toBe('Parameter "previous" must be true or false.');
    expect(refusal({ file_id: 'a', ids: 'x' })).toBe('Parameter "ids" must be an array.');
    expect(refusal({ file_id: 'a', ids: ['x', 2] })).toBe('Parameter "ids[1]" must be a string.');
    expect(refusal({ file_id: 'a', mode: 'c' })).toBe('Parameter "mode" must be one of: "a", "b".');
    expect(refusal(['a'])).toBe('The arguments must be an object. read_file takes: file_id (required), offset, limit, previous, mode, ids, note.');
  });

  it('checks only what a schema declares: other properties when it allows them, anything in an untyped parameter', () => {
    const open = { name: 'mcp', parameters: { type: 'object', properties: { q: { type: 'string' }, any: {} }, additionalProperties: true } };
    expect(checkArguments(open, { q: 'x', any: [1], extra: { deep: 1 } })).toEqual({ q: 'x', any: [1], extra: { deep: 1 } });
    expect(refusal({ q: 1 }, open)).toBe('Parameter "q" must be a string.');
  });

  it('shows the user the same refusal in the UI language', () => {
    try {
      checkArguments(readFile, {});
    } catch (e) {
      expect((e as Error).message).toBe('必須の引数「file_id」がありません。');
    }
    expect.assertions(1);
  });
});
