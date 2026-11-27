// Tools a performance measurement drives (scripts/perf/run.ts, or by hand in the console with `?perf`), as window.__perf.
// Loaded only in perf mode (src/main.tsx), where the app uses a database of its own: nothing here touches real data.
import * as repo from '../lib/db/repo';
import { createFile, newFile } from '../lib/db/files';
import { putImage } from '../lib/db/images';
import type { Conversation, MessageRecord } from '../lib/db/schema';
import { currentId, currentPath } from '../state/conversations';
import { scheduleMessageUpdate } from '../state/generation';
import { beginRun, endRun } from '../state/runs';
import { saveSettings } from '../state/settings';
import type { PerfCounts } from '../lib/perf/counter';

/** What to generate. The long conversation is the one scenarios open (its id is LONG_CONVERSATION) */
export interface SeedSpec {
  /** Short conversations (a question and an answer each) */
  conversations?: number;
  /** Messages in the long conversation (questions and answers with Markdown, code and tables) */
  longMessages?: number;
  /** Files, spread over `folders` folders */
  files?: number;
  folders?: number;
  /** Images in the top folder */
  images?: number;
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

/** Generate data for measurements (in perf mode's own database). Reload afterwards so the app starts from it */
async function seed(spec: SeedSpec) {
  const now = Date.now();
  // The chat shows only with a provider set up (and the passphrase question answered)
  await saveSettings({ enabledProviders: [PERF_PROVIDER], passphrasePrompted: true });
  for (let c = 0; c < (spec.conversations ?? 0); c++) {
    const id = `perf-c${c}`;
    const at = now - (c + 2) * 3_600_000;
    await repo.putMessage(message(`${id}-q`, id, null, 'user', `Question ${c}`, at), false);
    await repo.putMessage(message(`${id}-a`, id, `${id}-q`, 'assistant', answer(c), at + 1000), false);
    await repo.putConversation(conversation(id, `Conversation ${c}`, at, `${id}-a`));
  }
  const n = spec.longMessages ?? 0;
  if (n) {
    let parent: string | null = null;
    for (let i = 0; i < n; i++) {
      const id = `${LONG_CONVERSATION}-${i}`;
      const user = i % 2 === 0;
      await repo.putMessage(message(id, LONG_CONVERSATION, parent, user ? 'user' : 'assistant', user ? `Question ${i}: how does part ${i} work?` : answer(i), now - (n - i) * 60_000), false);
      parent = id;
    }
    await repo.putConversation(conversation(LONG_CONVERSATION, 'Long conversation', now, parent));
  }
  const folders = Math.max(1, spec.folders ?? 1);
  for (let i = 0; i < (spec.files ?? 0); i++) {
    const text = fileText(i);
    await createFile(newFile({ id: `perf-f${i}`, name: `folder-${i % folders}/notes-${i}.md`, origin: { kind: 'made' }, text, by: 'model' }), text);
  }
  for (let i = 0; i < (spec.images ?? 0); i++) await putImage({ id: `perf-i${i}`, mime: 'image/png', origin: { kind: 'upload' }, name: `image-${i}.png` }, await tinyImage(i), false);
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
        scheduleMessageUpdate({ ...last, status: 'streaming', parts: [{ type: 'text', text, state: 'streaming' }] });
        await nextFrame();
      }
    }
    scheduleMessageUpdate({ ...last, status: 'done', parts: [{ type: 'text', text, state: 'done' }] });
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
  (window as unknown as { __perf: unknown }).__perf = { seed, stream, start, stop, LONG_CONVERSATION, PERF_PROVIDER };
}
