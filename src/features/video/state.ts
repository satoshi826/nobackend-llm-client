// Video generation: video mode in the input box, the model list, the bar's options and price, and jobs.
// A job runs for minutes: it is saved on its answer as soon as the provider takes it, so waiting goes on after a
// reload (Gemini answers in one request and cannot be resumed). Stopping only stops waiting, and so does a check
// that keeps failing (network, the provider's own trouble): the answer keeps the job, and waiting can start again
// from it. Videos are stored with the images (lib/db/images.ts).
import { computed, effect, signal } from '@preact/signals';
import * as repo from '../../lib/db/repo';
import type { Conversation, MessageRecord, VideoParams } from '../../lib/db/schema';
import { getImage, putImage } from '../../lib/db/images';
import { providerConfigOf } from '../../lib/keys/accounts';
import { plainTransport } from '../../lib/providers/transport';
import { vaultTransport as transport } from '../../lib/vault/client';
import { authFor, keyReady } from '../../state/keys';
import { dataLock } from '../../state/lock';
import { defineFeatureSettings } from '../../state/feature-settings';
import { openSettings, showToast } from '../../state/ui';
import { recordUsage } from '../../state/request-helpers';
import { conversations, currentConv, currentId, liveMessages, messages, persistDraft, putMessage, updateConversation } from '../../state/conversations';
import { beginRun, endRun } from '../../state/runs';
import { cancelSuggestions } from '../../state/suggestions';
import { resetProviderBalanceBaseline } from '../../state/balance';
import { registerUserRequestHandler } from '../../state/tool-registry';
import { imagesVersion } from '../images';
import { veniceVideoProvider } from './providers/venice';
import { openrouterVideoProvider } from './providers/openrouter';
import { geminiVideoProvider } from './providers/gemini';
import { isDone, registerVideoProvider, videoProviderList, videoProviderOf, VideoApiError, type VideoCallContext, type VideoDone, type VideoModelInfo, type VideoProvider } from './providers/types';
import { posterOf } from './poster';
import { t } from './messages';

registerVideoProvider(veniceVideoProvider);
registerVideoProvider(openrouterVideoProvider);
registerVideoProvider(geminiVideoProvider);

export interface VideoDefaults {
  /** The default model ("provider|model" parts); empty: the first one */
  providerId: string;
  model: string;
  duration: number;
  resolution: string;
  aspectRatio: string;
  audio: boolean;
}
const DEFAULTS: VideoDefaults = { providerId: '', model: '', duration: 5, resolution: '720p', aspectRatio: '16:9', audio: true };
export const videoSettings = defineFeatureSettings('video', { videoDefaults: DEFAULTS });

/** Video providers whose key is set; video mode is offered only when there is one */
export const readyVideoProviders = computed(() => videoProviderList().filter((p) => keyReady(p.account)));
export const videoReady = computed(() => readyVideoProviders.value.length > 0);

function providerFor(id: string): VideoProvider {
  const p = videoProviderOf(id);
  if (!p) throw new VideoApiError({ kind: 'bad-request', message: t('err.unsupportedProvider', { id }) });
  return p;
}

function callContext(providerId: string, signal?: AbortSignal): VideoCallContext {
  const p = providerFor(providerId);
  return { config: providerConfigOf(p.account)!, auth: authFor(p.account), transport, signal };
}

// ---- models ----
export const videoModels = signal<VideoModelInfo[]>([]);
export const videoModelsError = signal<string | null>(null);
const cacheKey = (id: string) => `cache:videoModels:${id}`;
let loading: Promise<void> | null = null;

/** Video models of every provider whose key is set (each list cached for 6 hours) */
export function loadVideoModels(force = false): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const errors: string[] = [];
    const lists = await Promise.all(
      readyVideoProviders.value.map(async (p) => {
        const cached = await repo.getSetting<{ at: number; list: VideoModelInfo[] } | null>(cacheKey(p.id), null);
        if (cached && !force && Date.now() - cached.at < 6 * 3600_000) return cached.list;
        try {
          const list = await p.listModels(providerConfigOf(p.account)!, plainTransport);
          await repo.setSetting(cacheKey(p.id), { at: Date.now(), list });
          return list;
        } catch (e) {
          errors.push(`${p.label}: ${(e as Error).message}`);
          return cached?.list ?? [];
        }
      })
    );
    videoModels.value = lists.flat();
    videoModelsError.value = errors.length ? errors.join(' / ') : null;
  })().finally(() => (loading = null));
  return loading;
}

export const modelRef = (m: { providerId: string; id: string }) => `${m.providerId}|${m.id}`;
export function videoModelOf(providerId: string | undefined, id: string | undefined): VideoModelInfo | undefined {
  return videoModels.value.find((m) => m.id === id && (!providerId || m.providerId === providerId));
}

// ---- the bar ----
/** The first frame chosen in the bar (an image of the Files tab); models are then those that start from an image */
export const firstFrame = signal<{ blobId: string; name?: string } | null>(null);
// It belongs to the conversation it was chosen in
effect(() => {
  void currentId.value;
  firstFrame.value = null;
});

/** Models for what the bar starts from: a prompt alone, or a first frame */
export const offeredModels = computed(() => videoModels.value.filter((m) => !m.offline && (firstFrame.value ? m.input !== 'text' : m.input !== 'image')));

function byRef(ref: string | undefined): VideoModelInfo | undefined {
  const i = ref?.indexOf('|') ?? -1;
  return ref && i > 0 ? videoModelOf(ref.slice(0, i), ref.slice(i + 1)) : undefined;
}

/** The model the bar uses: the conversation's choice, else the default, when it fits the bar's start; else the first that does */
export const currentVideoModel = computed(() => {
  const list = offeredModels.value;
  const d = videoSettings.value.value.videoDefaults;
  const fits = (m: VideoModelInfo | undefined) => (m && list.includes(m) ? m : undefined);
  return fits(byRef(currentConv.value.videoModel)) ?? fits(videoModelOf(d.providerId || undefined, d.model || undefined)) ?? list[0];
});

export async function setVideoDefaults(patch: Partial<VideoDefaults>) {
  await videoSettings.save({ videoDefaults: { ...videoSettings.value.value.videoDefaults, ...patch } });
}

/** Choose the model for this conversation, and remember it as the default for new ones */
export async function chooseVideoModel(m: VideoModelInfo) {
  await updateConversation({ videoModel: modelRef(m) });
  await setVideoDefaults({ providerId: m.providerId, model: m.id });
}

/** The saved choice when the model offers it, else its first */
const pick = (list: string[], want: string): string | undefined => (list.includes(want) ? want : list[0]);
/** The length closest to the saved one */
const nearest = (list: number[], want: number): number => list.reduce((best, n) => (Math.abs(n - want) < Math.abs(best - want) ? n : best), list[0] ?? want);

/** Parameters for a request from the bar: the saved choices, fitted to what the model offers */
export function paramsFromBar(prompt: string): VideoParams {
  const d = videoSettings.value.value.videoDefaults;
  const m = currentVideoModel.value;
  return {
    providerId: m?.providerId ?? '',
    model: m?.id ?? '',
    prompt,
    duration: nearest(m?.durations ?? [], d.duration),
    resolution: pick(m?.resolutions ?? [], d.resolution),
    aspectRatio: firstFrame.value ? undefined : pick(m?.aspects ?? [], d.aspectRatio),
    audio: m?.audio === 'optional' ? d.audio : m?.audio === 'always',
    startBlobId: firstFrame.value?.blobId
  };
}

/** The price of the bar's request: undefined while asking or unknown */
export const barQuote = signal<{ key: string; usd?: number; asking: boolean }>({ key: '', asking: false });
let quoteTimer: ReturnType<typeof setTimeout> | undefined;
effect(() => {
  if (!currentConv.value.videoMode || !videoReady.value) return;
  const p = paramsFromBar('');
  const m = videoModelOf(p.providerId, p.model);
  const key = JSON.stringify({ ...p, startBlobId: undefined });
  if (!m || barQuote.peek().key === key) return;
  barQuote.value = { key, asking: true };
  clearTimeout(quoteTimer);
  // Asked once the choices settle (Venice answers through the vault)
  quoteTimer = setTimeout(async () => {
    const usd = await providerFor(p.providerId)
      .quote(p, m, callContext(p.providerId))
      .catch(() => undefined);
    if (barQuote.peek().key === key) barQuote.value = { key, usd, asking: false };
  }, 400);
});

/** Turn video mode on/off for the current conversation (it takes the input box over from image mode) */
export async function setVideoMode(on: boolean) {
  await updateConversation(on ? { videoMode: true, imageMode: false } : { videoMode: false });
  if (on) void loadVideoModels();
  else firstFrame.value = null;
}

/** Start the bar from an image: video mode with it as the first frame */
export async function makeVideoFrom(blobId: string, name?: string) {
  firstFrame.value = { blobId, name };
  await setVideoMode(true);
}

function ensureVideoKey(providerId?: string): boolean {
  if (providerId ? keyReady(videoProviderOf(providerId)?.account ?? providerId) : videoReady.value) return true;
  openSettings('connections');
  showToast(t('bar.needKey'), 'error');
  return false;
}

// ---- jobs ----
/** How far along each running job is (0–1), by answer id */
export const videoProgress = signal<Record<string, number>>({});

/** Answers being waited for (ids only), so waiting goes on after a reload */
const PENDING = 'video:pending';
let pendingWrites = Promise.resolve();
/** One change at a time (jobs finishing together must not drop each other's entry) */
function setPending(convId: string, messageId: string, on: boolean): Promise<void> {
  pendingWrites = pendingWrites.then(async () => {
    const list = (await repo.getSetting<{ convId: string; messageId: string }[]>(PENDING, [])).filter((x) => x.messageId !== messageId);
    await repo.setSetting(PENDING, on ? [...list, { convId, messageId }] : list);
  });
  return pendingWrites;
}

/** Send a video prompt from the input box */
export async function sendVideoPrompt(prompt: string) {
  if (!prompt.trim() || !ensureVideoKey()) return;
  if (!videoModels.value.length) await loadVideoModels();
  const p = paramsFromBar(prompt.trim());
  if (!p.model) {
    showToast(t('err.modelsFailed'), 'error');
    return;
  }
  if (!ensureVideoKey(p.providerId)) return;
  cancelSuggestions();
  const conv = await persistDraft(prompt);
  const user: MessageRecord = {
    id: repo.newId(),
    conversationId: conv.id,
    parentId: currentConv.value.currentLeafId,
    role: 'user',
    parts: [{ type: 'text', text: prompt.trim() }],
    createdAt: Date.now(),
    status: 'done',
    videoRequest: p
  };
  await putMessage(user, conv);
  messages.value = [...messages.value, user];
  firstFrame.value = null;
  await runVideoJob(conv.id, user.id);
}

/** Make a video for a user message (sending, regenerating) */
export async function runVideoJob(convId: string, userMsgId: string, override: Partial<VideoParams> = {}) {
  const conv = conversations.value.find((c) => c.id === convId);
  const user = messages.value.find((m) => m.id === userMsgId);
  if (!conv || !user?.videoRequest) return;
  const p: VideoParams = { ...user.videoRequest, ...override };
  if (!ensureVideoKey(p.providerId)) return;
  const draft: MessageRecord = {
    id: repo.newId(),
    conversationId: conv.id,
    parentId: user.id,
    role: 'assistant',
    parts: [],
    createdAt: Date.now(),
    status: 'streaming',
    meta: { providerId: p.providerId, model: p.model },
    video: { params: p }
  };
  messages.value = [...messages.value, draft];
  await putMessage(draft, conv);
  await updateConversation({ currentLeafId: draft.id, updatedAt: Date.now() }, conv.id);
  await follow(conv, draft);
}

/** Wait again for an answer whose waiting was stopped or cut by a reload */
export async function resumeVideoJob(messageId: string) {
  const m = messages.value.find((x) => x.id === messageId);
  const conv = m && conversations.value.find((c) => c.id === m.conversationId);
  if (!m?.video?.job || !conv) return;
  await follow(conv, { ...m, status: 'streaming', error: undefined });
}

/** An error that says nothing about the job itself: the network, rate limits, the provider's server trouble */
function transient(e: unknown): boolean {
  if (!(e instanceof VideoApiError)) return (e as Error)?.name !== 'AbortError';
  const { kind, status } = e.error;
  return kind === 'network-or-cors' || kind === 'rate-limit' || (kind === 'server' && status !== undefined && status >= 500);
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(new DOMException('aborted', 'AbortError'))), { once: true });
  });

/** Run (or go on with) an answer's job until the video is stored, the job fails, or the user stops waiting */
async function follow(conv: Conversation, msg: MessageRecord) {
  const p = msg.video!.params;
  const provider = providerFor(p.providerId);
  const ctrl = beginRun(conv.id);
  let cur = msg;
  const show = (m: MessageRecord) => {
    cur = m;
    liveMessages.set(m.id, m);
    if (messages.value.some((x) => x.id === m.id)) messages.value = messages.value.map((x) => (x.id === m.id ? m : x));
  };
  show(cur);
  try {
    const ctx = callContext(p.providerId, ctrl.signal);
    const model = videoModelOf(p.providerId, p.model);
    let done: VideoDone | undefined;
    if (!cur.video?.job) {
      // The price shown before sending, recorded unless the provider reports what it charged
      const quote = await provider.quote(p, model, ctx).catch(() => undefined);
      const frame = p.startBlobId ? await getImage(p.startBlobId) : null;
      if (p.startBlobId && !frame) throw new VideoApiError({ kind: 'bad-request', message: t('err.noFrame') });
      const started = await provider.start(p, model, frame, ctx);
      const video = { ...cur.video!, costUsd: quote, costEstimated: !provider.quoteIsPrice };
      if (isDone(started)) {
        done = started;
        cur = { ...cur, video };
      } else {
        // Saved at once: from here on the job can be waited for again after a reload
        show({ ...cur, video: { ...video, job: started } });
        await putMessage(cur, conv);
        if (!conv.temporary) await setPending(conv.id, cur.id, true);
      }
    }
    let failures = 0;
    while (!done) {
      try {
        const r = await provider.check!(cur.video!.job!, ctx);
        failures = 0;
        if (isDone(r)) done = r;
        else if (r.progress !== undefined) videoProgress.value = { ...videoProgress.value, [cur.id]: r.progress };
      } catch (e) {
        // A check that fails for a while (offline, the provider's trouble) does not end the job, which keeps running there
        if (!transient(e) || ++failures >= 5) throw e;
      }
      if (!done) await sleep((provider.pollSeconds ?? 10) * 1000, ctrl.signal);
    }
    const part = await storeVideo(conv, cur.id, done.video);
    const costUsd = done.costUsd ?? cur.video!.costUsd;
    const costEstimated = done.costUsd === undefined && cur.video!.costEstimated;
    cur = { ...cur, parts: [part], status: 'done', video: { ...cur.video!, job: undefined, costUsd, costEstimated } };
    recordUsage({ id: repo.newId(), conversationId: conv.id, providerId: p.providerId, model: p.model, kind: 'video', costUsd, costEstimated, temporary: conv.temporary });
    // Our own spend at a price that may be an estimate: restart the balance comparison instead of adding a guess
    resetProviderBalanceBaseline(p.providerId);
  } catch (e) {
    if (ctrl.signal.aborted) cur = { ...cur, status: 'aborted' };
    else {
      const err = e instanceof VideoApiError ? e.error : { kind: 'server' as const, message: String((e as Error)?.message ?? e) };
      // A job the provider failed or refused is over; one that could not be checked may still finish (waited for again)
      const job = transient(e) ? cur.video!.job : undefined;
      cur = { ...cur, status: 'error', error: { kind: err.kind, message: err.message, hint: err.hint }, video: { ...cur.video!, job, ...(e instanceof VideoApiError && e.suggestedModel ? { suggestedModel: e.suggestedModel } : {}) } };
    }
  } finally {
    endRun(conv.id);
    liveMessages.delete(cur.id);
    const { [cur.id]: _, ...rest } = videoProgress.value;
    videoProgress.value = rest;
  }
  await putMessage(cur, conv);
  // No longer waited for (done, failed, or stopped: waiting again is the user's choice)
  if (!conv.temporary) await setPending(conv.id, cur.id, false);
  if (messages.value.some((m) => m.id === cur.id)) messages.value = messages.value.map((m) => (m.id === cur.id ? cur : m));
  await updateConversation({ updatedAt: Date.now() }, conv.id);
}

/** Store a finished video (with a frame for its thumbnail) and return its file part */
async function storeVideo(conv: Conversation, messageId: string, video: Blob) {
  const blob = video.type.startsWith('video/') ? video : new Blob([video], { type: 'video/mp4' });
  const { poster, width, height } = await posterOf(blob);
  const blobId = repo.newId();
  await putImage({ id: blobId, conversationId: conv.id, messageId, mime: blob.type }, blob, !!conv.temporary, poster ?? undefined);
  imagesVersion.value++;
  return { type: 'file' as const, blobId, name: 'video.mp4', mimeType: blob.type, ...(width ? { width, height } : {}) };
}

// After a reload (or unlocking), go on waiting for the jobs that were running
let resumed = false;
effect(() => {
  const open = dataLock.value === 'none' || dataLock.value === 'unlocked';
  if (resumed || !open || !videoReady.value || !conversations.value.length) return;
  resumed = true;
  void (async () => {
    for (const { convId, messageId } of await repo.getSetting<{ convId: string; messageId: string }[]>(PENDING, [])) {
      const conv = conversations.value.find((c) => c.id === convId);
      const m = conv && (await repo.listMessages(convId)).find((x) => x.id === messageId);
      if (!conv || !m?.video?.job || !keyReady(videoProviderOf(m.video.params.providerId)?.account ?? '')) {
        await setPending(convId, messageId, false);
        continue;
      }
      void follow(conv, { ...m, status: 'streaming' });
    }
  })();
});

/** Who sees the prompt for a model */
export function privacyLabelOf(m: VideoModelInfo | undefined) {
  return (m && videoProviderOf(m.providerId)?.privacyLabel(m)) ?? { tone: 'zinc' as const, label: '', title: '' };
}

// Regenerating / editing a video request makes the video again
registerUserRequestHandler({
  id: 'video',
  matches: (m) => !!m.videoRequest,
  run: (convId, userMsgId) => runVideoJob(convId, userMsgId),
  edit: (orig, text) => (orig.videoRequest ? { videoRequest: { ...orig.videoRequest, prompt: text } } : {})
});
