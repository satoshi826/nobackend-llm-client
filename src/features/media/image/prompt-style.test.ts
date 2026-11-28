// How image models want their prompt (tags or sentences) and how long it may be, from the providers' own lists
import { describe, expect, it } from 'vitest';
import { promptLength, promptStyleOf } from './providers/common';
import { mapImageModel } from './providers/venice';
import { mapNanoImageModel } from './providers/hosts';
import { makeImageTool } from './tool';

describe('prompt style', () => {
  it('reads the anime families from names, then descriptions (names and descriptions as the lists had them on 2026-11-28)', () => {
    expect(promptStyleOf('Anime (WAI)', 'Anime (WAI) is WAI-Illustrious, a community anime checkpoint built on Illustrious XL')).toEqual({ promptStyle: 'tags', family: 'illustrious' });
    expect(promptStyleOf('Animagine XL 4.0')).toEqual({ promptStyle: 'tags', family: 'animagine' });
    expect(promptStyleOf('2DN Pony v2')).toEqual({ promptStyle: 'tags', family: 'pony' });
    expect(promptStyleOf('Zuki Anime ILL')).toEqual({ promptStyle: 'tags', family: 'illustrious' });
    expect(promptStyleOf('NoobAI XL', 'Built on Illustrious XL')).toEqual({ promptStyle: 'tags', family: 'noobai' });
    expect(promptStyleOf('Nova Anime XL', 'A vibrant anime illustration model based on Illustrious XL. Works best with Danbooru tags.').family).toBe('illustrious');
    // Tag-driven without a known family
    expect(promptStyleOf('Anima', 'A fast 2B anime image model for tag-driven illustrations')).toEqual({ promptStyle: 'tags' });
    // Everything else is written in sentences ("illustration" is not Illustrious; "ill" only in capitals)
    expect(promptStyleOf('Flux 2 Pro', 'aimed at illustration, anime and painting')).toEqual({ promptStyle: 'natural' });
    expect(promptStyleOf('Lustify SDXL', 'will ill-advisedly')).toEqual({ promptStyle: 'natural' });
  });
  it('take the style from NanoGPT names, not ids (some ids name another model)', () => {
    const nano = (id: string, name: string) => mapNanoImageModel({ id, name, architecture: { input_modalities: ['text'] }, supported_parameters: { resolutions: ['1024x1024'], max_prompt_characters: 3000 } })!;
    expect(nano('animagine-xl-31', 'Crystal Clear XL').promptStyle).toBe('natural');
    const m = nano('nsfw-gen-illustrious', 'Animagine XL 4.0');
    expect(m.family).toBe('animagine');
    expect(m.promptLimit).toBe(3000);
  });
  it('read the prompt limit Venice lists', () => {
    const m = mapImageModel({ id: 'wai-Illustrious', model_spec: { name: 'Anime (WAI)', description: 'built on Illustrious XL', constraints: { promptCharacterLimit: 1500, widthHeightDivisor: 16 } } })!;
    expect(m).toMatchObject({ promptStyle: 'tags', family: 'illustrious', promptLimit: 1500 });
    expect(mapImageModel({ id: 'x', model_spec: { constraints: {} } })!.promptLimit).toBeUndefined();
  });
  it('count code points, as the providers do', () => {
    expect(promptLength('猫😺')).toBe(2);
  });
  it('tell the chat model how to write the prompt for the image model', () => {
    const run = async () => ({ fileIds: [], paths: [], inWorkDir: false, model: '', blurred: false });
    const tags = makeImageTool(run, { promptStyle: 'tags', promptLimit: 1500 });
    expect(tags.description).toContain('Danbooru tags');
    expect(tags.description).toContain('within 1500 characters');
    const natural = makeImageTool(run, { promptStyle: 'natural' });
    expect(natural.description).not.toContain('Danbooru');
    expect(natural.description).not.toContain('characters.');
  });
});
