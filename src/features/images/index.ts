// Image generation feature. Importing this module registers it with the core through extension points;
// the core never imports anything from here. Other features use only what is exported below.
import {
  registerAssistantExtra,
  registerComposerAddon,
  registerModelSlot,
  registerOverlay,
  registerSettingsTab,
  registerToolView,
  registerUserMessageExtra
} from '../../components/extensions';
import { registerMessageTransform } from '../../lib/chat/request';
import { ImageModelButton, ImageBarAbove, ImageModeButton, ImageSettings, ImageToolDetail, UserImageRequest, imageToolNote } from './components/Hooks';
import { ImageAnswer, Lightbox, ReplyImages } from './components/ImageView';
import { imageNote } from './transform';
import { currentImageModel, imageReady, sendImagePrompt } from './state';
import { GENERATE_IMAGE } from './tool';
import { imageCount, t } from './messages';

export { ImageThumb, confirmAndDelete, useBlobUrl } from './components/ImageView';
export { deleteImages, imagesVersion, lightbox, registerImageAction, type ImageAction, type LightboxItem } from './state';

registerComposerAddon({
  id: 'images',
  alwaysShown: true,
  Button: ImageModeButton,
  Above: ImageBarAbove,
  mode: (conv) =>
    conv.imageMode
      ? {
          id: 'images',
          placeholder: t('mode.placeholder'),
          touchPlaceholder: t('mode.touchPlaceholder'),
          ready: imageReady.value && !!currentImageModel.value,
          send: (text) => sendImagePrompt(text)
        }
      : null
});
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
registerOverlay(Lightbox);
registerMessageTransform(imageNote);
