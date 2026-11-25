// The option bar shown above the input box in image mode
import { useEffect, useState } from 'preact/hooks';
import { aspectsOf } from '../providers/venice';
import { openSettings } from '../../../state/ui';
import { Button, Icon, Spinner, cx } from '../../../components/ui';
import {
  currentImageModel,
  estimateCost,
  imageSettings,
  imageModels,
  imageModelsError,
  imageReady,
  imageStyles,
  loadImageModels,
  loadImageStyles,
  paramsFromBar,
  setImageDefaults
} from '../state';
import { imageCount, t, usd } from '../messages';

const sel = 'min-w-0 rounded-md border border-line bg-glass px-1.5 py-0.5 text-xs';

export function ImageBar() {
  const [details, setDetails] = useState(false);
  useEffect(() => {
    void loadImageModels();
    void loadImageStyles();
  }, [imageReady.value]);
  if (!imageReady.value)
    return (
      <div class="flex flex-wrap items-center gap-2 px-3 pt-2.5 text-xs text-warn">
        {t('bar.needKey')}
        <Button class="text-xs" variant="outline" onClick={() => openSettings('connections')}>
          {t('bar.setKey')}
        </Button>
      </div>
    );
  const d = imageSettings.value.value.imageDefaults;
  const m = currentImageModel.value;
  const list = imageModels.value;
  if (!list.length)
    return (
      <div class="flex items-center gap-2 px-3 pt-2.5 text-xs text-muted">
        {imageModelsError.value ? (
          <>
            {t('bar.modelsFailed', { error: imageModelsError.value })}
            <Button class="text-xs" onClick={() => void loadImageModels(true)}>
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
  const aspects = aspectsOf(m);
  const cost = estimateCost(paramsFromBar(''));
  return (
    <div class="space-y-1.5 px-3 pt-2.5 text-xs" role="group" aria-label={t('bar.group')}>
      <div class="flex flex-wrap items-center gap-1.5">
        <select aria-label={t('imageModel')} data-image-model class={cx(sel, 'max-w-[12rem]')} value={m?.id ?? ''} onChange={(e) => void setImageDefaults({ model: (e.target as HTMLSelectElement).value, resolution: '' })}>
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.privacy === 'private' ? x.name : t('bar.relayed', { name: x.name })}
            </option>
          ))}
        </select>
        <select aria-label={t('bar.aspect')} class={sel} value={aspects.includes(d.aspectRatio) ? d.aspectRatio : (m?.constraints.defaultAspectRatio ?? aspects[0])} onChange={(e) => void setImageDefaults({ aspectRatio: (e.target as HTMLSelectElement).value })}>
          {aspects.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {!!m?.constraints.resolutions?.length && (
          <select aria-label={t('bar.resolution')} class={sel} value={d.resolution || m.constraints.defaultResolution || m.constraints.resolutions[0]} onChange={(e) => void setImageDefaults({ resolution: (e.target as HTMLSelectElement).value })}>
            {m.constraints.resolutions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        <select aria-label={t('bar.count')} class={sel} value={String(d.variants)} onChange={(e) => void setImageDefaults({ variants: Number((e.target as HTMLSelectElement).value) })}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {imageCount(n)}
            </option>
          ))}
        </select>
        {imageStyles.value.length > 0 && (
          <select aria-label={t('bar.style')} class={cx(sel, 'max-w-[9rem]')} value={d.style} onChange={(e) => void setImageDefaults({ style: (e.target as HTMLSelectElement).value })}>
            <option value="">{t('bar.noStyle')}</option>
            {imageStyles.value.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <button type="button" class="flex items-center gap-0.5 text-muted hover:text-ink" aria-expanded={details} onClick={() => setDetails(!details)}>
          {t('bar.details')}
          <Icon name="chevron-down" class={cx('size-3 transition', details && 'rotate-180')} />
        </button>
        <span class="ml-auto text-muted tabular-nums" title={t('bar.costTitle')}>
          {cost !== undefined ? t(d.enhancePrompt ? 'bar.costEnhance' : 'bar.cost', { cost: usd(cost, cost < 0.1 ? 3 : 2) }) : t('bar.costUnknown')}
        </span>
      </div>
      {details && (
        <div class="grid gap-1.5 sm:grid-cols-[1fr_auto]">
          <input
            class={cx(sel, 'py-1')}
            placeholder={t('bar.negativePlaceholder')}
            value={d.negativePrompt}
            onInput={(e) => void setImageDefaults({ negativePrompt: (e.target as HTMLInputElement).value })}
            aria-label={t('bar.negative')}
          />
          <input
            class={cx(sel, 'w-32 py-1 tabular-nums')}
            inputMode="numeric"
            placeholder={t('bar.seedPlaceholder')}
            value={d.seed}
            onInput={(e) => void setImageDefaults({ seed: (e.target as HTMLInputElement).value.replace(/[^\d-]/g, '') })}
            aria-label={t('bar.seed')}
          />
          <label class="flex items-center gap-1.5 text-muted sm:col-span-2">
            <input type="checkbox" checked={d.enhancePrompt} onChange={(e) => void setImageDefaults({ enhancePrompt: (e.target as HTMLInputElement).checked })} />
            {t('bar.enhance')}
          </label>
        </div>
      )}
    </div>
  );
}
