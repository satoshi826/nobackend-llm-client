import { describe, expect, it, vi } from 'vitest';
import { librariesFor, libraryNames, registerLibrary } from './libraries';

describe('libraries scripts may require', () => {
  it('loads only the libraries the sources require by a quoted name, and those they require, once each', async () => {
    const tiny = vi.fn(async () => "exports.twice = (n) => n * 2; require('base');");
    const base = vi.fn(async () => 'exports.one = 1;');
    const unused = vi.fn(async () => '');
    registerLibrary('tiny', tiny);
    registerLibrary('base', base);
    registerLibrary('unused', unused);
    expect(libraryNames()).toEqual(['base', 'tiny', 'unused']);
    expect(await librariesFor(['const t = require("tiny");', "require('fs'); const name = 'unused'; require(name);"])).toEqual({
      tiny: "exports.twice = (n) => n * 2; require('base');",
      base: 'exports.one = 1;'
    });
    await librariesFor(["require('tiny')"]);
    expect(tiny).toHaveBeenCalledTimes(1);
    expect(base).toHaveBeenCalledTimes(1);
    expect(unused).not.toHaveBeenCalled();
    expect(await librariesFor(['console.log(1)'])).toEqual({});
  });
});
