// ChatRunner: ProviderEvent を受けてメッセージ（パーツ）を組み立てるループ。
// ツールがあれば「生成 → ツール実行（必要なら承認）→ 結果を渡して再生成」を上限ステップまで繰り返す（§9）。
import type { ChatMessage, ChatParams, Credential, Part, ProviderConfig, ProviderEvent, ProviderPreset, Transport } from '../providers/types';
import { getAdapter } from '../providers/registry';
import type { MessageRecord } from '../db/schema';
import { fitToContext, inputBudget } from './context';
import { toDefinition, type Permission, type Tool, type ToolContext } from '../tools/types';

export interface BlockMap {
  /** ProviderEvent の index → parts 配列の位置 */
  [index: number]: number;
}

/** 1 イベントを下書きメッセージに反映する（純粋関数的に書き換える） */
export function applyEvent(msg: MessageRecord, ev: ProviderEvent, blocks: BlockMap): void {
  switch (ev.type) {
    case 'text-start':
    case 'reasoning-start': {
      const part: Part = { type: ev.type === 'text-start' ? 'text' : 'reasoning', text: '', state: 'streaming' };
      blocks[ev.index] = msg.parts.push(part) - 1;
      break;
    }
    case 'text-delta':
    case 'reasoning-delta': {
      const p = msg.parts[blocks[ev.index]] as Extract<Part, { type: 'text' | 'reasoning' }> | undefined;
      if (p) p.text += ev.delta;
      break;
    }
    case 'text-end':
    case 'reasoning-end': {
      const p = msg.parts[blocks[ev.index]] as Extract<Part, { type: 'text' | 'reasoning' }> | undefined;
      if (p) p.state = 'done';
      break;
    }
    case 'tool-call-start': {
      blocks[ev.index] = msg.parts.push({ type: 'tool', toolCallId: ev.toolCallId, name: ev.name, argsText: '', state: 'input-streaming' }) - 1;
      break;
    }
    case 'tool-call-delta': {
      const p = msg.parts[blocks[ev.index]];
      if (p?.type === 'tool') p.argsText += ev.argsDelta;
      break;
    }
    case 'tool-call-end': {
      const p = msg.parts[blocks[ev.index]];
      if (p?.type === 'tool') {
        p.input = ev.input;
        p.state = ev.parseError ? 'output-error' : 'input-available';
        if (ev.parseError) p.error = `引数を解析できませんでした: ${ev.parseError}`;
      }
      break;
    }
    case 'source': {
      if (!msg.parts.some((p) => p.type === 'source' && p.url === ev.url)) {
        msg.parts.push({ type: 'source', url: ev.url, title: ev.title, snippet: ev.snippet });
      }
      break;
    }
    case 'usage': {
      msg.meta = { ...msg.meta, usage: ev.usage, costUsd: ev.costUsd ?? msg.meta?.costUsd };
      break;
    }
    case 'vendor-state': {
      msg.vendorState = { ...(msg.vendorState ?? {}), ...ev.data };
      break;
    }
    case 'done': {
      msg.status = 'done';
      msg.meta = { ...msg.meta, finishReason: ev.reason };
      break;
    }
    case 'error': {
      msg.status = ev.error.kind === 'aborted' ? 'aborted' : 'error';
      if (ev.error.kind !== 'aborted') msg.error = { kind: ev.error.kind, message: ev.error.message, hint: ev.error.hint };
      break;
    }
    case 'start':
    case 'account':
      break;
  }
}

export interface BuildOptions {
  /** 前回までの思考（reasoning_content など）をモデルに送り返す。同じプロバイダー・モデルの発言のみ */
  resendReasoning?: boolean;
  providerId?: string;
  model?: string;
}

/**
 * 履歴 → プロバイダーに送るメッセージ。
 * - 思考の本文（reasoning パーツ）は送らない
 * - vendorState（reasoning_content など）は resendReasoning が有効で、同じモデルの発言のときだけ送り返す
 * - 圧縮ノード（compaction）があれば、最後の圧縮で要約した範囲を要約文に置き換える
 *   （要約はシステムプロンプトの末尾に付ける。複数の system メッセージを嫌う API があるため）
 */
export function buildRequestMessages(history: MessageRecord[], systemPrompt: string, opts: BuildOptions = {}): ChatMessage[] {
  let sys = systemPrompt.trim();
  let rest = history;
  let lastCompaction = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].compaction) {
      lastCompaction = i;
      break;
    }
  }
  if (lastCompaction >= 0) {
    const c = history[lastCompaction].compaction!;
    const coveredIdx = history.findIndex((m) => m.id === c.coversUntilId);
    const summaryBlock = `## これまでの会話の要約\n以下は、この会話の前半を要約したものです。続きの会話の文脈として扱ってください。\n\n${c.summary}`;
    sys = sys ? `${sys}\n\n${summaryBlock}` : summaryBlock;
    rest = history.slice(coveredIdx + 1);
  }
  const out: ChatMessage[] = [];
  if (sys) out.push({ id: 'system', role: 'system', parts: [{ type: 'text', text: sys }] });
  for (const m of rest) {
    if (m.compaction) continue;
    if (m.role === 'assistant' && m.status === 'error' && !m.parts.some((p) => p.type === 'text' && p.text)) continue;
    const parts = m.parts.filter((p) => p.type === 'text' || p.type === 'tool');
    if (parts.length === 0) continue;
    const sameModel = !!opts.model && m.meta?.providerId === opts.providerId && m.meta?.model === opts.model;
    out.push({ id: m.id, role: m.role, parts, vendorState: opts.resendReasoning && sameModel ? m.vendorState : undefined });
  }
  return out;
}

export interface RunOptions {
  provider: ProviderConfig;
  preset: ProviderPreset;
  credential: Credential | undefined;
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

/**
 * このターン内のステップ（step-start で区切られる）を、送信用のアシスタント発言とツール結果に変換する。
 * 同じターン内の思考は、ツール呼び出しの続きに必要なモデルがあるため vendorState として送り返す。
 */
export function turnMessages(msg: MessageRecord): ChatMessage[] {
  const out: ChatMessage[] = [];
  let seg: Part[] = [];
  const flush = () => {
    if (seg.some((p) => p.type === 'tool')) {
      const reasoning = seg
        .filter((p) => p.type === 'reasoning')
        .map((p) => (p as { text: string }).text)
        .join('');
      out.push({
        id: `${msg.id}-s${out.length}`,
        role: 'assistant',
        parts: seg.filter((p) => p.type === 'text' || p.type === 'tool'),
        vendorState: reasoning ? { reasoning_content: reasoning } : undefined
      });
    }
    seg = [];
  };
  for (const p of msg.parts) {
    if (p.type === 'step-start') flush();
    else seg.push(p);
  }
  flush();
  return out;
}

export async function runAssistant(o: RunOptions): Promise<MessageRecord> {
  const msg = o.draft;
  msg.status = 'streaming';
  msg.meta = { ...msg.meta, providerId: o.provider.id, model: o.model };
  const adapter = getAdapter(o.provider);
  const tools = o.tools ?? [];
  const maxSteps = o.maxSteps ?? (tools.length ? 8 : 1);
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
      for await (let ev of adapter.chat(o.provider, o.preset, o.credential, req, o.transport)) {
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

export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 40 ? t.slice(0, 40) + '…' : t || '新しいチャット';
}
