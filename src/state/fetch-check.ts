// What the fetch page is told about an address a model asks to fetch (lib/fetcher/provenance.ts): whether it appeared
// in the conversation, and if not, whether the parts the model put together hold text of the conversation.
import * as fdb from '../lib/db/files';
import type { Conversation, MessageRecord } from '../lib/db/schema';
import { fetchableUrl, type FetchCheck } from '../lib/fetcher/protocol';
import { checkAddress, seenFrom, urlsIn, type Content } from '../lib/fetcher/provenance';
import { isInside } from '../lib/paths';
import { conversations, liveMessages } from './conversations';

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

/**
 * Text of the conversation a model could leak: the instructions, the messages (but the words of the user's latest
 * request), their attachments, tool results, and the text files of the working folder
 */
async function content(conv: Conversation, msgs: MessageRecord[], latest: MessageRecord | undefined): Promise<Content[]> {
  const out: Content[] = [];
  if (conv.systemPrompt.trim()) out.push({ place: { kind: 'instructions' }, text: conv.systemPrompt });
  for (const m of msgs) {
    if (m.compaction) out.push({ place: { kind: 'message' }, text: m.compaction.summary });
    for (const s of m.skills ?? []) out.push({ place: { kind: 'message' }, text: s.body });
    for (const a of m.attachments ?? []) out.push({ place: { kind: 'file', name: a.name }, text: a.text });
    for (const p of m.parts) {
      if ((p.type === 'text' && m !== latest) || p.type === 'reasoning') out.push({ place: { kind: 'message' }, text: p.text });
      else if (p.type === 'tool' && p.modelOutput !== undefined) out.push({ place: { kind: 'result' }, text: typeof p.modelOutput === 'string' ? p.modelOutput : JSON.stringify(p.modelOutput) });
    }
  }
  // The folder as it is now: the reply may have made it
  const dir = conversations.value.find((c) => c.id === conv.id)?.workDir ?? conv.workDir;
  if (dir) {
    const files = (await fdb.listFiles()).filter((f) => isInside(f.name, dir));
    const texts = await fdb.readTexts(files.map((f) => f.id));
    for (const f of files) out.push({ place: { kind: 'file', name: f.name.slice(dir.length) }, text: texts.get(f.id) ?? '' });
  }
  return out;
}

/** The check for an address a model in this conversation asks to fetch (undefined: it may be fetched as it is) */
export async function checkFetch(url: string, conv: Conversation, history: MessageRecord[]): Promise<FetchCheck | undefined> {
  const u = fetchableUrl(url);
  if (!u) return undefined;
  const msgs = seenMessages(conv, history);
  const latest = msgs.findLast((m) => m.role === 'user');
  const request = latest?.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n') ?? '';
  return checkAddress(u, seenFrom(seenUrls(msgs)), request, () => content(conv, msgs, latest));
}
