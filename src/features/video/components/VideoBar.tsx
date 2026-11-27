// The option bar shown above the input box in video mode: model, length, resolution, aspect ratio, sound, the
// first frame, and the price
import { useEffect, useRef } from 'preact/hooks';
import * as repo from '../../../lib/db/repo';
import { putImage } from '../../../lib/db/images';
import { openSettings } from '../../../state/ui';
import { Button, Checkbox, Icon, IconButton, Select, Spinner } from '../../../components/ui';
import { ImageThumb } from '../../images';
import { barQuote, chooseVideoModel, currentVideoModel, firstFrame, loadVideoModels, modelRef, offeredModels, paramsFromBar, readyVideoProviders, setVideoDefaults, videoModels, videoModelsError, videoReady } from '../state';
import { videoProviderOf } from '../providers/types';
import { t, usd } from '../messages';
import { formatNumber } from '../../../lib/i18n';

export function VideoBar() {
  const fileRef = useRef<HTMLInputElement>(null);
  // Again whenever a provider gets (or loses) its key
  const ready = readyVideoProviders.value.map((p) => p.id).join();
  useEffect(() => {
    void loadVideoModels();
  }, [ready]);
  if (!videoReady.value)
    return (
      <div class="flex flex-wrap items-center gap-2 px-3 pt-2.5 text-xs text-warn">
        {t('bar.needKey')}
        <Button class="text-xs" variant="outline" onClick={() => openSettings('connections')}>
          <Icon name="key" class="size-3.5" />
          {t('bar.setKey')}
        </Button>
      </div>
    );
  if (!videoModels.value.length)
    return (
      <div class="flex items-center gap-2 px-3 pt-2.5 text-xs text-muted">
        {videoModelsError.value ? (
          <>
            {t('bar.modelsFailed', { error: videoModelsError.value })}
            <Button class="text-xs" onClick={() => void loadVideoModels(true)}>
              <Icon name="refresh" class="size-3.5" />
              {t('bar.retry')}
            </Button>
          </>
        ) : (
          <>
            <Spinner class="size-3" />
            {t('bar.loading')}
          </>
        )}
      </div>
    );
  const m = currentVideoModel.value;
  const list = offeredModels.value;
  const p = paramsFromBar('');
  const q = barQuote.value;
  const price = videoProviderOf(p.providerId)?.quoteIsPrice;
  const frame = firstFrame.value;
  const pickFrame = async (file: File | undefined) => {
    if (!file?.type.startsWith('image/')) return;
    // Kept in the Files tab like any image brought in
    const id = repo.newId();
    await putImage({ id, mime: file.type, origin: { kind: 'upload' }, name: file.name }, file, false);
    firstFrame.value = { blobId: id, name: file.name };
  };
  return (
    <div class="space-y-1.5 px-3 pt-2.5 text-xs" role="group" aria-label={t('bar.group')}>
      <div class="flex flex-wrap items-center gap-1.5">
        {frame ? (
          <span class="flex items-center gap-1 rounded-full border border-line py-0.5 pr-0.5 pl-0.5" title={t('bar.frameName', { name: frame.name ?? t('bar.frameImage') })}>
            <ImageThumb blobId={frame.blobId} alt={t('bar.frame')} class="size-6 rounded-full!" onOpen={() => fileRef.current?.click()} />
            <span class="max-w-[7rem] truncate">{t('bar.frame')}</span>
            <IconButton class="px-1!" label={t('bar.frameClear')} onClick={() => (firstFrame.value = null)}>
              <Icon name="x" class="size-3" />
            </IconButton>
          </span>
        ) : (
          <Button class="text-xs" title={t('bar.frameTitle')} onClick={() => fileRef.current?.click()}>
            <Icon name="image" class="size-3.5" />
            {t('bar.frame')}
          </Button>
        )}
        <input ref={fileRef} type="file" accept="image/*" class="hidden" onChange={(e) => void pickFrame((e.target as HTMLInputElement).files?.[0]).then(() => ((e.target as HTMLInputElement).value = ''))} />
        {list.length ? (
          <Select
            compact
            aria-label={t('videoModel')}
            data-video-model
            class="max-w-[13rem]"
            value={m ? modelRef(m) : ''}
            onChange={(e) => {
              const x = list.find((y) => modelRef(y) === (e.target as HTMLSelectElement).value);
              if (x) void chooseVideoModel(x);
            }}
          >
            {list.map((x) => (
              <option key={modelRef(x)} value={modelRef(x)}>
                {`${videoProviderOf(x.providerId)?.label ?? x.providerId} / ${x.name}`}
              </option>
            ))}
          </Select>
        ) : (
          <span class="text-muted">{frame ? t('bar.noFrameModels') : t('bar.noModels')}</span>
        )}
        {m && m.durations.length > 1 && (
          <Select compact aria-label={t('bar.duration')} value={String(p.duration)} onChange={(e) => void setVideoDefaults({ duration: Number((e.target as HTMLSelectElement).value) })}>
            {m.durations.map((d) => (
              <option key={d} value={d}>
                {t('seconds', { n: formatNumber(d) })}
              </option>
            ))}
          </Select>
        )}
        {m && m.resolutions.length > 1 && (
          <Select compact aria-label={t('bar.resolution')} value={p.resolution ?? ''} onChange={(e) => void setVideoDefaults({ resolution: (e.target as HTMLSelectElement).value })}>
            {m.resolutions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        )}
        {m && !frame && m.aspects.length > 1 && (
          <Select compact aria-label={t('bar.aspect')} value={p.aspectRatio ?? ''} onChange={(e) => void setVideoDefaults({ aspectRatio: (e.target as HTMLSelectElement).value })}>
            {m.aspects.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        )}
        {m?.audio === 'optional' && (
          <Checkbox class="text-muted" checked={!!p.audio} onChange={(v) => void setVideoDefaults({ audio: v })}>
            {t('bar.audio')}
          </Checkbox>
        )}
        <span class="ml-auto text-muted tabular-nums" title={price ? t('bar.costPriceTitle') : t('bar.costEstimateTitle')}>
          {q.asking ? t('bar.costAsking') : q.usd !== undefined ? t(price ? 'bar.costPrice' : 'bar.costEstimate', { cost: usd(q.usd) }) : t('bar.costUnknown')}
        </span>
      </div>
    </div>
  );
}
