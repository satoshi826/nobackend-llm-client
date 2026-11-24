// 送信するメッセージの組み立て（履歴・圧縮・同じターン内のツール呼び出し）
import type { ChatMessage, Part } from '../providers/types';
import type { MessageRecord } from '../db/schema';

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
