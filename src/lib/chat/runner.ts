// Execution loop: repeats "generate → run tools (with approval if needed) → regenerate with the results" up to the step limit (§9).
import type { AuthRef, ChatParams, ProviderConfig, ProviderEvent, ProviderPreset, Transport } from '../providers/types';
import type { Part } from '../providers/types';
import { getAdapter } from '../providers/registry';
import type { MessageRecord } from '../db/schema';
import { fitToContext, inputBudget } from './context';
import { toDefinition, type Permission, type Tool, type ToolContext } from '../tools/types';
import { applyEvent, type BlockMap } from './events';
import { buildRequestMessages, turnMessages } from './request';
import { t } from './messages';

export { applyEvent } from './events';
export { buildRequestMessages, turnMessages } from './request';

export interface RunOptions {
  provider: ProviderConfig;
  preset: ProviderPreset;
  /** Key to attach (the key vault attaches it) */
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
  /** The model's context length. If known, old messages are dropped so it is not exceeded */
  contextLength?: number;
  maxOutputTokens?: number;
  /** Whether to send earlier reasoning back (user setting) */
  resendReasoning?: boolean;
  /** Prompt cache routing key (conversation ID) */
  cacheKey?: string;
  /** Available tools (empty means no tools, i.e. a single step) */
  tools?: Tool[];
  /**
   * Tools added per step (replacing a tool in tools with the same name).
   * Lets a skill's tools become available from the step right after the skill is loaded
   */
  dynamicTools?(turn: MessageRecord): Tool[];
  toolContext?: Omit<ToolContext, 'signal'>;
  permissionFor?(tool: Tool): Permission;
  requestApproval?(req: ApprovalRequest): Promise<ApprovalDecision>;
  /** Use the provider's own web search for this reply (docs/specs/web-and-images.md §2) */
  webSearch?: 'auto' | 'on';
  /** Ask for images in the reply (models that output images) */
  imageOutput?: boolean;
  /** Store a generated image from the reply; returns the file part to add (without it, images are dropped) */
  saveImage?(data: string, mimeType: string): Promise<Extract<Part, { type: 'file' }> | null>;
}

/** Tool approval request (the UI asks the user and answers) */
export interface ApprovalRequest {
  toolCallId: string;
  tool: Tool;
  input: unknown;
  signal: AbortSignal;
}
export interface ApprovalDecision {
  approved: boolean;
  /** "Always allow" */
  always?: boolean;
  reason?: string;
  /** Arguments edited by the user */
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
  const total = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0, webSearches: 0, cost: 0, hasCost: false };
  // A provider may pause a long server-side turn (pause_turn); it is continued a few times at most
  let pauses = 0;
  let steps = maxSteps;
  const callCounts = new Map<string, number>();
  const base = fitToContext(
    buildRequestMessages(o.history, o.systemPrompt, { resendReasoning: o.resendReasoning, providerId: o.provider.id, model: o.model }),
    inputBudget(o.contextLength, o.maxOutputTokens)
  );
  if (base.dropped > 0) msg.meta = { ...msg.meta, truncated: base.dropped };

  for (let step = 0; step < steps; step++) {
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
      webSearch: o.webSearch,
      imageOutput: o.imageOutput,
      signal: o.signal
    };
    let sawTerminal = false;
    let failed = false;
    try {
      for await (let ev of adapter.chat(o.provider, o.preset, o.auth, req, o.transport)) {
        if (ev.type === 'usage') {
          // Sum across steps
          total.inputTokens += ev.usage.inputTokens ?? 0;
          total.outputTokens += ev.usage.outputTokens ?? 0;
          total.reasoningTokens += ev.usage.reasoningTokens ?? 0;
          total.cachedInputTokens += ev.usage.cachedInputTokens ?? 0;
          total.webSearches += ev.usage.webSearches ?? 0;
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
              cachedInputTokens: total.cachedInputTokens || undefined,
              webSearches: total.webSearches || undefined
            },
            costUsd: total.hasCost ? total.cost : undefined
          };
        }
        if (ev.type === 'image') {
          const part = await o.saveImage?.(ev.data, ev.mimeType).catch(() => null);
          if (part) msg.parts.push(part);
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
        applyEvent(msg, { type: 'error', error: { kind: 'aborted', message: t('run.stopped') } }, blocks);
        failed = true;
      } else applyEvent(msg, { type: 'done', reason: 'stop' }, blocks);
    }
    // Finalize parts that were cut off midway
    for (const p of msg.parts) if ((p.type === 'text' || p.type === 'reasoning') && p.state === 'streaming') p.state = 'done';
    if (failed || o.signal.aborted) break;
    // A paused server-side turn: send it back as is to continue (no tools to run)
    if (msg.meta?.finishReason === 'pause' && pauses < 5) {
      pauses++;
      steps++;
      msg.status = 'streaming';
      continue;
    }

    // ---- Running tools ----
    const calls = msg.parts.slice(segStart).filter((p): p is Extract<Part, { type: 'tool' }> => p.type === 'tool');
    if (calls.length === 0 || tools.length === 0) break;
    msg.status = 'streaming';
    let stop = false;
    for (const call of calls) {
      if (o.signal.aborted) break;
      if (call.state === 'output-error') continue; // argument parse failures go back to the model as is
      const tool = tools.find((t) => t.name === call.name);
      if (!tool) {
        call.state = 'output-error';
        call.error = t('run.unknownTool', { name: call.name });
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
        call.error = t('run.repeated');
        stop = true;
        continue;
      }
      const perm = o.permissionFor?.(tool) ?? 'ask';
      if (perm === 'deny') {
        call.state = 'output-denied';
        call.approval = { approved: false, auto: true, reason: t('run.forbidden') };
        continue;
      }
      if (perm === 'ask') {
        call.state = 'approval-requested';
        o.onUpdate(msg);
        await o.persist(msg);
        const d: ApprovalDecision = o.requestApproval
          ? await o.requestApproval({ toolCallId: call.toolCallId, tool, input, signal: o.signal })
          : { approved: false, reason: t('run.noApprovalUi') };
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
        call.error = o.signal.aborted ? t('run.stopped') : (e as Error).message;
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
  // The provider's raw blocks were only needed while the turn ran
  msg.parts = msg.parts.filter((p) => p.type !== 'provider-content');
  for (const p of msg.parts) if (p.type === 'server-tool' && p.state === 'running') p.state = msg.error ? 'error' : 'done';
  o.onUpdate(msg);
  await o.persist(msg);
  return msg;
}
