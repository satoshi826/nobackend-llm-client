// Image and video mode in the input box, one pattern for both: a chip per mode below the box (one mode at a time;
// pressing the active one goes back to chat), the active mode's options chip beside them, its model bottom right,
// and what it needs inside the box (the first frame of a video, the tag help of a tag model)
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

/** The mode chips (shown while a provider can make it, and while on, to turn it off) and the active mode's options */
export function MediaChips({ conv }: { conv: Conversation }) {
  const image = !!conv.imageMode;
  const video = !!conv.videoMode;
  return (
    <>
      {(imageReady.value || image) && <ModeChip icon="image" label={ti('mode.button')} on={image} title={image ? ti('mode.titleOn') : ti('mode.titleOff')} onClick={() => void setImageMode(!image)} />}
      {(videoReady.value || video) && <ModeChip icon="video" label={tv('mode.button')} on={video} title={video ? tv('mode.titleOn') : tv('mode.titleOff')} onClick={() => void setVideoMode(!video)} />}
      {image && <ImageOptions />}
      {video && <VideoOptions />}
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
      placeholder: ti('mode.placeholder'),
      touchPlaceholder: ti('mode.touchPlaceholder'),
      ready: imageReady.value && !!currentImageModel.value && !promptTooLong(composerText.value),
      send: (text) => sendImagePrompt(text),
      End: ImageEnd,
      Below: ImageBelow,
      Model: ImageModel
    };
  if (conv.videoMode)
    return {
      id: 'video',
      placeholder: tv('mode.placeholder'),
      touchPlaceholder: tv('mode.touchPlaceholder'),
      ready: videoReady.value && !!currentVideoModel.value,
      send: (text) => sendVideoPrompt(text),
      Start: VideoStart,
      Model: VideoModel
    };
  return null;
}
