// Image and video mode in the input box, one pattern for both: a chip per mode below the box (one mode at a time:
// while one is on only its chip shows, and pressing it goes back to chat), the active mode's options and model at the
// right below the box, and what it needs inside the box (the first frame of a video, the tag help of a tag model)
import type { ComposerApi, ComposerMode } from '../../../components/extensions';
import type { Conversation } from '../../../lib/db/schema';
import { composerText } from '../../../state/ui';
import { currentImageModel, imageReady, modeParams as imageParams, promptUse, sendImagePrompt, setImageMode } from '../image/state';
import { t as ti } from '../image/messages';
import { currentVideoModel, sendVideoPrompt, setVideoMode, videoReady } from '../video/state';
import { t as tv } from '../video/messages';
import { ImageBelow, ImageEnd, ImageModel, ImageNotice, ImageOptions } from './ImageMode';
import { VideoModel, VideoNotice, VideoOptions, VideoStart } from './VideoMode';
import { TagSuggestions } from './TagSuggestions';
import { ModeChip } from './Mode';
import { t } from '../messages';

/** The mode chips: shown while a provider can make it; while one mode is on, only its chip, to turn it off */
export function MediaChips({ conv }: { conv: Conversation }) {
  const image = !!conv.imageMode;
  const video = !!conv.videoMode;
  return (
    <>
      {(image || (imageReady.value && !video)) && <ModeChip mode="image" icon="image" label={ti('mode.button')} on={image} title={image ? ti('mode.titleOn') : ti('mode.titleOff')} onClick={() => void setImageMode(!image)} />}
      {(video || (videoReady.value && !image)) && <ModeChip mode="video" icon="video" label={tv('mode.button')} on={video} title={video ? tv('mode.titleOn') : tv('mode.titleOff')} onClick={() => void setVideoMode(!video)} />}
    </>
  );
}

/** Above the text: why the mode cannot send (no key, no model list), and tag suggestions */
export function MediaAbove({ conv, api }: { conv: Conversation; api: ComposerApi }) {
  if (conv.imageMode)
    return (
      <>
        <ImageNotice />
        <TagSuggestions api={api} />
      </>
    );
  return conv.videoMode ? <VideoNotice /> : null;
}

/** A prompt over its model's limit is not sent (the count beside the text says why) */
function promptTooLong(text: string) {
  const use = promptUse(imageParams(text.trim()));
  return !!use && use.n > use.limit;
}

export function mediaMode(conv: Conversation): ComposerMode | null {
  if (conv.imageMode)
    return {
      id: 'image',
      sendLabel: t('mode.generate'),
      sendIcon: 'sparkle',
      placeholder: ti('mode.placeholder'),
      touchPlaceholder: ti('mode.touchPlaceholder'),
      ready: imageReady.value && !!currentImageModel.value && !promptTooLong(composerText.value),
      send: (text) => sendImagePrompt(text),
      End: ImageEnd,
      Below: ImageBelow,
      Options: ImageOptions,
      Model: ImageModel
    };
  if (conv.videoMode)
    return {
      id: 'video',
      sendLabel: t('mode.generate'),
      sendIcon: 'sparkle',
      placeholder: tv('mode.placeholder'),
      touchPlaceholder: tv('mode.touchPlaceholder'),
      ready: videoReady.value && !!currentVideoModel.value,
      send: (text) => sendVideoPrompt(text),
      Start: VideoStart,
      Options: VideoOptions,
      Model: VideoModel
    };
  return null;
}
