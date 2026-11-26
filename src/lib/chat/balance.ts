// Balance monitoring: if the balance dropped by more than what this app spent (cost),
// warn that the key may be in use elsewhere.

export interface BalanceReading {
  usd: number;
  at: number;
}

export interface BalanceState {
  last: BalanceReading | null;
  /** Total cost this app has settled since last */
  spentSinceLast: number;
  /** Unexplained decrease (cumulative) */
  unexplainedUsd: number;
}

export const initialBalanceState = (): BalanceState => ({ last: null, spentSinceLast: 0, unexplainedUsd: 0 });

/** The balance in a response header is taken as the value before that response was billed. Whatever decrease remains after subtracting our own costs so far counts as an "unexplained decrease". */
export function observeBalance(s: BalanceState, usd: number, at = Date.now(), tolerance = 0.01): BalanceState {
  if (!s.last) return { last: { usd, at }, spentSinceLast: 0, unexplainedUsd: s.unexplainedUsd };
  const drop = s.last.usd - usd;
  const unexplained = drop - s.spentSinceLast;
  return {
    last: { usd, at },
    spentSinceLast: 0,
    unexplainedUsd: s.unexplainedUsd + (unexplained > tolerance ? unexplained : 0)
  };
}

export function recordSpend(s: BalanceState, usd: number): BalanceState {
  return { ...s, spentSinceLast: s.spentSinceLast + Math.max(0, usd) };
}
