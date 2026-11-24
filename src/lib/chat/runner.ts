// 実行ループ: 「生成 → ツール実行（必要なら承認）→ 結果を渡して再生成」を上限ステップまで繰り返す（§9）。
import type { AuthRef, ChatParams, ProviderConfig, ProviderEvent, ProviderPreset, Transport } from '../providers/types';
import type { Part } from '../providers/types';
import { getAdapter } from '../providers/registry';
import type { MessageRecord } from '../db/schema';
import { fitToContext, inputBudget } from './context';
import { toDefinition, type Permission, type Tool, type ToolContext } from '../tools/types';
import { applyEvent, type BlockMap } from './events';
import { buildRequestMessages, turnMessages } from './request';

export { applyEvent } from './events';
export { buildRequestMessages, turnMessages } from './request';

export interface RunOptions {
  provider: ProviderConfig;
  preset: ProviderPreset;
  /** 付けるキー（キー金庫が付ける） */
  auth: AuthRef | undefined;
  transport: Transport;
  model: string;
  history: MessageRecord[];
  systemPrompt: string;
  params?: ChatParams;
  providerOptions?: Record<string, Record<string, unknown>>;
  draft: MessageRecord;
  signal: AbortSignal;
  onUpdate(m: MessageRecord): void;
  onEvent?(ev: ProviderEvent): void;
  persist(m: MessageRecord): Promise<void>;
  maxSteps?: number;
  persistIntervalMs?: number;
  /** モデルの文脈長。分かっていれば、超えないよう古いメッセージを省いて送る */
  contextLength?: number;
  maxOutputTokens?: number;
  /** 前回までの思考を送り返すか（ユーザー設定） */
  resendReasoning?: boolean;
  /** プロンプトキャッシュの振り分けキー（会話 ID） */
  cacheKey?: string;
  /** 使えるツール（空ならツールなし＝1 ステップで終わる） */
  tools?: Tool[];
  /**
   * ステップごとに足すツール（同じ名前なら tools を置き換える）。
   * スキルを読み込んだ直後のステップから、そのスキル用のツールを使えるようにするため
   */
  dynamicTools?(turn: MessageRecord): Tool[];
  toolContext?: Omit<ToolContext, 'signal'>;
  permissionFor?(toolName: string): Permission;
  requestApproval?(req: ApprovalRequest): Promise<ApprovalDecision>;
}

/** ツール承認の依頼（UI がユーザーに確認して答える） */
export interface ApprovalRequest {
  toolCallId: string;
  tool: Tool;
  input: unknown;
  signal: AbortSignal;
}
export interface ApprovalDecision {
  approved: boolean;
  /** 「常に許可」 */
  always?: boolean;
  reason?: string;
  /** ユーザーが編集した引数 */
  input?: unknown;
}

export async function runAssistant(o: RunOptions): Promise<MessageRecord> {
  const msg = o.draft;
  msg.status = 'streaming';
  msg.meta = { ...msg.meta, providerId: o.provider.id, model: o.model };
  const adapter = getAdapter(o.provider);
  const baseTools = o.tools ?? [];
  const maxSteps = o.maxSteps ?? (baseTools.length || o.dynamicTools ? 8 : 1);
  const interval = o.persistIntervalMs ?? 1500;
  let lastPersist = Date.now();
  const total = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0, cost: 0, hasCost: false };
  const callCounts = new Map<string, number>();
  const base = fitToContext(
    buildRequestMessages(o.history, o.systemPrompt, { resendReasoning: o.resendReasoning, providerId: o.provider.id, model: o.model }),
    inputBudget(o.contextLength, o.maxOutputTokens)
  );
  if (base.dropped > 0) msg.meta = { ...msg.meta, truncated: base.dropped };

  for (let step = 0; step < maxSteps; step++) {
    const blocks: BlockMap = {};
    const extra = o.dynamicTools?.(msg) ?? [];
    const tools = [...baseTools.filter((t) => !extra.some((x) => x.name === t.name)), ...extra];
    if (step > 0) msg.parts.push({ type: 'step-start' });
    const segStart = msg.parts.length;
    const req = {
      model: o.model,
      messages: [...base.messages, ...turnMessages(msg)],
      params: o.params,
      tools: tools.length ? tools.map(toDefinition) : undefined,
      providerOptions: o.providerOptions,
      cacheKey: o.cacheKey,
      signal: o.signal
    };
    let sawTerminal = false;
    let failed = false;
    try {
      for await (let ev of adapter.chat(o.provider, o.preset, o.auth, req, o.transport)) {
        if (ev.type === 'usage') {
          // ステップをまたいで合計する
          total.inputTokens += ev.usage.inputTokens ?? 0;
          total.outputTokens += ev.usage.outputTokens ?? 0;
          total.reasoningTokens += ev.usage.reasoningTokens ?? 0;
          total.cachedInputTokens += ev.usage.cachedInputTokens ?? 0;
          if (ev.costUsd !== undefined) {
            total.cost += ev.costUsd;
            total.hasCost = true;
          }
          ev = {
            type: 'usage',
            usage: {
              inputTokens: total.inputTokens,
              outputTokens: total.outputTokens,
              reasoningTokens: total.reasoningTokens || undefined,
              cachedInputTokens: total.cachedInputTokens || undefined
            },
            costUsd: total.hasCost ? total.cost : undefined
          };
        }
        applyEvent(msg, ev, blocks);
        o.onEvent?.(ev);
        if (ev.type === 'done') sawTerminal = true;
        if (ev.type === 'error') {
          sawTerminal = true;
          failed = true;
        }
        o.onUpdate(msg);
        if (Date.now() - lastPersist > interval) {
          lastPersist = Date.now();
          await o.persist(msg);
        }
      }
    } catch (e) {
      applyEvent(msg, { type: 'error', error: { kind: o.signal.aborted ? 'aborted' : 'server', message: String((e as Error)?.message ?? e) } }, blocks);
      sawTerminal = true;
      failed = true;
    }
    if (!sawTerminal) {
      if (o.signal.aborted) {
        applyEvent(msg, { type: 'error', error: { kind: 'aborted', message: '停止しました。' } }, blocks);
        failed = true;
      } else applyEvent(msg, { type: 'done', reason: 'stop' }, blocks);
    }
    // 途中で止まったパーツを確定させる
    for (const p of msg.parts) if ((p.type === 'text' || p.type === 'reasoning') && p.state === 'streaming') p.state = 'done';
    if (failed || o.signal.aborted) break;

    // ---- ツールの実行 ----
    const calls = msg.parts.slice(segStart).filter((p): p is Extract<Part, { type: 'tool' }> => p.type === 'tool');
    if (calls.length === 0 || tools.length === 0) break;
    msg.status = 'streaming';
    let stop = false;
    for (const call of calls) {
      if (o.signal.aborted) break;
      if (call.state === 'output-error') continue; // 引数の解析失敗はそのままモデルに返す
      const tool = tools.find((t) => t.name === call.name);
      if (!tool) {
        call.state = 'output-error';
        call.error = `ツール「${call.name}」は使えません。`;
        continue;
      }
      let input: unknown;
      try {
        input = tool.prepare(call.input);
      } catch (e) {
        call.state = 'output-error';
        call.error = (e as Error).message;
        continue;
      }
      call.input = input;
      const sig = call.name + JSON.stringify(input);
      const n = (callCounts.get(sig) ?? 0) + 1;
      callCounts.set(sig, n);
      if (n >= 3) {
        call.state = 'output-error';
        call.error = '同じ呼び出しが繰り返されたため中止しました。';
        stop = true;
        continue;
      }
      const perm = o.permissionFor?.(tool.name) ?? 'ask';
      if (perm === 'deny') {
        call.state = 'output-denied';
        call.approval = { approved: false, auto: true, reason: '設定でこのツールは禁止されています。' };
        continue;
      }
      if (perm === 'ask') {
        call.state = 'approval-requested';
        o.onUpdate(msg);
        await o.persist(msg);
        const d: ApprovalDecision = o.requestApproval
          ? await o.requestApproval({ toolCallId: call.toolCallId, tool, input, signal: o.signal })
          : { approved: false, reason: '承認できる画面がありません。' };
        if (o.signal.aborted) break;
        if (!d.approved) {
          call.state = 'output-denied';
          call.approval = { approved: false, auto: false, reason: d.reason };
          o.onUpdate(msg);
          continue;
        }
        if (d.input !== undefined) {
          try {
            input = tool.prepare(d.input);
            call.input = input;
          } catch (e) {
            call.state = 'output-error';
            call.error = (e as Error).message;
            continue;
          }
        }
        call.approval = { approved: true, auto: false };
      } else {
        call.approval = { approved: true, auto: true };
      }
      call.state = 'input-available';
      call.startedAt = Date.now();
      o.onUpdate(msg);
      try {
        const r = await tool.execute(input, { ...o.toolContext!, signal: o.signal });
        call.modelOutput = r.content;
        call.uiDetails = r.details;
        call.state = r.isError ? 'output-error' : 'output-available';
        if (r.isError) call.error = r.content;
        for (const s of r.sources ?? []) {
          if (!msg.parts.some((p) => p.type === 'source' && p.url === s.url)) msg.parts.push({ type: 'source', url: s.url, title: s.title, snippet: s.snippet });
        }
      } catch (e) {
        call.state = 'output-error';
        call.error = o.signal.aborted ? '停止しました。' : (e as Error).message;
      }
      call.endedAt = Date.now();
      o.onUpdate(msg);
    }
    if (o.signal.aborted) {
      msg.status = 'aborted';
      break;
    }
    if (stop) break;
    if (step === maxSteps - 1) msg.meta = { ...msg.meta, finishReason: 'limit' };
  }
  if (msg.status === 'streaming') msg.status = 'done';
  o.onUpdate(msg);
  await o.persist(msg);
  return msg;
}
