// ProviderEvent を下書きメッセージ（パーツ）に反映する
import type { Part, ProviderEvent } from '../providers/types';
import type { MessageRecord } from '../db/schema';

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
