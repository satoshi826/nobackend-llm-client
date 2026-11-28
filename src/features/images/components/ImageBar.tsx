// The option bar shown above the input box in image mode
import { useEffect, useState } from 'preact/hooks';
import { hasOption, sizeOf } from '../providers/common';
import { ModelOptions } from './ModelOptions';
import { TAG_PRESETS } from '../presets';
import { openSettings } from '../../../state/ui';
import { Button, Chevron, Collapse, Select, Spinner, TextField, Checkbox, Icon, cx } from '../../../components/ui';
import {
  currentImageModel,
  defaultImageModel,
  modelRef,
  setConversationImageModel,
  estimateCost,
  imageDefaults,
  generationModels,
  imageModelsError,
  imageReady,
  imageStyles,
  loadImageModels,
  loadImageStyles,
  paramsFromBar,
  promptUse,
  setImageDefaults
} from '../state';
import { imageCount, t } from '../messages';
import { formatNumber, formatUsd } from '../../../lib/i18n';

/**
 * Characters left for a model with a prompt limit: its space is kept while it is hidden, so it never moves the bar;
 * it shows in the last fifth before the limit, and over it says why the prompt can't be sent
 */
function PromptRoom({ use }: { use: { n: number; limit: number } }) {
  const left = use.limit - use.n;
  const limit = formatNumber(use.limit);
  return (
    <span class={cx('tabular-nums', left < 0 ? 'text-danger' : 'text-warn', left > use.limit / 5 && 'invisible')} data-tip={t('bar.limitTitle', { limit })}>
      {left < 0 ? t('bar.overLimit', { n: formatNumber(-left), limit }) : t('bar.charsLeft', { n: formatNumber(left) })}
    </span>
  );
}

/** prompt: what is in the input box */
export function ImageBar({ prompt }: { prompt: string }) {
  const [details, setDetails] = useState(false);
  const providerId = currentImageModel.value?.providerId;
  useEffect(() => {
    void loadImageModels();
  }, [imageReady.value]);
  // Styles come from the current model's provider
  useEffect(() => {
    void loadImageStyles();
  }, [imageReady.value, providerId]);
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
  const d = imageDefaults.value;
  const m = currentImageModel.value;
  const list = generationModels.value;
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
  // Menus from the model's sizes: aspect ratios, and the tiers of the chosen aspect when it has several;
  // sizes without an aspect (named by the provider) get one size menu
  const sizes = m?.constraints.sizes ?? [];
  const size = sizeOf(m, d);
  const aspects = [...new Set(sizes.flatMap((s) => (s.aspect ? [s.aspect] : [])))];
  const tiers = sizes.filter((s) => s.aspect && s.aspect === size?.aspect);
  const named = sizes.filter((s) => !s.aspect);
  const tierLabel = m?.constraints.tierLabel === 'quality' ? t('bar.quality') : t('bar.resolution');
  const chooseAspect = (aspect: string) => setImageDefaults({ aspectRatio: aspect, size: sizeOf(m, { aspectRatio: aspect, resolution: size?.tier })?.id ?? '' });
  const counts = [1, 2, 3, 4].slice(0, m?.maxImages ?? 4);
  const params = paramsFromBar(prompt.trim());
  const cost = estimateCost(params);
  const use = promptUse(params);
  const preset = m?.family && TAG_PRESETS[m.family];
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
        {aspects.length > 0 && (
          <Select compact aria-label={t('bar.aspect')} value={size?.aspect ?? ''} onChange={(e) => void chooseAspect((e.target as HTMLSelectElement).value)}>
            {aspects.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        )}
        {tiers.length > 1 && (
          <Select compact aria-label={tierLabel} title={tierLabel} value={size?.id ?? ''} onChange={(e) => void setImageDefaults({ size: (e.target as HTMLSelectElement).value })}>
            {tiers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.tier}
              </option>
            ))}
          </Select>
        )}
        {named.length > 0 && (
          <Select compact aria-label={t('bar.size')} title={t('bar.size')} class="max-w-[10rem]" value={size?.id ?? ''} onChange={(e) => void setImageDefaults({ size: (e.target as HTMLSelectElement).value })}>
            {named.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </Select>
        )}
        {counts.length > 1 && (
          <Select compact aria-label={t('bar.count')} value={String(Math.min(d.variants, counts.length))} onChange={(e) => void setImageDefaults({ variants: Number((e.target as HTMLSelectElement).value) })}>
            {counts.map((n) => (
              <option key={n} value={n}>
                {imageCount(n)}
              </option>
            ))}
          </Select>
        )}
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
        <span class="ml-auto flex gap-2">
          {use && <PromptRoom use={use} />}
          <span class="text-muted tabular-nums" data-tip={t('bar.costTitle')}>
            {cost !== undefined ? t(d.enhancePrompt ? 'bar.costEnhance' : 'bar.cost', { cost: formatUsd(cost) }) : t('bar.costUnknown')}
          </span>
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
          {preset && (
            <div class="sm:col-span-2">
              <Checkbox class="text-muted" checked={d.qualityTags} onChange={(v) => void setImageDefaults({ qualityTags: v })}>
                {t('bar.qualityTags')}
              </Checkbox>
              {d.qualityTags && <p class="pl-6 break-words text-faint">{t(preset.at === 'start' ? 'bar.qualityStart' : 'bar.qualityEnd', { tags: preset.quality })}</p>}
            </div>
          )}
          {hasOption(m, 'enhance') && <Checkbox class="text-muted sm:col-span-2" checked={d.enhancePrompt} onChange={(v) => void setImageDefaults({ enhancePrompt: v })}>
            {t('bar.enhance')}
          </Checkbox>}
        </div>
      </Collapse>
    </div>
  );
}
