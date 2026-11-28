// The generate_image tool's card: its approval note, the full request (before it runs and after), and the images
import type { ToolPart } from '../../../components/extensions';
import { Disclosure, cx } from '../../../components/ui';
import { MediaGrid } from '../../../components/media/Thumb';
import { conversations, currentConv } from '../../../state/conversations';
import { formatUsd } from '../../../lib/i18n';
import { currentImageModel, estimateCost, imageModelFor, privacyLabelOf, toolParams } from '../image/state';
import { imageProviderOf } from '../image/providers/types';
import { sentPrompt } from '../image/presets';
import { t } from '../image/messages';

/** Approval card note for generate_image: model, who sees the prompt, and the estimated price */
export function imageToolNote(): string {
  const m = currentImageModel.value;
  if (!m) return t('tool.noteNoModel');
  const cost = estimateCost(toolParams(currentConv.value, {}));
  const params = { model: m.name, privacy: privacyLabelOf(m).label || (imageProviderOf(m.providerId)?.label ?? '') };
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
      prompt: sentPrompt(params),
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
  const d = (p.uiDetails ?? {}) as { fileIds?: string[]; deleted?: boolean; model?: string; request?: ToolRequest };
  const ran = d.request && d.model ? { ...d.request, model: d.model } : undefined;
  return (
    <>
      {(ran || (p.input != null && !p.state.startsWith('output-'))) && <ToolRequestDetails p={p} ran={ran} />}
      {p.state === 'output-available' && d.deleted && !d.fileIds?.length && <p class="border-t border-line px-3 py-2 text-muted">{t('deleted')}</p>}
      {p.state === 'output-available' && !!d.fileIds?.length && owner && (
        <div class="border-t border-line px-3 py-2">
          <MediaGrid files={d.fileIds.map((fileId) => ({ fileId }))} owner={owner} />
        </div>
      )}
    </>
  );
}
