// Video generation feature. Importing this module registers it with the core through extension points;
// the core never imports anything from here. It stores videos with the images and borrows the images feature's
// viewer and thumbnails (through its index), and adds "make a video" to images.
import { registerAssistantExtra, registerComposerAddon, registerConnectionFeature, registerModelSlot, registerUserMessageExtra } from '../../components/extensions';
import { videoProviderList } from './providers/types';
import { registerMessageTransform } from '../../lib/chat/request';
import type { MessageRecord } from '../../lib/db/schema';
import type { Part } from '../../lib/providers/types';
import { registerImageAction } from '../images';
import { UserVideoRequest, VideoAnswer, VideoBarAbove, VideoModeButton, VideoModelButton } from './components/Hooks';
import { currentVideoModel, makeVideoFrom, sendVideoPrompt, videoReady } from './state';
import { t } from './messages';

registerComposerAddon({
  id: 'video',
  alwaysShown: true,
  Button: VideoModeButton,
  Above: VideoBarAbove,
  mode: (conv) =>
    conv.videoMode
      ? { id: 'video', placeholder: t('mode.placeholder'), touchPlaceholder: t('mode.touchPlaceholder'), ready: videoReady.value && !!currentVideoModel.value, send: (text) => sendVideoPrompt(text) }
      : null
});
registerModelSlot({ id: 'video', when: (conv) => !!conv.videoMode, Component: VideoModelButton });
registerConnectionFeature({ id: 'video', label: () => t('mode.button'), icon: 'video', offeredBy: (id) => videoProviderList().some((p) => p.account === id) });
registerAssistantExtra({ id: 'video', Component: VideoAnswer, owns: (m) => !!m.video });
registerUserMessageExtra(UserVideoRequest);
registerImageAction({
  id: 'make-video',
  label: () => t('action.makeVideo'),
  title: () => t('action.makeVideoTitle'),
  icon: 'video',
  shown: () => videoReady.value,
  run: (blobId, name) => makeVideoFrom(blobId, name)
});

// What chat models see for a video answer: a short note instead of the video
registerMessageTransform((m: MessageRecord, parts: Part[]): Part[] => {
  if (m.role !== 'assistant' || !m.video) return parts;
  if (m.status !== 'done') return [];
  const prompt = m.video.params.prompt.slice(0, 200);
  return [{ type: 'text', text: t(m.parts.some((p) => p.type === 'file') ? 'note.made' : 'note.deleted', { prompt }) }];
});
