// Making images and videos: image mode and video mode in the input box (one pattern for both), their answers, the
// generate_image tool, Settings → 画像, and what the viewer makes from an image. Importing this module registers it with
// the core through extension points; showing and deleting stored images and videos is the core's (components/media).
import {
  registerAssistantExtra,
  registerComposerAddon,
  registerConnectionFeature,
  registerSettingsTab,
  registerToolView,
  registerUserMessageExtra
} from '../../components/extensions';
import { lazyComponent } from '../../components/lazy';
import { registerMessageTransform } from '../../lib/chat/request';
import type { MessageRecord } from '../../lib/db/schema';
import type { Part } from '../../lib/providers/types';
import { MediaAbove, MediaChips, mediaMode } from './components/Composer';
import { ImageAnswer, ImageFooter, ReplyImages, UserMediaRequest, VideoAnswer, VideoFooter } from './components/Answer';
import { ImageToolDetail, imageToolNote } from './components/ToolDetail';
import { tagKeys } from './components/TagSuggestions';
import { registerMediaActions } from './actions';
import { imageNote } from './image/transform';
import { imageProviderList } from './image/providers/types';
import { GENERATE_IMAGE } from './image/tool';
import { imageCount, t as ti } from './image/messages';
import { videoProviderList } from './video/providers/types';
import { t as tv } from './video/messages';

registerComposerAddon({
  id: 'media',
  alwaysShown: true,
  Button: MediaChips,
  Above: MediaAbove,
  onKeyDown: tagKeys,
  mode: mediaMode
});
registerAssistantExtra({ id: 'images', Component: ImageAnswer, owns: (m) => !!m.image, Footer: ImageFooter });
registerAssistantExtra({ id: 'video', Component: VideoAnswer, owns: (m) => !!m.video, Footer: VideoFooter });
// Images a chat model put in its reply (native image output; stored by state/media.ts)
registerAssistantExtra({ id: 'reply-images', Component: ReplyImages });
registerUserMessageExtra(UserMediaRequest);
registerToolView({
  names: [GENERATE_IMAGE],
  label: () => ti('tool.label'),
  icon: 'image',
  editableField: { key: 'prompt', label: () => ti('tool.promptField') },
  approvalNote: () => imageToolNote(),
  doneStatus: (p) => imageCount((p.uiDetails as { fileIds?: string[] } | undefined)?.fileIds?.length ?? 0),
  Detail: ImageToolDetail
});
registerSettingsTab({ id: 'images', label: () => ti('settings.title'), icon: 'image', Component: lazyComponent(() => import('./components/Settings').then((m) => m.ImageSettings)) });
registerConnectionFeature({ id: 'images', label: () => ti('settings.title'), icon: 'image', offeredBy: (id) => imageProviderList().some((p) => p.account === id) });
registerConnectionFeature({ id: 'video', label: () => tv('mode.button'), icon: 'video', offeredBy: (id) => videoProviderList().some((p) => p.account === id) });
registerMediaActions();
registerMessageTransform(imageNote);
// What chat models see for a video answer: a short note instead of the video (for the model only: English, like the
// tool descriptions)
registerMessageTransform((m: MessageRecord, parts: Part[]): Part[] => {
  if (m.role !== 'assistant' || !m.video) return parts;
  if (m.status !== 'done') return [];
  const prompt = m.video.params.prompt.slice(0, 200);
  return [{ type: 'text', text: m.parts.some((p) => p.type === 'file') ? `[Made a video: ${prompt}]` : `[The video made here was deleted: ${prompt}]` }];
});
