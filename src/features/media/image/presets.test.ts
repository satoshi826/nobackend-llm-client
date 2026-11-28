import { describe, expect, it } from 'vitest';
import { TAG_PRESETS, isPresetNegative, qualityTagsAdded, sentPrompt, tagModelLabel, withQualityTags } from './presets';
import { makeImageTool } from './tool';

describe('quality tag presets', () => {
  it('add the quality tags where the family puts them, joined by one comma', () => {
    const at = (family: keyof typeof TAG_PRESETS) => ({ text: TAG_PRESETS[family].quality, at: TAG_PRESETS[family].at });
    expect(sentPrompt({ prompt: '1girl, solo', qualityTags: at('illustrious') })).toBe('masterpiece, best quality, amazing quality, 1girl, solo');
    expect(sentPrompt({ prompt: '1girl, solo, ', qualityTags: at('animagine') })).toBe('1girl, solo, masterpiece, high score, great score, absurdres');
    expect(sentPrompt({ prompt: '1girl' })).toBe('1girl');
  });
  it("add the user's own quality tags of a family in place of the recommended ones", () => {
    const own = withQualityTags({}, 'pony', 'score_9, score_8_up, ');
    expect(qualityTagsAdded('pony', own)).toEqual({ text: 'score_9, score_8_up', at: 'start' });
    expect(qualityTagsAdded('noobai', own)).toEqual({ text: TAG_PRESETS.noobai.quality, at: 'start' });
    // Cleared: nothing is added
    expect(qualityTagsAdded('pony', withQualityTags(own, 'pony', ' '))).toBeUndefined();
  });
  it('keep no change once the tags are the recommended ones again', () => {
    const own = withQualityTags({}, 'animagine', 'masterpiece');
    expect(withQualityTags(own, 'animagine', TAG_PRESETS.animagine.quality)).toEqual({});
    expect(withQualityTags(own, 'animagine', undefined)).toEqual({});
  });
  it('name a tag model by its family, else as a Danbooru model', () => {
    expect(tagModelLabel({ promptStyle: 'tags', family: 'noobai' })).toBe('NoobAI');
    expect(tagModelLabel({ promptStyle: 'tags' })).toBe('Danbooru');
    expect(tagModelLabel({ promptStyle: 'natural' })).toBeUndefined();
  });
  it('tell presets from negative prompts the user wrote', () => {
    expect(isPresetNegative(TAG_PRESETS.noobai.negative)).toBe(true);
    expect(isPresetNegative('blurry')).toBe(false);
  });
  it('tell the chat model which quality tags the app adds', () => {
    const tool = makeImageTool(async () => ({ blobIds: [], paths: [], inWorkDir: false, model: '', blurred: false }), { promptStyle: 'tags', qualityTags: 'masterpiece, best quality' });
    expect(tool.description).toContain('"masterpiece, best quality" itself');
  });
});
