// 残高の監視: このアプリで使った分（cost）以上に残高が減っていたら、
// キーが他所で使われている可能性があるとして警告する（docs/design.md §5.3-7）。

export interface BalanceReading {
  usd: number;
  at: number;
}

export interface BalanceState {
  last: BalanceReading | null;
  /** last 以降にこのアプリで確定した費用の合計 */
  spentSinceLast: number;
  /** 説明のつかない減少（累計） */
  unexplainedUsd: number;
}

export const initialBalanceState = (): BalanceState => ({ last: null, spentSinceLast: 0, unexplainedUsd: 0 });

/** 応答ヘッダの残高は「その応答の課金前」の値と考える。直前までの自分の費用を差し引いて残る減少を「説明のつかない減少」とする。 */
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
