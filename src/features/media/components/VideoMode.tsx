// Video mode's parts of the input box: its options, its model, and the first frame (where attaching is in a chat)
import { useEffect, useRef } from 'preact/hooks';
import { MediaThumb } from '../../../components/media/Thumb';
import { Icon, IconButton, Segmented, Select } from '../../../components/ui';
import { formatNumber, formatUsd } from '../../../lib/i18n';
import { videoProviderOf } from '../video/providers/types';
import {
  modeQuote,
  chooseVideoModel,
  currentVideoModel,
  firstFrame,
  loadVideoModels,
  modelRef,
  offeredModels,
  modeParams,
  pickFirstFrame,
  privacyLabelOf,
  readyVideoProviders,
  setVideoDefaults,
  videoModels,
  videoModelsError,
  videoReady
} from '../video/state';
import { t as tv } from '../video/messages';
import { ModelButton, ModeNotice, OptionRow, OptionsChip, SwitchRow, type ModelEntry } from './Mode';
import { t } from '../messages';

const seconds = (n: number) => tv('seconds', { n: formatNumber(n) });

function Choose<T extends string>({ label, value, items, onChange }: { label: string; value: T; items: { id: T; label: string }[]; onChange(v: T): void }) {
  if (items.length <= 4) return <Segmented size="sm" label={label} value={value} items={items} onChange={onChange} />;
  return (
    <Select compact aria-label={label} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}>
      {items.map((x) => (
        <option key={x.id} value={x.id}>
          {x.label}
        </option>
      ))}
    </Select>
  );
}

/** The video options chip and its popover */
export function VideoOptions() {
  const m = currentVideoModel.value;
  if (!m) return null;
  const p = modeParams('');
  const q = modeQuote.value;
  const price = videoProviderOf(p.providerId)?.quoteIsPrice;
  const cost = q.asking ? tv('bar.costAsking') : q.usd !== undefined ? (price ? formatUsd(q.usd) : t('cost.estimate', { cost: formatUsd(q.usd) })) : t('cost.unknown');
  const summary = [seconds(p.duration), m.resolutions.length > 1 && p.resolution, p.aspectRatio && m.aspects.length > 1 && p.aspectRatio].filter(Boolean).join(' · ');
  return (
    <OptionsChip label={tv('bar.group')} summary={summary} cost={cost} costTitle={price ? tv('bar.costPriceTitle') : tv('bar.costEstimateTitle')}>
      {m.durations.length > 1 && (
        <OptionRow label={tv('bar.duration')}>
          <Choose label={tv('bar.duration')} value={String(p.duration)} items={m.durations.map((d) => ({ id: String(d), label: seconds(d) }))} onChange={(d) => void setVideoDefaults({ duration: Number(d) })} />
        </OptionRow>
      )}
      {m.resolutions.length > 1 && (
        <OptionRow label={tv('bar.resolution')}>
          <Choose label={tv('bar.resolution')} value={p.resolution ?? ''} items={m.resolutions.map((r) => ({ id: r, label: r }))} onChange={(r) => void setVideoDefaults({ resolution: r })} />
        </OptionRow>
      )}
      {/* A video from a first frame takes that image's shape */}
      {!firstFrame.value && m.aspects.length > 1 && (
        <OptionRow label={tv('bar.aspect')}>
          <Choose label={tv('bar.aspect')} value={p.aspectRatio ?? ''} items={m.aspects.map((a) => ({ id: a, label: a }))} onChange={(a) => void setVideoDefaults({ aspectRatio: a })} />
        </OptionRow>
      )}
      {m.audio === 'optional' && <SwitchRow label={tv('bar.audio')} checked={!!p.audio} onChange={(v) => void setVideoDefaults({ audio: v })} />}
      {m.durations.length <= 1 && m.resolutions.length <= 1 && (firstFrame.value || m.aspects.length <= 1) && m.audio !== 'optional' && (
        <p class="py-2.5 text-xs text-muted">{tv('bar.noOptions', { model: m.name })}</p>
      )}
    </OptionsChip>
  );
}

/** Where video prompts go: the conversation's video model, among those that fit the start (a prompt, or a first frame) */
export function VideoModel() {
  // Again whenever a provider gets (or loses) its key
  const ready = readyVideoProviders.value.map((p) => p.id).join();
  useEffect(() => {
    void loadVideoModels();
  }, [ready]);
  const m = currentVideoModel.value;
  const list = offeredModels.value;
  const groups = new Map<string, ModelEntry[]>();
  for (const x of list) {
    const key = videoProviderOf(x.providerId)?.label ?? x.providerId;
    groups.set(key, [...(groups.get(key) ?? []), { ref: modelRef(x), name: x.name, sub: [x.durations.map(seconds).join(' / '), x.resolutions.join(' / ')].filter(Boolean).join(' · '), relayed: x.privacy === 'anonymized' }]);
  }
  return (
    <ModelButton
      icon="video"
      label={tv('videoModel')}
      current={m && { ref: modelRef(m), name: m.name }}
      note={privacyLabelOf(m).title}
      groups={[...groups].map(([provider, models]) => ({ provider, models }))}
      loading={!videoModels.value.length && !videoModelsError.value}
      error={videoModelsError.value}
      retry={() => void loadVideoModels(true)}
      pick={(ref) => {
        const x = list.find((y) => modelRef(y) === ref);
        if (x) void chooseVideoModel(x);
      }}
    />
  );
}

/** Above the text while video mode cannot send */
export function VideoNotice() {
  if (!videoReady.value) return <ModeNotice text={tv('bar.needKey')} action="key" />;
  if (!videoModels.value.length && videoModelsError.value) return <ModeNotice tone="danger" text={t('model.failed', { error: videoModelsError.value })} action={() => void loadVideoModels(true)} />;
  if (videoModels.value.length && !offeredModels.value.length) return <ModeNotice text={firstFrame.value ? tv('bar.noFrameModels') : tv('bar.noModels')} />;
  return null;
}

/** The first frame, inside the box where attaching is in a chat: choose an image, or the one chosen (and a way to take it off) */
export function VideoStart() {
  const input = useRef<HTMLInputElement>(null);
  const frame = firstFrame.value;
  const pick = async (file: File | undefined) => {
    if (file?.type.startsWith('image/')) await pickFirstFrame(file);
  };
  return (
    <span class="flex shrink-0 items-center">
      {frame ? (
        <>
          <span data-tip={tv('bar.frameName', { name: frame.name ?? tv('bar.frameImage') })} class="p-1">
            <MediaThumb blobId={frame.blobId} alt={tv('bar.frame')} class="block size-7 rounded-full!" onOpen={() => input.current?.click()} />
          </span>
          <IconButton class="-ml-1 rounded-full! p-1.5! text-muted hover:text-ink" label={tv('bar.frameClear')} onClick={() => (firstFrame.value = null)}>
            <Icon name="x" class="size-3.5" />
          </IconButton>
        </>
      ) : (
        <IconButton class="rounded-full! p-2! text-muted hover:text-ink" label={tv('bar.frame')} title={tv('bar.frameTitle')} onClick={() => input.current?.click()}>
          <Icon name="image" class="size-4" />
        </IconButton>
      )}
      <input ref={input} type="file" accept="image/*" class="hidden" onChange={(e) => void pick((e.target as HTMLInputElement).files?.[0]).then(() => ((e.target as HTMLInputElement).value = ''))} />
    </span>
  );
}
