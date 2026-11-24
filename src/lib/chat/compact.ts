// 会話の圧縮（古い部分を要約に置き換える）。
// - 元の履歴は消さない。圧縮ノード（compaction）を会話ツリーの末尾に足し、送信時だけ要約に置き換える（runner.buildRequestMessages）
// - 直近のやり取りは要約せずにそのまま残す（細部が必要になりやすいため）
// - 前回の圧縮がある場合は「前回の要約 + その後の会話」をまとめ直す
import type { MessageRecord } from '../db/schema';
import type { AuthRef, ChatMessage, ProviderConfig, ProviderPreset, Transport, Usage } from '../providers/types';
import { getAdapter } from '../providers/registry';
import { estimateTokens, inputBudget, messageTokens } from './context';
import { buildRequestMessages } from './request';

/** 要約せずに残す直近のメッセージ数 */
export const KEEP_RECENT = 4;

export interface CompactionPlan {
  /** 要約に含める前回の要約（あれば） */
  previousSummary: string | null;
  /** 新たに要約するメッセージ */
  toSummarize: MessageRecord[];
  /** ここ（このメッセージ）までを要約で置き換える */
  coversUntilId: string;
}

/** path（root → 末尾の経路）から圧縮の範囲を決める。圧縮するほどの長さがなければ null */
export function planCompaction(path: MessageRecord[], keepRecent = KEEP_RECENT): CompactionPlan | null {
  let start = 0;
  let previousSummary: string | null = null;
  for (let i = path.length - 1; i >= 0; i--) {
    const c = path[i].compaction;
    if (c) {
      previousSummary = c.summary;
      const covered = path.findIndex((m) => m.id === c.coversUntilId);
      start = covered + 1;
      break;
    }
  }
  const candidates = path.slice(start).filter((m) => !m.compaction && m.parts.some((p) => p.type === 'text' && p.text.trim()));
  if (candidates.length <= keepRecent) return null;
  let cut = candidates.length - keepRecent;
  // 残す部分がユーザーの発言から始まるよう、境界をずらす
  while (cut > 0 && candidates[cut].role !== 'user') cut--;
  if (cut <= 0) return null;
  const toSummarize = candidates.slice(0, cut);
  return { previousSummary, toSummarize, coversUntilId: toSummarize[toSummarize.length - 1].id };
}

const SUMMARY_INSTRUCTION = `あなたは会話の記録係です。与えられた会話を、続きの会話に必要な情報を失わないように要約してください。
次の見出しで、箇条書き中心に日本語で書いてください（会話が英語なら英語でかまいません）。

## 目的・話題
## 重要な事実・前提（固有名詞、数値、条件、ユーザーの好みや制約）
## 決まったこと・結論
## 未解決の点・次にやること
## 直近の流れ

- 会話に書かれていないことは書かない
- コードや設定値など、後で正確に必要になりそうなものは要点を残す
- 要約だけを出力し、前置きや挨拶は書かない`;

export function buildTranscript(plan: CompactionPlan, maxTokens?: number | null): string {
  const lines: string[] = [];
  for (const m of plan.toSummarize) {
    const text = m.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text)
      .join('');
    lines.push(`【${m.role === 'user' ? 'ユーザー' : 'アシスタント'}】\n${text}`);
  }
  let body = lines.join('\n\n');
  // 要約に使うモデルの文脈長を超えそうなら、古い側を切る（前回の要約があるので古い側ほど失ってよい）
  if (maxTokens && estimateTokens(body) > maxTokens) {
    while (lines.length > 1 && estimateTokens(lines.join('\n\n')) > maxTokens) lines.shift();
    body = '（ここより前は長すぎるため省略）\n\n' + lines.join('\n\n');
  }
  return (plan.previousSummary ? `# これまでの要約\n${plan.previousSummary}\n\n# その後の会話\n` : '# 会話\n') + body;
}

export interface SummarizeOptions {
  provider: ProviderConfig;
  preset: ProviderPreset;
  auth: AuthRef | undefined;
  transport: Transport;
  model: string;
  contextLength?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
  signal: AbortSignal;
  /** 要約にかかったトークン数と費用（使用量の記録用） */
  onUsage?(usage: Usage, costUsd?: number): void;
}

/** 要約を生成する（思考は捨てて本文だけを集める） */
export async function summarize(plan: CompactionPlan, o: SummarizeOptions): Promise<string> {
  const budget = inputBudget(o.contextLength, 4096);
  const transcript = buildTranscript(plan, budget ? budget - estimateTokens(SUMMARY_INSTRUCTION) - 200 : null);
  const messages: ChatMessage[] = [
    { id: 's', role: 'system', parts: [{ type: 'text', text: SUMMARY_INSTRUCTION }] },
    { id: 'u', role: 'user', parts: [{ type: 'text', text: transcript }] }
  ];
  let out = '';
  for await (const ev of getAdapter(o.provider).chat(
    o.provider,
    o.preset,
    o.auth,
    { model: o.model, messages, params: { maxTokens: 4096, temperature: 0.2 }, providerOptions: o.providerOptions, signal: o.signal },
    o.transport
  )) {
    if (ev.type === 'text-delta') out += ev.delta;
    else if (ev.type === 'usage') o.onUsage?.(ev.usage, ev.costUsd);
    else if (ev.type === 'error') throw new Error(ev.error.message);
  }
  out = out.trim();
  if (!out) throw new Error('要約が空でした。別のモデルで試してください。');
  return out;
}

/** いまの経路を送ったときの概算入力トークン数（圧縮を考慮） */
export function estimateRequestTokens(path: MessageRecord[], systemPrompt: string): number {
  return buildRequestMessages(path, systemPrompt).reduce((n, m) => n + messageTokens(m), 0);
}
