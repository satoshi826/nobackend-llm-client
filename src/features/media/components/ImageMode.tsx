// Image mode's parts of the input box: its options, its model, and what goes beside the text (characters left)
import { useEffect } from 'preact/hooks';
import type { ComposerApi } from '../../../components/extensions';
import { Button, Collapse, Icon, Segmented, Select, TextArea, TextField, cx } from '../../../components/ui';
import { formatNumber, formatUsd } from '../../../lib/i18n';
import { hasOption, sizeOf, type TagFamily } from '../image/providers/common';
import { imageProviderOf } from '../image/providers/types';
import { TAG_PRESETS, tagModelLabel } from '../image/presets';
import {
  currentImageModel,
  defaultImageModel,
  estimateCost,
  generationModels,
  imageDefaults,
  imageSettings,
  imageModelsError,
  imageReady,
  imageStyles,
  loadImageModels,
  loadImageStyles,
  modelRef,
  modeParams,
  privacyLabelOf,
  promptUse,
  qualityTagsOf,
  setConversationImageModel,
  setImageDefaults,
  setQualityTags
} from '../image/state';
import { imageCount, t as ti } from '../image/messages';
import { ModelButton, ModeNotice, OptionRow, OptionsButton, SwitchRow, type ModelEntry } from './Mode';
import { t } from '../messages';

/** Choices as a segmented control when they are few, else a menu */
function Choose<T extends string>({ label, value, items, onChange }: { label: string; value: T; items: { id: T; label: string }[]; onChange(v: T): void }) {
  if (items.length <= 4) return <Segmented size="sm" label={label} value={value} items={items} onChange={onChange} />;
  return (
    <Select compact aria-label={label} class="max-w-[10rem]" value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}>
      {items.map((x) => (
        <option key={x.id} value={x.id}>
          {x.label}
        </option>
      ))}
    </Select>
  );
}

/** The quality tags of a tag model's family: on or off, and under the switch the tags themselves, to change */
function QualityTags({ family }: { family: TagFamily }) {
  const on = imageDefaults.value.qualityTags;
  const preset = TAG_PRESETS[family];
  const text = qualityTagsOf(family);
  return (
    <div>
      <SwitchRow label={ti('bar.qualityTags')} checked={on} onChange={(v) => void setImageDefaults({ qualityTags: v })} />
      <Collapse open={on}>
        <div class="space-y-1.5 pb-2.5">
          <TextArea
            compact
            rows={2}
            class="block w-full resize-none"
            value={text}
            aria-label={ti('bar.qualityField', { family: preset.name })}
            onInput={(e) => void setQualityTags(family, (e.target as HTMLTextAreaElement).value)}
          />
          <div class="flex items-center justify-between gap-2">
            <span class="min-w-0 text-xs leading-5 text-muted">{ti(preset.at === 'start' ? 'bar.qualityStart' : 'bar.qualityEnd', { family: preset.name })}</span>
            {/* Its place is kept while the tags are the recommended ones, so nothing moves as they are edited */}
            <Button class={cx('shrink-0 text-xs', text === preset.quality && 'invisible')} onClick={() => void setQualityTags(family, undefined)}>
              <Icon name="refresh" class="size-3.5" />
              {ti('bar.qualityReset')}
            </Button>
          </div>
        </div>
      </Collapse>
    </div>
  );
}

/** The image options button and its popover */
export function ImageOptions() {
  // Styles come from the current model's provider: loaded again when it changes, or when image providers become usable
  const providerId = currentImageModel.value?.providerId;
  const ready = imageReady.value;
  useEffect(() => {
    void loadImageStyles();
  }, [ready, providerId]);
  const m = currentImageModel.value;
  if (!m) return null;
  const d = imageDefaults.value;
  // From the model's sizes: aspect ratios, and the tiers of the chosen aspect when it has several; sizes without an
  // aspect (named by the provider) get one size menu
  const sizes = m.constraints.sizes;
  const size = sizeOf(m, d);
  const aspects = [...new Set(sizes.flatMap((s) => (s.aspect ? [s.aspect] : [])))];
  const tiers = sizes.filter((s) => s.aspect && s.aspect === size?.aspect);
  const named = sizes.filter((s) => !s.aspect);
  const tierLabel = m.constraints.tierLabel === 'quality' ? ti('bar.quality') : ti('bar.resolution');
  const counts = [1, 2, 3, 4].slice(0, m.maxImages ?? 4);
  const variants = Math.min(d.variants, counts.length);
  const styles = hasOption(m, 'styles') ? imageStyles.value : [];
  const cost = estimateCost(modeParams(''));
  const costText = cost !== undefined ? t('cost.estimate', { cost: formatUsd(cost) }) : t('cost.unknown');
  const summary = [size?.aspect ?? size?.id, tiers.length > 1 && size?.tier, variants > 1 && imageCount(variants), styles.length > 0 && d.style].filter(Boolean).join(' · ');
  return (
    <OptionsButton
      label={ti('bar.group')}
      summary={summary}
      cost={d.enhancePrompt && cost !== undefined ? `${costText}+` : costText}
      costTitle={d.enhancePrompt && cost !== undefined ? ti('bar.costEnhance', { cost: formatUsd(cost) }) : ti('bar.costTitle')}
    >
      {aspects.length > 1 && (
        <OptionRow label={ti('bar.aspect')}>
          <Choose
            label={ti('bar.aspect')}
            value={size?.aspect ?? ''}
            items={aspects.map((a) => ({ id: a, label: a }))}
            onChange={(aspect) => void setImageDefaults({ aspectRatio: aspect, size: sizeOf(m, { aspectRatio: aspect, resolution: size?.tier })?.id ?? '' })}
          />
        </OptionRow>
      )}
      {tiers.length > 1 && (
        <OptionRow label={tierLabel}>
          <Choose label={tierLabel} value={size?.id ?? ''} items={tiers.map((s) => ({ id: s.id, label: s.tier ?? s.id }))} onChange={(id) => void setImageDefaults({ size: id })} />
        </OptionRow>
      )}
      {named.length > 1 && (
        <OptionRow label={ti('bar.size')}>
          <Choose label={ti('bar.size')} value={size?.id ?? ''} items={named.map((s) => ({ id: s.id, label: s.id }))} onChange={(id) => void setImageDefaults({ size: id })} />
        </OptionRow>
      )}
      {counts.length > 1 && (
        <OptionRow label={ti('bar.count')}>
          <Segmented size="sm" label={ti('bar.count')} value={String(variants)} items={counts.map((n) => ({ id: String(n), label: formatNumber(n) }))} onChange={(n) => void setImageDefaults({ variants: Number(n) })} />
        </OptionRow>
      )}
      {styles.length > 0 && (
        <OptionRow label={ti('bar.style')}>
          <Select compact aria-label={ti('bar.style')} class="max-w-[10rem]" value={d.style} onChange={(e) => void setImageDefaults({ style: (e.target as HTMLSelectElement).value })}>
            <option value="">{ti('bar.noStyle')}</option>
            {styles.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </OptionRow>
      )}
      {hasOption(m, 'negativePrompt') && (
        <OptionRow label={ti('bar.negative')} wide>
          <TextArea
            compact
            rows={2}
            class="block w-full resize-none"
            placeholder={ti('bar.negativePlaceholder')}
            value={d.negativePrompt}
            aria-label={ti('bar.negative')}
            onInput={(e) => void setImageDefaults({ negativePrompt: (e.target as HTMLTextAreaElement).value })}
          />
        </OptionRow>
      )}
      {hasOption(m, 'seed') && (
        <OptionRow label={ti('bar.seed')}>
          <TextField
            compact
            class="w-36 tabular-nums"
            inputMode="numeric"
            placeholder={ti('bar.seedPlaceholder')}
            value={d.seed}
            aria-label={ti('bar.seed')}
            onInput={(e) => void setImageDefaults({ seed: (e.target as HTMLInputElement).value.replace(/[^\d-]/g, '') })}
          />
        </OptionRow>
      )}
      {m.family && <QualityTags family={m.family} />}
      <OptionRow label={ti('tags.label')} hint={ti('bar.suggestHint')} wide>
        <Segmented
          size="sm"
          label={ti('tags.label')}
          value={imageSettings.value.value.tagSuggestions}
          items={[
            { id: 'auto', label: ti('bar.suggestAuto') },
            { id: 'always', label: ti('bar.suggestAlways') },
            { id: 'off', label: ti('bar.suggestOff') }
          ]}
          onChange={(v) => void imageSettings.save({ tagSuggestions: v })}
        />
      </OptionRow>
      {hasOption(m, 'enhance') && <SwitchRow label={ti('bar.enhance')} checked={d.enhancePrompt} onChange={(v) => void setImageDefaults({ enhancePrompt: v })} />}
    </OptionsButton>
  );
}

/** Where image prompts go: the conversation's image model, chosen from every provider in use */
export function ImageModel() {
  // Loaded again when image providers become usable, or stop being usable
  const ready = imageReady.value;
  useEffect(() => {
    void loadImageModels();
  }, [ready]);
  const m = currentImageModel.value;
  const list = generationModels.value;
  const def = defaultImageModel.value;
  const groups = new Map<string, ModelEntry[]>();
  for (const x of list) {
    const p = imageProviderOf(x.providerId);
    const cost = estimateCost({ ...modeParams(''), providerId: x.providerId, model: x.id, variants: 1, size: undefined });
    const kind = tagModelLabel(x);
    const entry: ModelEntry = {
      ref: modelRef(x),
      name: x.name,
      sub: cost !== undefined ? ti('model.perImage', { cost: formatUsd(cost) }) : t('cost.unknown'),
      relayed: x.privacy === 'anonymized',
      isDefault: !!def && modelRef(def) === modelRef(x),
      badge: kind ? { label: kind, title: ti('model.tagsTitle') } : undefined
    };
    const key = p?.label ?? x.providerId;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return (
    <ModelButton
      icon="image"
      label={ti('imageModel')}
      current={m && { ref: modelRef(m), name: m.name }}
      note={[privacyLabelOf(m).title, ti('bar.thisChat')].filter(Boolean).join('\n')}
      groups={[...groups].map(([provider, models]) => ({ provider, models }))}
      loading={!list.length && !imageModelsError.value}
      error={imageModelsError.value}
      retry={() => void loadImageModels(true)}
      pick={(ref) => {
        const x = list.find((y) => modelRef(y) === ref);
        if (x) void setConversationImageModel(x);
      }}
    />
  );
}

/** Above the text while image mode cannot send */
export function ImageNotice() {
  if (!imageReady.value) return <ModeNotice text={ti('bar.needKey')} action="key" />;
  if (!generationModels.value.length && imageModelsError.value) return <ModeNotice tone="danger" text={t('model.failed', { error: imageModelsError.value })} action={() => void loadImageModels(true)} />;
  return null;
}

/** Beside the text: the characters left for a model with a prompt limit (in the last fifth before it, and over it why the prompt can't be sent) */
export function ImageEnd({ api }: { api: ComposerApi }) {
  const use = promptUse(modeParams(api.text.trim()));
  const left = use && use.limit - use.n;
  if (!use || left === undefined || left > use.limit / 5) return null;
  return (
    <span class={cx('shrink-0 self-center px-1 text-xs tabular-nums', left < 0 ? 'text-danger' : 'text-warn')} data-tip={ti('bar.limitTitle', { limit: formatNumber(use.limit) })}>
      {left < 0 ? ti('bar.overLimit', { n: formatNumber(-left), limit: formatNumber(use.limit) }) : ti('bar.charsLeft', { n: formatNumber(left) })}
    </span>
  );
}
