// Developer view (Settings → 情報 → 開発者向け): the exact request bodies sent to the provider for a reply, one per
// step, so a mis-called tool can be traced to what the model was given. Keys are never in them (the key vault adds
// them). Kept in memory only, for the latest replies; locking reloads the page and drops them.
import { signal } from '@preact/signals';
import type { Transport } from '../lib/providers/types';

export interface SentRequest {
  url: string;
  /** The JSON body as sent (parsed), or the raw text when it is not JSON */
  body: unknown;
}

const MAX_REPLIES = 20;
const byReply = new Map<string, SentRequest[]>();
/** Bumped on every recorded request, so readers of sentRequestsOf re-read */
const version = signal(0);

/** The transport for one reply's chat requests, recording each body under the reply's message id */
export function recordingTransport(inner: Transport, replyId: string): Transport {
  return {
    fetch(url, init, auth) {
      let body: unknown = init.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          /* kept as text */
        }
      }
      const list = byReply.get(replyId) ?? [];
      byReply.delete(replyId);
      byReply.set(replyId, [...list, { url, body }]);
      // Only the latest replies are kept
      for (const id of byReply.keys()) if (byReply.size > MAX_REPLIES) byReply.delete(id);
      version.value++;
      return inner.fetch(url, init, auth);
    }
  };
}

/** A reply's recorded requests; reading it in a component or computed subscribes to new ones */
export function sentRequestsOf(replyId: string): SentRequest[] {
  void version.value;
  return byReply.get(replyId) ?? [];
}
