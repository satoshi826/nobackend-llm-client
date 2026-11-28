// Tools a performance measurement drives (scripts/perf/run.ts, or by hand in the console with `?perf`), as window.__perf.
// Loaded only in perf mode (src/main.tsx), where the app uses a database of its own: nothing here touches real data.
import * as repo from '../lib/db/repo';
import { createFile, newFile, storeBytes } from '../lib/db/files';
import { db, type Conversation, type MessageRecord } from '../lib/db/schema';
import { currentId, currentPath, showMessage, touchConversation } from '../state/conversations';
import { beginRun, endRun } from '../state/runs';
import { saveSettings } from '../state/settings';
import { openModelPicker, openSettings } from '../state/ui';
import type { ModelInfo } from '../lib/providers/types';
import type { PerfCounts } from './counter';
import { generateDataKey } from '../lib/crypto/data';
import { currentDataKey, seal, setDataKey } from '../lib/db/sealed';

/** What to generate. The long conversation is the one scenarios open (its id is LONG_CONVERSATION) */
export interface SeedSpec {
  /** Short conversations (a question and an answer each) */
  conversations?: number;
  /** Messages in the long conversation (questions and answers with Markdown, code and tables) */
  longMessages?: number;
  /** Files, spread over `folders` folders */
  files?: number;
  folders?: number;
  /** Give each file one of the short conversations, in turn, inside that conversation's working folder (the Files tab then lists them by conversation) */
  filesInConversations?: boolean;
  /** Images in the top folder */
  images?: number;
  /** Models of the perf provider, as a long list from an aggregator (prices, context, capabilities, badges) */
  models?: number;
  /** Usage records (one per request), spread over the last year */
  usage?: number;
  /** Skills of the user's own (the model may save many) */
  skills?: number;
}

export const LONG_CONVERSATION = 'perf-long';

/**
 * The provider perf builds add (VITE_CUSTOM_PROVIDERS, set by scripts/perf): needs no key, and points at the mock
 * server, so the chat shows without real keys
 */
export const PERF_PROVIDER = 'perf';

const conversation = (id: string, title: string, at: number, leaf: string | null): Conversation =>
  ({ id, title, createdAt: at, updatedAt: at, currentLeafId: leaf, providerId: PERF_PROVIDER, modelId: 'mock-private-fast', systemPrompt: '', webSearch: 'off', pinned: 0, tags: [] }) as Conversation;

const message = (id: string, conversationId: string, parentId: string | null, role: 'user' | 'assistant', text: string, at: number): MessageRecord =>
  ({ id, conversationId, parentId, role, parts: [{ type: 'text', text, state: 'done' }], createdAt: at, status: 'done' }) as MessageRecord;

/** An answer of the usual kind: paragraphs, a list, a code block and a table */
function answer(n: number): string {
  return [
    `## Step ${n}`,
    `This answer explains part ${n} of the work. It has a few sentences of plain text, with **bold**, *italics* and \`inline code\`, so the Markdown renderer does what it does for real answers.`,
    '- First point of the list\n- Second point, a little longer than the first one\n- Third point',
    '```ts\n' + Array.from({ length: 12 }, (_, i) => `const value${i} = compute(${n}, ${i}); // line ${i}`).join('\n') + '\n```',
    '| Name | Value | Note |\n| --- | --- | --- |\n' + Array.from({ length: 5 }, (_, i) => `| item ${i} | ${n * i} | row ${i} |`).join('\n'),
    'A closing paragraph sums it up and points to what comes next.'
  ].join('\n\n');
}

const fileText = (i: number) => `# Notes ${i}\n\n` + Array.from({ length: 20 + (i % 60) }, (_, k) => `Line ${k} of file ${i}: some words that make it look like a real document.`).join('\n');

async function tinyImage(i: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(64, 48);
  const g = canvas.getContext('2d')!;
  g.fillStyle = `hsl(${(i * 37) % 360} 60% 50%)`;
  g.fillRect(0, 0, 64, 48);
  return canvas.convertToBlob({ type: 'image/png' });
}

/** A model as aggregators list them: varied names, descriptions, dates, prices, context lengths and capabilities */
const model = (i: number): Omit<ModelInfo, 'source'> & { source: 'fetched' } => ({
  providerId: PERF_PROVIDER,
  id: `vendor-${i % 23}/model-${i}`,
  name: `Vendor ${i % 23}: Model ${i} ${['Instruct', 'Chat', 'Coder', 'Vision', 'Mini'][i % 5]}`,
  description:
    i % 6 === 5 ? undefined : `Model ${i} from vendor ${i % 23} is tuned for ${['chat', 'code', 'long documents', 'images', 'agents'][i % 5]}. It follows instructions closely, calls tools and answers in many languages.`,
  releasedAt: i % 8 === 7 ? undefined : Date.UTC(2026, 10, 27) - i * 86_400_000,
  knowledgeCutoff: i % 4 === 0 ? Date.UTC(2025, 5, 30) : undefined,
  contextLength: [8192, 32768, 131072, 1_000_000][i % 4],
  capabilities: { tools: i % 2 === 0, vision: i % 3 === 0, reasoning: i % 4 === 0, webSearch: i % 7 === 0, imageOutput: i % 11 === 0 },
  pricing: { inputPerMTok: (i % 9) * 0.15, outputPerMTok: (i % 9) * 0.6, currency: 'USD', ...(i % 10 === 1 ? { saleEndsAt: Date.UTC(2026, 10, 30, 16) } : {}) },
  privacy: (['private', 'anonymized', 'unknown'] as const)[i % 3],
  tags: i % 13 === 0 ? ['free'] : [],
  source: 'fetched'
});

/** Generate data for measurements (in perf mode's own database). Reload afterwards so the app starts from it */
async function seed(spec: SeedSpec) {
  const now = Date.now();
  // The chat shows only with a provider set up (and the passphrase question answered)
  await saveSettings({ enabledProviders: [PERF_PROVIDER], passphrasePrompted: true });
  // Short conversations in one go (thousands of them), encrypted after encrypt() as the app would store them
  const convs: Conversation[] = [];
  const msgs: MessageRecord[] = [];
  for (let c = 0; c < (spec.conversations ?? 0); c++) {
    const id = `perf-c${c}`;
    const at = now - (c + 2) * 3_600_000;
    msgs.push(message(`${id}-q`, id, null, 'user', `Question ${c}`, at), message(`${id}-a`, id, `${id}-q`, 'assistant', answer(c), at + 1000));
    const conv = conversation(id, `Conversation ${c}`, at, `${id}-a`);
    convs.push(spec.filesInConversations && c < (spec.files ?? 0) ? { ...conv, workDir: `work-${c}/` } : conv);
  }
  const key = currentDataKey();
  const msgRows = key ? await Promise.all(msgs.map((m) => seal('messages', m))) : msgs;
  const convRows = key ? await Promise.all(convs.map((c) => seal('conversations', c))) : convs;
  await db().transaction('rw', db().conversations, db().messages, async () => {
    await db().messages.bulkPut(msgRows);
    await db().conversations.bulkPut(convRows);
  });
  const n = spec.longMessages ?? 0;
  if (n) {
    let parent: string | null = null;
    for (let i = 0; i < n; i++) {
      const id = `${LONG_CONVERSATION}-${i}`;
      const user = i % 2 === 0;
      await repo.putMessage(message(id, LONG_CONVERSATION, parent, user ? 'user' : 'assistant', user ? `Question ${i}: how does part ${i} work?` : answer(i), now - (n - i) * 60_000));
      parent = id;
    }
    await repo.putConversation(conversation(LONG_CONVERSATION, 'Long conversation', now, parent));
  }
  const folders = Math.max(1, spec.folders ?? 1);
  for (let i = 0; i < (spec.files ?? 0); i++) {
    const text = fileText(i);
    const c = spec.filesInConversations && spec.conversations ? i % spec.conversations : null;
    const path = c === null ? `folder-${i % folders}/notes-${i}.md` : `work-${c}/notes-${i}.md`;
    await createFile(newFile({ id: `perf-f${i}`, path, origin: { kind: 'made' }, text, by: 'model', conversationId: c === null ? undefined : `perf-c${c}` }), text);
  }
  if (spec.usage) {
    const n = spec.usage;
    await db().usage.bulkPut(
      Array.from({ length: n }, (_, i) => ({
        id: `perf-u${i}`,
        at: now - Math.floor((i / n) * 365 * 86_400_000),
        providerId: PERF_PROVIDER,
        model: `vendor-${i % 23}/model-${i % 40}`,
        kind: i % 10 === 0 ? ('summary' as const) : ('chat' as const),
        inputTokens: 1000 + (i % 5000),
        cachedInputTokens: i % 3 === 0 ? 500 : 0,
        outputTokens: 200 + (i % 900),
        reasoningTokens: 0,
        costUsd: 0.0005 * (1 + (i % 20)),
        costEstimated: i % 4 === 0 || undefined,
        conversationId: spec.conversations ? `perf-c${i % spec.conversations}` : undefined
      }))
    );
  }
  if (spec.skills)
    await db().skills.bulkPut(
      Array.from({ length: spec.skills }, (_, i) => ({
        id: `perf-s${i}`,
        name: `skill-${String(i).padStart(3, '0')}`,
        description: `Does task ${i}: a sentence that says when to use it, as skill descriptions do.`,
        body: `# Skill ${i}\n\nSteps for task ${i}.`,
        modelInvocable: true,
        createdAt: now - i * 60_000,
        updatedAt: now - i * 60_000
      }))
    );
  if (spec.models) await repo.replaceModels(PERF_PROVIDER, Array.from({ length: spec.models }, (_, i) => model(i)));
  for (let i = 0; i < (spec.images ?? 0); i++) await storeBytes({ id: `perf-i${i}`, mime: 'image/png', origin: { kind: 'upload' }, name: `image-${i}.png` }, await tinyImage(i), false);
}

/**
 * Encrypt what is stored from now on, with a fresh data key held in this page only (as after unlocking with a
 * passphrase). Gone on reload: measure in the same page
 */
async function encrypt() {
  setDataKey(await generateDataKey());
  repo.clearSearchCache();
}

/** The full-text search of the sidebar; resolves with the number of conversations found */
async function search(query: string): Promise<number> {
  return (await repo.searchMessages(query)).length;
}

/** The model picker, as the button by the input box opens it */
function openModels() {
  openModelPicker();
}

/** A tab of the settings, as the app opens it */
function settingsTab(tab: string) {
  openSettings(tab);
}

/** A message sent in conversation `id`: it moves to the top of the list, as after a real one */
function touch(id: string) {
  touchConversation(id);
}

/** Files saved one after another, as when a model or an upload saves many (each save announces a change) */
async function addFiles(n: number) {
  for (let i = 0; i < n; i++) {
    const text = fileText(i);
    await createFile(newFile({ id: `perf-added-${i}`, path: `added/notes-${i}.md`, origin: { kind: 'made' }, text, by: 'model' }), text);
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Write the open conversation's last answer again, as if it streamed: `tokens` pieces of text, `perFrame` of them in
 * each frame, through the same updates a real answer uses. Resolves when it is done
 */
async function stream(o: { tokens: number; perFrame?: number }) {
  const conv = currentId.value;
  const last = currentPath.value.at(-1);
  if (!conv || !last || last.role !== 'assistant') throw new Error('Open a conversation that ends with an answer');
  const words = answer(7).split(/(\s+)/);
  const per = o.perFrame ?? 3;
  let text = '';
  beginRun(conv);
  try {
    for (let i = 0; i < o.tokens; i++) {
      text += words[i % words.length];
      if ((i + 1) % per === 0) {
        showMessage({ ...last, status: 'streaming', parts: [{ type: 'text', text, state: 'streaming' }] });
        await nextFrame();
      }
    }
    showMessage({ ...last, status: 'done', parts: [{ type: 'text', text, state: 'done' }] });
    await nextFrame();
  } finally {
    endRun(conv);
  }
}

/** By hand: `__perf.start()`, do something, `__perf.stop()` prints what was rendered meanwhile */
let mark: { at: number; counts: PerfCounts } | null = null;
const copy = (c: PerfCounts): PerfCounts => ({ ...c, byName: { ...c.byName }, byParent: { ...c.byParent } });
const grown = (now: Record<string, number>, was: Record<string, number>) =>
  Object.entries(now)
    .map(([k, n]) => [k, n - (was[k] ?? 0)] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
function start() {
  mark = { at: performance.now(), counts: copy(window.__perfCounts!) };
}
function stop() {
  if (!mark) throw new Error('Call __perf.start() first');
  const now = window.__perfCounts!;
  const was = mark.counts;
  const byName = grown(now.byName, was.byName);
  const byParent = grown(now.byParent, was.byParent);
  const result = { ms: Math.round(performance.now() - mark.at), renders: now.renders - was.renders, mounts: now.mounts - was.mounts, unmounts: now.unmounts - was.unmounts, commits: now.commits - was.commits };
  console.table(result);
  console.table(Object.fromEntries(byName.slice(0, 25)));
  mark = null;
  return { ...result, byName: Object.fromEntries(byName), byParent: Object.fromEntries(byParent) };
}

export function exposePerfTools() {
  (window as unknown as { __perf: unknown }).__perf = { seed, stream, touch, addFiles, encrypt, search, openModels, settingsTab, start, stop, LONG_CONVERSATION, PERF_PROVIDER };
}
