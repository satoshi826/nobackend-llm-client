// The option bar shown above the input box in image mode
import { useEffect, useState } from 'preact/hooks';
import { aspectsOf, hasOption } from '../providers/common';
import { ModelOptions } from './ModelOptions';
import { openSettings } from '../../../state/ui';
import { Button, Chevron, Collapse, Select, Spinner, TextField, Checkbox, Icon } from '../../../components/ui';
import {
  currentImageModel,
  defaultImageModel,
  modelRef,
  setConversationImageModel,
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
          <Icon name="key" class="size-3.5" />
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
  const aspects = aspectsOf(m);
  const cost = estimateCost(paramsFromBar(''));
  return (
    <div class="space-y-1.5 px-3 pt-2.5 text-xs" role="group" aria-label={t('bar.group')}>
      <div class="flex flex-wrap items-center gap-1.5">
        <Select compact
          aria-label={t('imageModel')}
          title={t('bar.thisChat')}
          data-image-model
          class="max-w-[13rem]"
          value={m ? modelRef(m) : ''}
          onChange={(e) => {
            const x = list.find((y) => modelRef(y) === (e.target as HTMLSelectElement).value);
            if (x) void setConversationImageModel(x);
          }}
        >
          <ModelOptions list={list} defaultRef={defaultImageModel.value ? modelRef(defaultImageModel.value) : undefined} />
        </Select>
        <Select compact aria-label={t('bar.aspect')} value={aspects.includes(d.aspectRatio) ? d.aspectRatio : (m?.constraints.defaultAspectRatio ?? aspects[0])} onChange={(e) => void setImageDefaults({ aspectRatio: (e.target as HTMLSelectElement).value })}>
          {aspects.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        {!!m?.constraints.resolutions?.length && (
          <Select compact aria-label={m.constraints.resolutionLabel === 'quality' ? t('bar.quality') : t('bar.resolution')} title={m.constraints.resolutionLabel === 'quality' ? t('bar.quality') : t('bar.resolution')} value={d.resolution || m.constraints.defaultResolution || m.constraints.resolutions[0]} onChange={(e) => void setImageDefaults({ resolution: (e.target as HTMLSelectElement).value })}>
            {m.constraints.resolutions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        )}
        <Select compact aria-label={t('bar.count')} value={String(d.variants)} onChange={(e) => void setImageDefaults({ variants: Number((e.target as HTMLSelectElement).value) })}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {imageCount(n)}
            </option>
          ))}
        </Select>
        {hasOption(m, 'styles') && imageStyles.value.length > 0 && (
          <Select compact aria-label={t('bar.style')} class="max-w-[9rem]" value={d.style} onChange={(e) => void setImageDefaults({ style: (e.target as HTMLSelectElement).value })}>
            <option value="">{t('bar.noStyle')}</option>
            {imageStyles.value.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
        <button type="button" class="flex items-center gap-0.5 text-muted hover:text-ink" aria-expanded={details} onClick={() => setDetails(!details)}>
          {t('bar.details')}
          <Chevron open={details} />
        </button>
        <span class="ml-auto text-muted tabular-nums" title={t('bar.costTitle')}>
          {cost !== undefined ? t(d.enhancePrompt ? 'bar.costEnhance' : 'bar.cost', { cost: usd(cost, cost < 0.1 ? 3 : 2) }) : t('bar.costUnknown')}
        </span>
      </div>
      <Collapse open={details}>
        <div class="grid gap-1.5 sm:grid-cols-[1fr_auto]">
          {hasOption(m, 'negativePrompt') && <TextField
            compact
            placeholder={t('bar.negativePlaceholder')}
            value={d.negativePrompt}
            onInput={(e) => void setImageDefaults({ negativePrompt: (e.target as HTMLInputElement).value })}
            aria-label={t('bar.negative')}
          />}
          {hasOption(m, 'seed') && <TextField
            compact
            class="w-32 tabular-nums"
            inputMode="numeric"
            placeholder={t('bar.seedPlaceholder')}
            value={d.seed}
            onInput={(e) => void setImageDefaults({ seed: (e.target as HTMLInputElement).value.replace(/[^\d-]/g, '') })}
            aria-label={t('bar.seed')}
          />}
          {hasOption(m, 'enhance') && <Checkbox class="text-muted sm:col-span-2" checked={d.enhancePrompt} onChange={(v) => void setImageDefaults({ enhancePrompt: v })}>
            {t('bar.enhance')}
          </Checkbox>}
        </div>
      </Collapse>
    </div>
  );
}
