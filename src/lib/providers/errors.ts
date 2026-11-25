import type { ProviderError } from './types';

export class ProviderFailure extends Error {
  constructor(public readonly error: ProviderError) {
    super(error.message);
  }
}

/** Normalize an HTTP error response into a ProviderError. Body and header contents are used only for the displayed message and never logged. */
export async function errorFromResponse(res: Response, corsHint?: string): Promise<ProviderError> {
  let body: any = null;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return classifyError(res.status, body, res.headers.get('retry-after'), corsHint);
}

export function classifyError(status: number, body: any, retryAfter?: string | null, _corsHint?: string): ProviderError {
  const apiMsg: string | undefined =
    typeof body?.error === 'string' ? body.error : body?.error?.message ?? body?.message ?? body?.details?.message;
  const code: string | undefined = body?.error?.code ?? body?.code;
  const retryAfterMs = parseRetryAfter(retryAfter);

  if (status === 401 && code === 'PRO_ONLY_MODEL') {
    return { kind: 'model-unavailable', status, message: 'このモデルは有料プランでのみ利用できます。', hint: apiMsg };
  }
  switch (true) {
    case status === 401 || status === 403:
      return { kind: 'auth', status, message: 'API キーが無効か、権限がありません。設定でキーを確認してください。', hint: apiMsg };
    case status === 402:
      return { kind: 'insufficient-balance', status, message: '残高が不足しています。プロバイダーの管理画面で残高を確認してください。', hint: apiMsg };
    case status === 429:
      return {
        kind: 'rate-limit',
        status,
        message: retryAfterMs ? `レート制限に達しました。約 ${Math.ceil(retryAfterMs / 1000)} 秒後に再試行してください。` : 'レート制限に達しました。しばらく待ってから再試行してください。',
        retryAfterMs,
        hint: apiMsg
      };
    case status === 404:
      return { kind: 'model-unavailable', status, message: 'モデルまたはエンドポイントが見つかりません。モデル一覧を更新してください。', hint: apiMsg };
    case status >= 400 && status < 500:
      return { kind: 'bad-request', status, message: `リクエストが拒否されました（${status}）。${apiMsg ?? ''}`.trim() };
    default:
      return { kind: 'server', status, message: `プロバイダー側でエラーが発生しました（${status}）。時間をおいて再試行してください。`, hint: apiMsg };
  }
}

/** When fetch itself fails (no response). Browsers report CORS failures only as "Failed to fetch". */
export function errorFromFetchFailure(err: unknown, corsHint?: string): ProviderError {
  if (isAbort(err)) return { kind: 'aborted', message: '停止しました。' };
  return {
    kind: 'network-or-cors',
    message: '接続できませんでした。ネットワークに問題があるか、接続先がブラウザからのアクセス（CORS）を許可していません。',
    hint: corsHint
  };
}

export function isAbort(err: unknown): boolean {
  return (err as any)?.name === 'AbortError';
}

function parseRetryAfter(v?: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return n * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : undefined;
}
