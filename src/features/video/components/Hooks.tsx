// The video feature's pieces for the core screens: the input-box mode, the video model button, the label on a
// request, and the answer (progress while it is made, then the player)
import { useEffect, useState } from 'preact/hooks';
import type { Conversation, MessageRecord } from '../../../lib/db/schema';
import { formatNumber } from '../../../lib/i18n';
import { isStreaming } from '../../../state/runs';
import { Button, Chip, Icon, Shimmer, Spinner } from '../../../components/ui';
import { currentVideoModel, offeredModels, privacyLabelOf, resumeVideoJob, runVideoJob, setVideoMode, videoModelOf, videoProgress, videoProviderReady, videoReady } from '../state';
import { videoProviderOf } from '../providers/types';
import { useBlobUrl } from '../../images';
import { VideoBar } from './VideoBar';
import { t, usd } from '../messages';

/** Toggle in the input box's toolbar; shown only when a provider that makes videos has a key */
export function VideoModeButton({ conv }: { conv: Conversation }) {
  const on = !!conv.videoMode;
  if (!videoReady.value && !on) return null;
  return (
    <Chip aria-pressed={on} on={on} aria-label={t('mode.button')} title={on ? t('mode.titleOn') : t('mode.titleOff')} onClick={() => void setVideoMode(!on)}>
      <Icon name="video" class="size-3.5" />
      <span class="@max-[22rem]:hidden">{on ? t('mode.buttonOn') : t('mode.button')}</span>
    </Chip>
  );
}

/** The option bar above the text area, only in video mode */
export function VideoBarAbove({ conv }: { conv: Conversation }) {
  return conv.videoMode ? <VideoBar /> : null;
}

/** In video mode the input box shows where prompts go: the video model */
export function VideoModelButton() {
  const m = currentVideoModel.value;
  const badge = privacyLabelOf(m);
  const inner = (
    <>
      <Icon name="video" class="size-3.5 shrink-0" />
      <span class="max-w-[11rem] truncate">{m?.name ?? t('videoModel')}</span>
    </>
  );
  const title = badge.title ? `${t('header.title')}\n${badge.title}` : t('header.title');
  // It moves to the bar's model menu, so it is a button only while the bar shows one
  if (!videoReady.value || !offeredModels.value.length) return <span class="flex min-w-0 items-center gap-1 px-2.5 py-1.5 text-xs text-muted" title={title}>{inner}</span>;
  return (
    <button
      type="button"
      class="flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs text-muted transition hover:bg-glass-strong hover:text-ink"
      onClick={() => document.querySelector<HTMLElement>('select[data-video-model]')?.focus()}
      title={title}
    >
      {inner}
    </button>
  );
}

const secondsText = (n: number) => t('seconds', { n: formatNumber(n) });

/** Label above a user message that asked for a video */
export function UserVideoRequest({ m }: { m: MessageRecord }) {
  const r = m.videoRequest;
  if (!r) return null;
  const duration = [secondsText(r.duration), r.resolution, r.aspectRatio].filter(Boolean).join(' · ');
  return (
    <div class="mb-1 flex items-center gap-1 text-xs text-accent-text" title={t('request.title')}>
      <Icon name="video" class="size-3.5" />
      {t(r.startBlobId ? 'request.fromImage' : 'request.label', { duration })}
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span class="tabular-nums">{t('elapsed', { n: formatNumber(Math.max(0, Math.round((now - since) / 1000))) })}</span>;
}

/** A video answer (renders nothing for other messages) */
export function VideoAnswer({ m }: { m: MessageRecord }) {
  return m.video ? <VideoAnswerBody m={m} /> : null;
}

function VideoAnswerBody({ m }: { m: MessageRecord }) {
  const v = m.video!;
  const p = v.params;
  const file = m.parts.find((x): x is Extract<typeof x, { type: 'file' }> => x.type === 'file');
  // The poster first; the video itself (megabytes) only once it is played
  const [playing, setPlaying] = useState(false);
  const poster = useBlobUrl(file?.blobId, 'thumb');
  const src = useBlobUrl(playing ? file?.blobId : undefined);
  const box = file?.width ? { aspectRatio: `${file.width} / ${file.height}` } : { aspectRatio: '16 / 9' };
  const model = videoModelOf(p.providerId, p.model);
  const resumable = !!videoProviderOf(p.providerId)?.check;
  // Waiting again and making again need the provider's key
  const rerun = videoProviderReady(p.providerId);
  if (m.status === 'streaming') {
    const progress = videoProgress.value[m.id];
    return (
      <div class="space-y-1 text-sm text-muted" role="status">
        <div class="flex items-center gap-2">
          <Spinner class="size-4" />
          <Shimmer>{t('answer.making')}</Shimmer>
          {progress !== undefined && <span class="tabular-nums">{t('answer.progress', { p: formatNumber(Math.round(progress * 100)) })}</span>}
          <Elapsed since={m.createdAt} />
        </div>
        <p class="text-xs">{resumable ? t('answer.waitNote') : t('answer.waitNoteOnce')}</p>
      </div>
    );
  }
  return (
    <div class="space-y-2">
      {(m.status === 'aborted' || m.status === 'error') && v.job && (
        <div class="space-y-1.5">
          {m.status === 'aborted' && <p class="text-sm text-muted">{t('answer.stopped')}</p>}
          {rerun && (
            <Button class="text-xs" disabled={isStreaming.value} onClick={() => void resumeVideoJob(m.id)}>
              <Icon name="refresh" class="size-3.5" />
              {t('answer.waitAgain')}
            </Button>
          )}
        </div>
      )}
      {m.status === 'done' && !file && <p class="text-sm text-muted">{t('answer.deleted')}</p>}
      {file &&
        // The box keeps the video's shape (stored with it), so nothing moves when it starts
        (playing && src === null ? (
          <p class="text-sm text-muted">{t('answer.missing')}</p>
        ) : playing && src ? (
          <video src={src} poster={poster ?? undefined} controls autoPlay playsInline class="max-h-[70vh] w-full max-w-xl rounded-lg bg-black" style={box} />
        ) : (
          <button
            type="button"
            class="group relative block max-h-[70vh] w-full max-w-xl overflow-hidden rounded-lg bg-black"
            style={box}
            onClick={() => setPlaying(true)}
            aria-label={t('answer.play')}
          >
            {poster && <img src={poster} alt="" class="h-full w-full object-contain" />}
            <span class="absolute inset-0 grid place-items-center">
              <span class="grid size-12 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm transition group-hover:bg-black/70">
                {playing ? <Spinner class="size-5" /> : <Icon name="play" class="size-5" />}
              </span>
            </span>
          </button>
        ))}
      {m.status === 'done' && (
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{model?.name ?? p.model}</span>
          <span class="tabular-nums">{[secondsText(p.duration), p.resolution, p.aspectRatio].filter(Boolean).join(' · ')}</span>
          {v.costUsd !== undefined && <span class="tabular-nums">{v.costEstimated ? t('answer.costEstimated', { cost: usd(v.costUsd) }) : usd(v.costUsd)}</span>}
        </div>
      )}
      {(m.status === 'done' || m.status === 'error') && m.parentId && rerun && (
        <div class="flex flex-wrap gap-1.5">
          <Button class="text-xs" disabled={isStreaming.value} onClick={() => void runVideoJob(m.conversationId, m.parentId!)}>
            <Icon name="sparkle" class="size-3.5" />
            {t('answer.again')}
          </Button>
          {m.status === 'error' && v.suggestedModel && (
            <Button class="text-xs" variant="outline" disabled={isStreaming.value} onClick={() => void runVideoJob(m.conversationId, m.parentId!, { model: v.suggestedModel })}>
              <Icon name="swap" class="size-3.5" />
              {t('answer.tryModel', { model: v.suggestedModel })}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
