// The image feature's pieces for the core screens: input-box mode, image model button, user-message label,
// tool card for generate_image, and the settings section
import type { Conversation, MessageRecord } from '../../../lib/db/schema';
import type { Permission } from '../../../lib/tools/types';
import { saveSettings, settings } from '../../../state/settings';
import { Chip, Icon } from '../../../components/ui';
import { PermissionSelect, Section, Toggle, selectCls } from '../../../components/settings-ui';
import type { ToolPart } from '../../../components/extensions';
import { currentImageModel, currentPrivacyLabel, estimateCost, imageSettings, paramsFromBar, setImageMode } from '../state';
import { ImageBar } from './ImageBar';
import { t, usd } from '../messages';
import { ToolImages } from './ImageView';

/** Toggle in the input box's toolbar */
export function ImageModeButton({ conv }: { conv: Conversation }) {
  const on = !!conv.imageMode;
  return (
    <Chip aria-pressed={on} on={on} title={on ? t('mode.titleOn') : t('mode.titleOff')} onClick={() => void setImageMode(!on)}>
      <Icon name="image" class="size-3.5" />
      {on ? t('mode.buttonOn') : t('mode.button')}
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
  return (
    <button
      type="button"
      class="flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs text-muted transition hover:bg-glass-strong hover:text-ink"
      onClick={() => document.querySelector<HTMLElement>('select[data-image-model]')?.focus()}
      title={badge.title ? `${t('header.title')}\n${badge.title}` : t('header.title')}
    >
      <Icon name="image" class="size-3.5 shrink-0" />
      <span class="max-w-[11rem] truncate">{m?.name ?? t('imageModel')}</span>
      {m && badge.tone === 'green' && <Icon name="lock" class="size-3 shrink-0 text-ok" />}
    </button>
  );
}

/** Label above a user message that asked for an image */
export function UserImageRequest({ m }: { m: MessageRecord }) {
  const r = m.imageRequest;
  if (!r) return null;
  return (
    <div class="mb-1 flex items-center gap-1 text-xs text-accent-text" title={t('request.title')}>
      <Icon name="image" class="size-3.5" />
      {r.op === 'generate'
        ? r.variants > 1
          ? t('request.generateMany', { aspect: r.aspectRatio ?? '', n: r.variants })
          : t('request.generate', { aspect: r.aspectRatio ?? '' })
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
  const cost = estimateCost({ ...paramsFromBar(''), variants: 1, enhancePrompt: false });
  const params = { model: m.name, privacy: currentPrivacyLabel().label };
  return cost !== undefined ? t('tool.noteCost', { ...params, cost: usd(cost, 3) }) : t('tool.noteCostUnknown', params);
}

/** Images (or the "deleted" note) under a generate_image tool card */
export function ImageToolDetail({ p, owner }: { p: ToolPart; owner?: { conversationId: string; messageId: string } }) {
  const d = (p.uiDetails ?? {}) as { blobIds?: string[]; deleted?: boolean };
  if (p.state !== 'output-available') return null;
  if (d.deleted && !d.blobIds?.length) return <p class="border-t border-line px-3 py-2 text-muted">{t('deleted')}</p>;
  if (!d.blobIds?.length || !owner) return null;
  return (
    <div class="border-t border-line px-3 py-2">
      <ToolImages blobIds={d.blobIds} conversationId={owner.conversationId} messageId={owner.messageId} />
    </div>
  );
}

/** Settings → チャット → 画像 */
export function ImageSettings() {
  const s = { ...settings.value, ...imageSettings.value.value };
  const saveImage = imageSettings.save;
  return (
    <Section title={t('settings.title')}>
      <p class="text-xs text-muted">{t('settings.desc')}</p>
      <label class="flex items-center justify-between gap-3 text-sm">
        {t('settings.format')}
        <select class={selectCls} value={s.imageFormat} onChange={(e) => void saveImage({ imageFormat: (e.target as HTMLSelectElement).value as 'webp' | 'png' | 'jpeg' })}>
          <option value="webp">{t('settings.webp')}</option>
          <option value="png">{t('settings.png')}</option>
          <option value="jpeg">JPEG</option>
        </select>
      </label>
      <Toggle
        checked={s.imageTool}
        onChange={(v) => void saveImage({ imageTool: v })}
        title={t('settings.tool')}
        desc={t('settings.toolDesc')}
      />
      {s.imageTool && (
        <PermissionSelect
          label={t('settings.permission')}
          value={(s.toolPermissions.generate_image ?? 'ask') as Permission}
          onChange={(v) => saveSettings({ toolPermissions: { ...s.toolPermissions, generate_image: v } })}
        />
      )}
    </Section>
  );
}
