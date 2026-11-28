// Image and video answers in the chat, one pattern for both: while made, the same working line; then the result in its
// own shape; recovery (a suggested prompt or model, waiting again) as buttons in the answer. What every answer has
// (regenerate, the model, the cost) is in the line under it, as for a chat answer (AssistantExtra.Footer)
import { useEffect, useState } from 'preact/hooks';
import type { MessageRecord } from '../../../lib/db/schema';
import type { Part } from '../../../lib/providers/types';
import { formatNumber, formatUsd } from '../../../lib/i18n';
import { IdleButton, IdleIconButton } from '../../../components/IdleButton';
import { Disclosure, Icon, Shimmer, Spinner } from '../../../components/ui';
import { MediaGrid, singleBox } from '../../../components/media/Thumb';
import { useBlobUrl } from '../../../components/media/urls';
import { imageModelOf, imageProviderReady, regenerateImage, retryWithSuggestion } from '../image/state';
import { t as ti } from '../image/messages';
import { resumeVideoJob, runVideoJob, videoModelOf, videoProgress, videoProviderReady } from '../video/state';
import { videoProviderOf } from '../video/providers/types';
import { t as tv } from '../video/messages';
import { t } from '../messages';

type FilePart = Extract<Part, { type: 'file' }>;
const filesOf = (m: MessageRecord) => m.parts.filter((x): x is FilePart => x.type === 'file');
const seconds = (n: number) => tv('seconds', { n: formatNumber(n) });

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span class="tabular-nums">{t('working.elapsed', { n: formatNumber(Math.max(0, Math.round((now - since) / 1000))) })}</span>;
}

/** While an image or a video is made */
function Working({ label, since, progress, note }: { label: string; since: number; progress?: number; note?: string }) {
  return (
    <div class="space-y-1 text-sm text-muted" role="status">
      <div class="flex items-center gap-2">
        <Spinner class="size-4" />
        <Shimmer>{label}</Shimmer>
        {progress !== undefined && <span class="tabular-nums">{tv('answer.progress', { p: formatNumber(Math.round(progress * 100)) })}</span>}
        <Elapsed since={since} />
      </div>
      {note && <p class="text-xs">{note}</p>}
    </div>
  );
}

/** A cost as the line under an answer shows it: reported as is, an estimate marked */
const costText = (usd: number | undefined, estimated: boolean | undefined) => (usd === undefined ? undefined : estimated ? t('cost.estimate', { cost: formatUsd(usd) }) : formatUsd(usd));

// ---- images ----
const OP_LABEL = { generate: 'op.generate', upscale: 'op.upscale', edit: 'op.edit', 'remove-bg': 'op.removeBg' } as const;

/** Images a chat model put in its reply (native image output); image answers draw their own */
export function ReplyImages({ m }: { m: MessageRecord }) {
  if (m.image) return null;
  const files = filesOf(m).filter((f) => f.mimeType.startsWith('image/'));
  return files.length ? (
    <div class="my-2">
      <MediaGrid files={files} owner={{ conversationId: m.conversationId, messageId: m.id }} />
    </div>
  ) : null;
}

/** An image answer (renders nothing for other messages) */
export function ImageAnswer({ m }: { m: MessageRecord }) {
  const img = m.image;
  if (!img) return null;
  const files = filesOf(m);
  if (m.status === 'streaming') return <Working label={ti(OP_LABEL[img.params.op])} since={m.createdAt} />;
  // Running it again needs its provider's key
  const rerun = imageProviderReady(img.params.providerId);
  return (
    <div class="space-y-2">
      {m.status === 'done' && !files.length && <p class="text-sm text-muted">{ti('deleted')}</p>}
      <MediaGrid files={files} owner={{ conversationId: m.conversationId, messageId: m.id }} />
      {(img.blurred || !!img.violations) && (
        <p class="text-xs text-warn">{[img.blurred && ti('info.blurred'), !!img.violations && ti('info.violations', { n: img.violations })].filter(Boolean).join(' · ')}</p>
      )}
      {img.enhancedPrompt && (
        <Disclosure class="text-xs" summary={ti('info.enhanced')}>
          <p class="mt-1 whitespace-pre-wrap text-muted">{img.enhancedPrompt}</p>
        </Disclosure>
      )}
      {m.status === 'error' && img.suggestion && rerun && (
        <div class="flex flex-wrap gap-1.5">
          {img.suggestion.prompt && (
            <IdleButton class="text-xs" variant="outline" title={img.suggestion.prompt} onClick={() => void retryWithSuggestion(m.id, 'prompt')}>
              <Icon name="wand" class="size-3.5" />
              {ti('retry.prompt')}
            </IdleButton>
          )}
          {img.suggestion.model && (
            <IdleButton class="text-xs" variant="outline" onClick={() => void retryWithSuggestion(m.id, 'model')}>
              <Icon name="swap" class="size-3.5" />
              {ti('retry.model', { model: img.suggestion.model })}
            </IdleButton>
          )}
        </div>
      )}
    </div>
  );
}

/** The line under an image answer: the same picture again (its seed), the model or what was done, the size, the cost */
export function ImageFooter({ m }: { m: MessageRecord }) {
  const img = m.image!;
  const p = img.params;
  const first = filesOf(m)[0];
  const cost = costText(img.costUsd, img.costEstimated);
  return (
    <>
      {m.status === 'done' && p.op === 'generate' && img.seed !== undefined && imageProviderReady(p.providerId) && (
        <IdleIconButton label={ti('regen.same')} title={ti('regen.sameTitle')} onClick={() => void regenerateImage(m.id, 'same')}>
          <Icon name="history" class="size-3.5" />
        </IdleIconButton>
      )}
      <span class="ml-1 truncate">
        {p.op === 'generate' ? (imageModelOf(p.providerId, p.model)?.name ?? p.model) : p.op === 'upscale' ? ti('info.upscale', { scale: p.scale ?? 2 }) : p.op === 'edit' ? ti('info.edit') : ti('info.removeBg')}
      </span>
      {first?.width && (
        <span class="ml-2 tabular-nums">
          {first.width}×{first.height}
        </span>
      )}
      {img.seed !== undefined && <span class="ml-2 tabular-nums">{ti('info.seed', { seed: img.seed })}</span>}
      {p.style && <span class="ml-2">{p.style}</span>}
      {cost && <span class="ml-2 tabular-nums">{cost}</span>}
    </>
  );
}

// ---- videos ----
/** A video answer (renders nothing for other messages) */
export function VideoAnswer({ m }: { m: MessageRecord }) {
  return m.video ? <VideoAnswerBody m={m} /> : null;
}

function VideoAnswerBody({ m }: { m: MessageRecord }) {
  const v = m.video!;
  const p = v.params;
  const file = filesOf(m)[0];
  // The poster first; the video itself (megabytes) only once it is played
  const [playing, setPlaying] = useState(false);
  const poster = useBlobUrl(file?.fileId, 'thumb');
  const src = useBlobUrl(playing ? file?.fileId : undefined);
  const resumable = !!videoProviderOf(p.providerId)?.check;
  if (m.status === 'streaming') return <Working label={tv('answer.making')} since={m.createdAt} progress={videoProgress.value[m.id]} note={resumable ? tv('answer.waitNote') : tv('answer.waitNoteOnce')} />;
  // Waiting again and making again need the provider's key
  const rerun = videoProviderReady(p.providerId);
  // The box keeps the video's shape (stored with it), so nothing moves when it starts
  const box = singleBox(file?.width ?? 16, file?.height ?? 9);
  return (
    <div class="space-y-2">
      {m.status === 'aborted' && v.job && <p class="text-sm text-muted">{tv('answer.stopped')}</p>}
      {m.status === 'done' && !file && <p class="text-sm text-muted">{tv('answer.deleted')}</p>}
      {file &&
        (playing && src === null ? (
          <p class="text-sm text-muted">{tv('answer.missing')}</p>
        ) : playing && src ? (
          <video src={src} poster={poster ?? undefined} controls autoPlay playsInline class="block rounded-lg bg-black" style={box} />
        ) : (
          <button type="button" class="group relative block overflow-hidden rounded-lg bg-black" style={box} onClick={() => setPlaying(true)} aria-label={tv('answer.play')}>
            {poster && <img src={poster} alt="" class="h-full w-full object-contain" />}
            <span class="absolute inset-0 grid place-items-center">
              <span class="grid size-12 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm transition group-hover:bg-black/70">
                {playing ? <Spinner class="size-5" /> : <Icon name="play" class="size-5" />}
              </span>
            </span>
          </button>
        ))}
      {rerun && (((m.status === 'aborted' || m.status === 'error') && v.job) || (m.status === 'error' && v.suggestedModel && m.parentId)) && (
        <div class="flex flex-wrap gap-1.5">
          {(m.status === 'aborted' || m.status === 'error') && v.job && (
            <IdleButton class="text-xs" variant="outline" onClick={() => void resumeVideoJob(m.id)}>
              <Icon name="refresh" class="size-3.5" />
              {tv('answer.waitAgain')}
            </IdleButton>
          )}
          {m.status === 'error' && v.suggestedModel && m.parentId && (
            <IdleButton class="text-xs" variant="outline" onClick={() => void runVideoJob(m.conversationId, m.parentId!, { model: v.suggestedModel })}>
              <Icon name="swap" class="size-3.5" />
              {tv('answer.tryModel', { model: v.suggestedModel })}
            </IdleButton>
          )}
        </div>
      )}
    </div>
  );
}

/** The line under a video answer: the model, its length and shape, the cost */
export function VideoFooter({ m }: { m: MessageRecord }) {
  const v = m.video!;
  const p = v.params;
  const cost = costText(v.costUsd, v.costEstimated);
  return (
    <>
      <span class="ml-1 truncate">{videoModelOf(p.providerId, p.model)?.name ?? p.model}</span>
      <span class="ml-2 tabular-nums">{[seconds(p.duration), p.resolution, p.aspectRatio].filter(Boolean).join(' · ')}</span>
      {cost && <span class="ml-2 tabular-nums">{cost}</span>}
    </>
  );
}

// ---- requests ----
/** The label above a user message that asked for an image or a video */
export function UserMediaRequest({ m }: { m: MessageRecord }) {
  const r = m.imageRequest;
  const v = m.videoRequest;
  if (!r && !v) return null;
  const text = r
    ? r.op === 'generate'
      ? [ti('request.image'), r.aspectRatio ?? r.size, r.variants > 1 && ti('countMany', { n: formatNumber(r.variants) }), r.qualityTags && ti('request.qualityTags')].filter(Boolean).join(' · ')
      : r.op === 'upscale'
        ? ti('request.upscale')
        : r.op === 'edit'
          ? ti('request.edit')
          : ti('request.removeBg')
    : [tv('request.video'), seconds(v!.duration), v!.resolution, v!.aspectRatio, v!.startFileId && tv('request.fromImage')].filter(Boolean).join(' · ');
  return (
    <div class="mb-1 flex items-center gap-1 text-xs text-accent-text" data-tip={r ? (r.qualityTags ? `${ti('request.title')}\n${r.qualityTags.text}` : ti('request.title')) : tv('request.title')}>
      <Icon name={r ? 'image' : 'video'} class="size-3.5" />
      {text}
    </div>
  );
}
