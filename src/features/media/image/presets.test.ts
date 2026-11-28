import { describe, expect, it } from 'vitest';
import { TAG_PRESETS, isPresetNegative, sentPrompt } from './presets';
import { makeImageTool } from './tool';

describe('quality tag presets', () => {
  it('add the quality tags where the family puts them, joined by one comma', () => {
    const at = (family: keyof typeof TAG_PRESETS) => ({ text: TAG_PRESETS[family].quality, at: TAG_PRESETS[family].at });
    expect(sentPrompt({ prompt: '1girl, solo', qualityTags: at('illustrious') })).toBe('masterpiece, best quality, amazing quality, 1girl, solo');
    expect(sentPrompt({ prompt: '1girl, solo, ', qualityTags: at('animagine') })).toBe('1girl, solo, masterpiece, high score, great score, absurdres');
    expect(sentPrompt({ prompt: '1girl' })).toBe('1girl');
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
