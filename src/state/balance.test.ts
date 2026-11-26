import { beforeEach, describe, expect, it } from 'vitest';
import { BALANCE_ALERT_USD, balanceAlerts, balances, observeProviderBalance, recordProviderSpend, resetProviderBalanceBaseline } from './balance';

beforeEach(() => {
  balances.value = {};
});

describe('provider balance alerts', () => {
  it('alerts once the unexplained drop reaches the threshold, after subtracting this app’s own spend', () => {
    observeProviderBalance('p', 10);
    recordProviderSpend('p', 0.3);
    observeProviderBalance('p', 9.5); // dropped 0.5, 0.3 of it ours
    expect(balances.value.p.unexplainedUsd).toBeCloseTo(0.2);
    expect(balanceAlerts.value).toEqual([]);
    observeProviderBalance('p', 9.2);
    expect(balances.value.p.unexplainedUsd).toBeCloseTo(BALANCE_ALERT_USD);
    expect(balanceAlerts.value.map(([id]) => id)).toEqual(['p']);
  });

  it('counts spend only for providers whose balance is being watched', () => {
    recordProviderSpend('unseen', 1);
    expect(balances.value.unseen).toBeUndefined();
  });

  it('starts the comparison afresh after spend of unknown price, keeping what was already unexplained', () => {
    observeProviderBalance('p', 10);
    observeProviderBalance('p', 9); // 1 unexplained
    recordProviderSpend('p', 0.4);
    resetProviderBalanceBaseline('p');
    expect(balances.value.p).toMatchObject({ last: null, spentSinceLast: 0, unexplainedUsd: 1 });
    observeProviderBalance('p', 5); // new baseline, not a drop
    expect(balances.value.p.unexplainedUsd).toBe(1);
    resetProviderBalanceBaseline('unseen');
    expect(balances.value.unseen).toBeUndefined();
  });
});
