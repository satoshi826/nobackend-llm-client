import { describe, expect, it } from 'vitest';
import { makeRunJavaScriptTool } from './tool';

const runJavaScriptTool = makeRunJavaScriptTool(async () => undefined);
import { RUNNABLE } from '../../lib/markdown/render';
import { runText } from '../../lib/sandbox/client';

describe('sandbox', () => {
  it('asks for non-empty code and summarizes it by its first line', () => {
    expect(() => runJavaScriptTool.prepare({ code: '  ' })).toThrow();
    const i = runJavaScriptTool.prepare({ code: '\nconst a = 1;\nreturn a;' });
    expect(runJavaScriptTool.summarize(i)).toBe('const a = 1;');
    expect(i).toMatchObject({ file_ids: [], dom: false });
    expect(runJavaScriptTool.prepare({ code: 'x', file_ids: ['f1', 3, ''], dom: true })).toMatchObject({ file_ids: ['f1'], dom: true });
  });
  it('offers to run only HTML, SVG and JavaScript code blocks', () => {
    expect(RUNNABLE.html).toBe('html');
    expect(RUNNABLE.js).toBe('js');
    expect(RUNNABLE.python).toBeUndefined();
  });
  it('puts console output first, then the value or the error', () => {
    expect(runText({ logs: ['a', 'b'], result: '3' })).toBe('a\nb\n→ 3');
    expect(runText({ logs: [], error: 'boom' })).toBe('Error: boom');
  });
});
