// Image generation feature. Importing this module registers it with the core through extension points;
// the core never imports anything from here. Other features use only what is exported below.
import {
  registerAssistantExtra,
  registerComposerAddon,
  registerModelSlot,
  registerOverlay,
  registerSettingsSection,
  registerToolView,
  registerUserMessageExtra
} from '../../components/extensions';
import { registerMessageTransform } from '../../lib/chat/request';
import { ImageModelButton, ImageBarAbove, ImageModeButton, ImageSettings, ImageToolDetail, UserImageRequest, imageToolNote } from './components/Hooks';
import { ImageAnswer, Lightbox } from './components/ImageView';
import { imageNote } from './transform';
import { sendImagePrompt } from './state';
import { GENERATE_IMAGE } from './tool';
import { imageCount, t } from './messages';

export { ImageThumb, confirmAndDelete } from './components/ImageView';
export { deleteImages, imagesVersion, lightbox, type LightboxItem } from './state';

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
          send: (text) => sendImagePrompt(text)
        }
      : null
});
registerModelSlot({ id: 'images', when: (conv) => !!conv.imageMode, Component: ImageModelButton });
registerAssistantExtra({ id: 'images', Component: ImageAnswer, owns: (m) => !!m.image });
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
registerSettingsSection({ id: 'images', tab: 'features', Component: ImageSettings });
registerOverlay(Lightbox);
registerMessageTransform(imageNote);
