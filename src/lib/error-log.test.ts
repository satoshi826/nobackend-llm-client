import { describe, expect, it } from 'vitest';
import { noteError, recentErrors } from './error-log';

describe('error log', () => {
  it('keeps the last 20 errors with short, single-line messages', () => {
    for (let i = 0; i < 25; i++) noteError({ source: 'chat', message: `error ${i}\nsecond line` });
    noteError({ source: 'window', message: 'x'.repeat(1000) });
    const list = recentErrors();
    expect(list).toHaveLength(20);
    expect(list[0].message).toBe('error 6 second line');
    expect(list.at(-1)!.message).toHaveLength(300);
  });
});
