// Applies ProviderEvents to the draft message (parts)
import type { Part, ProviderEvent } from '../providers/types';
import type { MessageRecord } from '../db/schema';
import { t } from './messages';
import { inEnglish } from '../i18n';
import { noteError } from '../error-log';

export interface BlockMap {
  /** ProviderEvent index → position in the parts array */
  [index: number]: number;
}

/** Apply one event to the draft message (mutates the message; otherwise written like a pure function) */
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
        if (ev.parseError) {
          const text = () => t('events.parseError', { error: ev.parseError! });
          p.error = text();
          p.modelError = inEnglish(text);
        }
      }
      break;
    }
    case 'source': {
      if (!msg.parts.some((p) => p.type === 'source' && p.url === ev.url)) {
        msg.parts.push({ type: 'source', url: ev.url, title: ev.title, snippet: ev.snippet });
      }
      break;
    }
    case 'server-tool': {
      const { type: _t, ...fields } = ev;
      const p = msg.parts.find((x) => x.type === 'server-tool' && x.id === ev.id);
      if (p) Object.assign(p, fields);
      else msg.parts.push({ type: 'server-tool', ...fields });
      break;
    }
    case 'provider-content': {
      msg.parts.push({ type: 'provider-content', provider: ev.provider, content: ev.content });
      break;
    }
    case 'usage': {
      msg.meta = { ...msg.meta, usage: ev.usage, costUsd: ev.costUsd ?? msg.meta?.costUsd };
      break;
    }
    case 'vendor-state': {
      msg.vendorState = { ...msg.vendorState, ...ev.data };
      break;
    }
    case 'done': {
      msg.status = 'done';
      msg.meta = { ...msg.meta, finishReason: ev.reason };
      break;
    }
    case 'error': {
      msg.status = ev.error.kind === 'aborted' ? 'aborted' : 'error';
      if (ev.error.kind !== 'aborted') {
        const { kind, message, hint, detail, status } = ev.error;
        msg.error = { kind, message, hint, detail, status };
        noteError({ source: 'chat', kind: ev.error.kind, status: ev.error.status, provider: msg.meta?.providerId, message: ev.error.message });
      }
      break;
    }
    case 'start':
    case 'account':
    case 'image': // stored by the runner (needs storage), see runner.ts
      break;
  }
}
