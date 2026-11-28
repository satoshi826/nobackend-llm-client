// Image generation feature. Importing this module registers it with the core through extension points;
// the core never imports anything from here. Other features use only what is exported below.
import {
  registerAssistantExtra,
  registerComposerAddon,
  registerConnectionFeature,
  registerModelSlot,
  registerOverlay,
  registerSettingsTab,
  registerToolView,
  registerUserMessageExtra
} from '../../components/extensions';
import { registerMessageTransform } from '../../lib/chat/request';
import { ImageModelButton, ImageBarAbove, ImageModeButton, ImageSettings, ImageToolDetail, UserImageRequest, imageToolNote } from './components/Hooks';
import { ImageAnswer, Lightbox, ReplyImages } from './components/ImageView';
import { tagKeys } from './components/TagSuggestions';
import { imageNote } from './transform';
import { composerText } from '../../state/ui';
import { currentImageModel, imageReady, paramsFromBar, promptUse, sendImagePrompt } from './state';
import { imageProviderList } from './providers/types';
import { GENERATE_IMAGE } from './tool';
import { imageCount, t } from './messages';

export { ImageThumb, ViewerStage, confirmAndDelete, useBlobUrl, useImageViewer, type Viewer, type ViewerTool } from './components/ImageView';
export { deleteImages, lightbox, registerImageAction, type ImageAction, type LightboxItem } from './state';

registerComposerAddon({
  id: 'images',
  alwaysShown: true,
  Button: ImageModeButton,
  Above: ImageBarAbove,
  onKeyDown: tagKeys,
  mode: (conv) =>
    conv.imageMode
      ? {
          id: 'images',
          placeholder: t('mode.placeholder'),
          touchPlaceholder: t('mode.touchPlaceholder'),
          // A prompt over the model's limit is not sent (the bar says why)
          ready: imageReady.value && !!currentImageModel.value && !promptTooLong(composerText.value),
          send: (text) => sendImagePrompt(text)
        }
      : null
});
function promptTooLong(text: string) {
  const use = promptUse(paramsFromBar(text.trim()));
  return !!use && use.n > use.limit;
}

registerModelSlot({ id: 'images', when: (conv) => !!conv.imageMode, Component: ImageModelButton });
registerAssistantExtra({ id: 'images', Component: ImageAnswer, owns: (m) => !!m.image });
// Images a chat model put in its reply (native image output; stored by state/media.ts)
registerAssistantExtra({ id: 'reply-images', Component: ReplyImages });
registerUserMessageExtra(UserImageRequest);
registerToolView({
  names: [GENERATE_IMAGE],
  label: () => t('tool.label'),
  icon: 'image',
  editableField: {
    key: 'prompt',
    label: () => t('tool.promptField')
  },
  approvalNote: () => imageToolNote(),
  doneStatus: (p) => imageCount((p.uiDetails as { blobIds?: string[] } | undefined)?.blobIds?.length ?? 0),
  Detail: ImageToolDetail
});
registerSettingsTab({ id: 'images', label: () => t('settings.title'), icon: 'image', Component: ImageSettings });
registerConnectionFeature({ id: 'images', label: () => t('settings.title'), icon: 'image', offeredBy: (id) => imageProviderList().some((p) => p.account === id) });
registerOverlay(Lightbox);
registerMessageTransform(imageNote);
