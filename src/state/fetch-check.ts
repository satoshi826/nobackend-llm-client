// What the fetch page is told about an address a model asks to fetch (lib/fetcher/provenance.ts): whether it appeared
// in the conversation, and if not, which parts the model put together.
import type { Conversation, MessageRecord } from '../lib/db/schema';
import { fetchableUrl, type FetchCheck } from '../lib/fetcher/protocol';
import { checkAddress, seenFrom, urlsIn } from '../lib/fetcher/provenance';
import { liveMessages } from './conversations';

/** The messages the model has seen: the history sent, and the reply being written (its tool results so far) */
function seenMessages(conv: Conversation, history: MessageRecord[]): MessageRecord[] {
  const turn = [...liveMessages.values()].find((m) => m.conversationId === conv.id && !history.some((h) => h.id === m.id));
  return turn ? [...history, turn] : history;
}

/** Addresses that came from outside the model: the user's messages, sources (search results), links of fetched pages */
function* seenUrls(msgs: MessageRecord[]): Generator<string> {
  for (const m of msgs)
    for (const p of m.parts) {
      if (p.type === 'text' && m.role === 'user') yield* urlsIn(p.text);
      else if (p.type === 'source') yield p.url;
      else if (p.type === 'tool') {
        const links = (p.uiDetails as { links?: unknown } | undefined)?.links;
        if (Array.isArray(links)) yield* links.filter((l): l is string => typeof l === 'string');
      }
    }
}

/** The check for an address a model in this conversation asks to fetch (undefined: it may be fetched as it is) */
export function checkFetch(url: string, conv: Conversation, history: MessageRecord[]): FetchCheck | undefined {
  const u = fetchableUrl(url);
  return u ? checkAddress(u, seenFrom(seenUrls(seenMessages(conv, history)))) : undefined;
}
