import { describe, expect, it } from 'vitest';
import { initialBalanceState, observeBalance, recordSpend } from './balance';

describe('残高の監視', () => {
  it('自分の利用分だけ減ったなら警告しない', () => {
    let s = observeBalance(initialBalanceState(), 10);
    s = recordSpend(s, 0.3);
    s = observeBalance(s, 9.7);
    expect(s.unexplainedUsd).toBe(0);
  });
  it('利用分より多く減ったら差額を累計する', () => {
    let s = observeBalance(initialBalanceState(), 10);
    s = recordSpend(s, 0.1);
    s = observeBalance(s, 9.0);
    expect(s.unexplainedUsd).toBeCloseTo(0.9);
  });
  it('チャージ（増加）は無視する', () => {
    let s = observeBalance(initialBalanceState(), 1);
    s = observeBalance(s, 20);
    expect(s.unexplainedUsd).toBe(0);
    expect(s.last?.usd).toBe(20);
  });
});
