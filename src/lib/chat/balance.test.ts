import { describe, expect, it } from 'vitest';
import { initialBalanceState, observeBalance, recordSpend } from './balance';

describe('balance monitoring', () => {
  it('does not warn when the drop matches our own usage', () => {
    let s = observeBalance(initialBalanceState(), 10);
    s = recordSpend(s, 0.3);
    s = observeBalance(s, 9.7);
    expect(s.unexplainedUsd).toBe(0);
  });
  it('accumulates the difference when it drops more than our usage', () => {
    let s = observeBalance(initialBalanceState(), 10);
    s = recordSpend(s, 0.1);
    s = observeBalance(s, 9.0);
    expect(s.unexplainedUsd).toBeCloseTo(0.9);
  });
  it('ignores top-ups (increases)', () => {
    let s = observeBalance(initialBalanceState(), 1);
    s = observeBalance(s, 20);
    expect(s.unexplainedUsd).toBe(0);
    expect(s.last?.usd).toBe(20);
  });
});
