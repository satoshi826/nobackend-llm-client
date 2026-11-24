// 文脈長の管理: 会話が長くなってモデルの上限を超えそうなら、古いメッセージから省いて送る。
// トークン数は厳密ではない概算（英数字は約 4 文字で 1 トークン、日本語などは 1 文字で約 1 トークン）。
import type { ChatMessage } from '../providers/types';

export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 4 + other);
}

export function messageTokens(m: ChatMessage): number {
  let n = 4; // ロール等のオーバーヘッド
  for (const p of m.parts) {
    if (p.type === 'text') n += estimateTokens(p.text);
    else if (p.type === 'tool') n += estimateTokens(p.argsText) + estimateTokens(typeof p.modelOutput === 'string' ? p.modelOutput : JSON.stringify(p.modelOutput ?? ''));
  }
  return n;
}

/** 入力に使える概算トークン数（出力分を確保し、見積もり誤差のため 1 割の余裕を残す） */
export function inputBudget(contextLength?: number, maxOutputTokens?: number): number | null {
  if (!contextLength || contextLength <= 0) return null;
  const reserve = Math.min(maxOutputTokens ?? 8192, Math.floor(contextLength * 0.3));
  return Math.floor((contextLength - reserve) * 0.9);
}

/**
 * system と最後のメッセージは必ず残し、古いものから省く。
 * 省いた後の先頭（system を除く）がアシスタントの発言にならないよう調整する。
 */
export function fitToContext(messages: ChatMessage[], budget: number | null): { messages: ChatMessage[]; dropped: number } {
  if (budget === null) return { messages, dropped: 0 };
  const sys = messages[0]?.role === 'system' ? [messages[0]] : [];
  let rest = messages.slice(sys.length);
  const total = () => [...sys, ...rest].reduce((n, m) => n + messageTokens(m), 0);
  let dropped = 0;
  while (rest.length > 1 && total() > budget) {
    rest = rest.slice(1);
    dropped++;
    while (rest.length > 1 && rest[0].role !== 'user') {
      rest = rest.slice(1);
      dropped++;
    }
  }
  return { messages: [...sys, ...rest], dropped };
}
