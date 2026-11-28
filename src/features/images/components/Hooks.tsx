// The image feature's pieces for the core screens: input-box mode, image model button, user-message label,
// tool card for generate_image, and the settings tab
import type { Conversation, MessageRecord } from '../../../lib/db/schema';
import { Chip, Disclosure, Icon, SearchChoice, Select, cx } from '../../../components/ui';
import { Group, PermissionRow, Row, ToggleRow } from '../../../components/settings-ui';
import type { ToolPart } from '../../../components/extensions';
import { useEffect } from 'preact/hooks';
import { conversations, currentConv } from '../../../state/conversations';
import {
  currentImageModel,
  currentPrivacyLabel,
  defaultImageModel,
  estimateCost,
  imageModelFor,
  generationModels,
  imageReady,
  imageSettings,
  loadImageModels,
  modelRef,
  privacyLabelOf,
  setDefaultImageModel,
  setImageMode,
  toolParams
} from '../state';
import { imageProviderList, imageProviderOf } from '../providers/types';
import { formatList, formatUsd } from '../../../lib/i18n';
import { ImageBar } from './ImageBar';
import { t } from '../messages';
import { ToolImages } from './ImageView';

/** Toggle in the input box's toolbar; shown only when a provider that makes images has a key (and while on, to turn it off) */
export function ImageModeButton({ conv }: { conv: Conversation }) {
  const on = !!conv.imageMode;
  if (!imageReady.value && !on) return null;
  return (
    <Chip aria-pressed={on} on={on} aria-label={t('mode.button')} title={on ? t('mode.titleOn') : t('mode.titleOff')} onClick={() => void setImageMode(!on)}>
      <Icon name="image" class="size-3.5" />
      <span class="@max-[22rem]:hidden">{on ? t('mode.buttonOn') : t('mode.button')}</span>
    </Chip>
  );
}

/** The option bar above the text area, only in image mode */
export function ImageBarAbove({ conv }: { conv: Conversation }) {
  return conv.imageMode ? <ImageBar /> : null;
}

/** In image mode the input box shows where prompts go: the image model, not the chat model */
export function ImageModelButton() {
  const m = currentImageModel.value;
  const badge = currentPrivacyLabel();
  const inner = (
    <>
      <Icon name="image" class="size-3.5 shrink-0" />
      <span class="max-w-[11rem] truncate">{m?.name ?? t('imageModel')}</span>
    </>
  );
  const title = badge.title ? `${t('header.title')}\n${badge.title}` : t('header.title');
  // It moves to the bar's model menu, so it is a button only while the bar shows one
  if (!imageReady.value || !generationModels.value.length) return <span class="flex min-w-0 items-center gap-1 px-2.5 py-1.5 text-xs text-muted" data-tip={title}>{inner}</span>;
  return (
    <button
      type="button"
      class="flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs text-muted transition hover:bg-glass-strong hover:text-ink"
      onClick={() => document.querySelector<HTMLElement>('select[data-image-model]')?.focus()}
      data-tip={title}
    >
      {inner}
    </button>
  );
}

/** Label above a user message that asked for an image */
export function UserImageRequest({ m }: { m: MessageRecord }) {
  const r = m.imageRequest;
  if (!r) return null;
  return (
    <div class="mb-1 flex items-center gap-1 text-xs text-accent-text" data-tip={t('request.title')}>
      <Icon name="image" class="size-3.5" />
      {r.op === 'generate'
        ? r.variants > 1
          ? t('request.generateMany', { size: r.aspectRatio ?? r.size ?? '', n: r.variants })
          : t('request.generate', { size: r.aspectRatio ?? r.size ?? '' })
        : r.op === 'upscale'
          ? t('request.upscale')
          : r.op === 'edit'
            ? t('request.edit')
            : t('request.removeBg')}
    </div>
  );
}

/** Approval card note for generate_image: model, who sees the prompt, and the estimated price */
export function imageToolNote(): string {
  const m = currentImageModel.value;
  if (!m) return t('tool.noteNoModel');
  const cost = estimateCost(toolParams(currentConv.value, {}));
  const params = { model: m.name, privacy: currentPrivacyLabel().label || (imageProviderOf(m.providerId)?.label ?? '') };
  return cost !== undefined ? t('tool.noteCost', { ...params, cost: formatUsd(cost) }) : t('tool.noteCostUnknown', params);
}

interface ToolRequest {
  provider: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  /** The size id, shown for sizes without an aspect ratio */
  size?: string;
  costUsd?: number;
  costEstimated?: boolean;
}


/** The full request of a generate_image call: before it runs (what it will send) and after (what was sent and its cost) */
function ToolRequestDetails({ p, ran }: { p: ToolPart; ran?: ToolRequest & { model: string } }) {
  const conv = conversations.value.find((c) => c.id === currentConv.value.id) ?? currentConv.value;
  const input = (p.input ?? {}) as { prompt?: string; negative_prompt?: string; aspect_ratio?: string };
  let req: ToolRequest & { model: string };
  if (ran) req = ran;
  else {
    const params = toolParams(conv, input);
    const m = imageModelFor(conv);
    req = {
      model: m?.name ?? params.model,
      provider: imageProviderOf(params.providerId)?.label ?? params.providerId,
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      size: params.size,
      costUsd: estimateCost(params),
      costEstimated: true
    };
  }
  const cost = req.costUsd === undefined ? t('detail.costUnknown') : req.costEstimated ? t('detail.costEstimated', { cost: formatUsd(req.costUsd) }) : t('detail.costReported', { cost: formatUsd(req.costUsd) });
  const row = (label: string, value: string | undefined, pre = false) =>
    value ? (
      <div class="grid gap-0.5 sm:grid-cols-[8rem_1fr] sm:gap-2">
        <dt class="text-muted">{label}</dt>
        <dd class={cx('min-w-0 text-ink', pre && 'whitespace-pre-wrap break-words')}>{value}</dd>
      </div>
    ) : null;
  return (
    <Disclosure class="border-t border-line px-3 py-2" defaultOpen={!ran && p.state === 'approval-requested'} summary={`${t('detail.title')} · ${req.model} · ${cost}`}>
      <dl class="mt-2 space-y-1.5">
        {row(t('detail.model'), `${req.model}（${req.provider}）`)}
        {row(t('detail.prompt'), req.prompt, true)}
        {row(t('detail.negative'), req.negativePrompt, true)}
        {row(t('detail.size'), [req.aspectRatio, req.resolution].filter(Boolean).join(' / ') || req.size)}
        {row(t('detail.cost'), cost)}
      </dl>
      {!ran && <p class="mt-2 text-faint">{t('detail.planned')}</p>}
    </Disclosure>
  );
}

/** Under a generate_image tool card: the full request (prompt, model, cost), then the images (or the "deleted" note) */
export function ImageToolDetail({ p, owner }: { p: ToolPart; owner?: { conversationId: string; messageId: string } }) {
  const d = (p.uiDetails ?? {}) as { blobIds?: string[]; deleted?: boolean; model?: string; request?: ToolRequest };
  const ran = d.request && d.model ? { ...d.request, model: d.model } : undefined;
  return (
    <>
      {(ran || (p.input != null && !p.state.startsWith('output-'))) && <ToolRequestDetails p={p} ran={ran} />}
      {p.state === 'output-available' && d.deleted && !d.blobIds?.length && <p class="border-t border-line px-3 py-2 text-muted">{t('deleted')}</p>}
      {p.state === 'output-available' && !!d.blobIds?.length && owner && (
        <div class="border-t border-line px-3 py-2">
          <ToolImages blobIds={d.blobIds} conversationId={owner.conversationId} messageId={owner.messageId} />
        </div>
      )}
    </>
  );
}

/** Every image provider, A to Z (for texts that name them) */
const imageProviderNames = () => formatList(imageProviderList().map((p) => p.label).sort((a, b) => a.localeCompare(b)));

/** The default image model (tool and image mode) */
function DefaultModelRow() {
  useEffect(() => {
    void loadImageModels();
  }, [imageReady.value]);
  const list = generationModels.value;
  const m = defaultImageModel.value;
  if (!list.length) return <Row label={t('settings.model')} below={<p class="text-xs leading-5 text-muted">{t('settings.noModels', { providers: imageProviderNames() })}</p>} />;
  const cost = m ? estimateCost({ ...toolParams(undefined, {}), providerId: m.providerId, model: m.id }) : undefined;
  return (
    <Row
      label={t('settings.model')}
      hint={t('settings.modelDesc')}
      below={
        <>
          <SearchChoice
            label={t('settings.model')}
            value={m ? modelRef(m) : ''}
            choices={list.map((x) => ({
              value: modelRef(x),
              label: x.privacy === 'anonymized' ? t('bar.relayed', { name: x.name }) : x.name,
              sub: imageProviderOf(x.providerId)?.label ?? x.providerId
            }))}
            onChange={(v) => {
              const x = list.find((y) => modelRef(y) === v);
              if (x) void setDefaultImageModel(x);
            }}
          />
          {m && (
            <p class="mt-1.5 text-xs leading-5 text-muted">
              {[privacyLabelOf(m).title, cost !== undefined ? t('tool.costEach', { cost: formatUsd(cost) }) : t('settings.priceUnknown')].filter(Boolean).join(' ')}
            </p>
          )}
        </>
      }
    />
  );
}

/** Settings → 画像 */
export function ImageSettings() {
  const s = imageSettings.value.value;
  const saveImage = imageSettings.save;
  return (
    <div class="space-y-8">
      <Group note={t('settings.desc')}>
        <DefaultModelRow />
        <Row
          label={t('settings.format')}
          control={
            <Select aria-label={t('settings.format')} value={s.imageFormat} onChange={(e) => void saveImage({ imageFormat: (e.target as HTMLSelectElement).value as 'webp' | 'png' | 'jpeg' })}>
              <option value="webp">{t('settings.webp')}</option>
              <option value="png">{t('settings.png')}</option>
              <option value="jpeg">JPEG</option>
            </Select>
          }
        />
      </Group>
      <Group>
        <ToggleRow checked={s.imageTool} onChange={(v) => void saveImage({ imageTool: v })} label={t('settings.tool')} hint={t('settings.toolDesc')}>
          <PermissionRow label={t('settings.permission')} tools={['generate_image']} />
        </ToggleRow>
      </Group>
    </div>
  );
}
