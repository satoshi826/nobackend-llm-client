// What the viewer offers to make from an image: an edit by instructions, an upscale, the background removed, a video.
// Edits run where the image was made when that provider offers them (editTargetFor)
import { registerMediaAction } from '../../components/extensions';
import type { ImageParams } from '../../lib/db/schema';
import { formatUsd } from '../../lib/i18n';
import { messages } from '../../state/conversations';
import type { MediaItem } from '../../state/media';
import { editTargetFor, estimateCost, imageAction, imageModelOf, type EditOp } from './image/state';
import { t as ti } from './image/messages';
import { makeVideoFrom, videoReady } from './video/state';
import { t as tv } from './video/messages';

/** The provider and model that made an image (from its answer) */
function madeBy(item: MediaItem) {
  const meta = messages.value.find((m) => m.id === item.messageId)?.meta;
  return { providerId: meta?.providerId, model: meta?.model };
}

/** The estimated cost of an edit */
function costText(p: Pick<ImageParams, 'op' | 'providerId' | 'scale'> & { model?: string }): string {
  const cost = estimateCost({ model: '', prompt: '', variants: 1, safeMode: false, format: 'png', ...p });
  return cost === undefined ? ti('lb.costUnknown') : ti('lb.cost', { cost: formatUsd(cost) });
}

const target = (op: EditOp, item: MediaItem) => editTargetFor(op, madeBy(item));

export function registerMediaActions() {
  registerMediaAction({
    id: 'edit',
    icon: 'wand',
    label: () => ti('lb.edit'),
    instruction: () => ti('lb.editPlaceholder'),
    offer: (item) => {
      const e = target('edit', item);
      if (!e) return undefined;
      const name = e.model ? (imageModelOf(e.provider.id, e.model)?.name ?? e.model) : e.provider.label;
      return { title: ti('lb.editTitle', { model: name, cost: costText({ op: 'edit', providerId: e.provider.id, model: e.model }) }) };
    },
    run: (item, text) => imageAction('edit', item.fileId, { prompt: text, from: madeBy(item) })
  });
  for (const scale of [2, 4] as const)
    registerMediaAction({
      id: `upscale-${scale}`,
      icon: 'expand',
      label: () => ti('lb.upscale', { scale }),
      offer: (item) => {
        const e = target('upscale', item);
        return e && { title: ti('lb.upscaleTitle', { scale, cost: costText({ op: 'upscale', providerId: e.provider.id, scale }) }) };
      },
      run: (item) => imageAction('upscale', item.fileId, { scale, from: madeBy(item) })
    });
  registerMediaAction({
    id: 'remove-bg',
    icon: 'scissors',
    label: () => ti('lb.removeBg'),
    offer: (item) => {
      const e = target('remove-bg', item);
      return e && { title: ti('lb.removeBgTitle', { cost: costText({ op: 'remove-bg', providerId: e.provider.id }) }) };
    },
    run: (item) => imageAction('remove-bg', item.fileId, { from: madeBy(item) })
  });
  registerMediaAction({
    id: 'make-video',
    icon: 'video',
    label: () => tv('action.makeVideo'),
    offer: () => (videoReady.value ? { title: tv('action.makeVideoTitle') } : undefined),
    run: (item) => makeVideoFrom(item.fileId, item.name)
  });
}
