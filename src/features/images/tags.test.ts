import { describe, expect, it } from 'vitest';
import { completeTag, parseTags, searchTags, tagQuery, tagText } from './tags';
import { cleanTags } from './to-tags';

const list = parseTags(
  [
    '# comment',
    '1girl\t0\t8483124\tsole_female,1girls',
    'long_hair\t0\t6263710\t/lh,longhair',
    'breasts\t0\t5022234\toppai,boobs',
    'hair_ornament\t0\t2091595\thair_accessory',
    'oppai_loli\t0\t10000\t',
    'hatsune_miku\t4\t150000\tmiku',
    'kaban_(kemono_friends)\t4\t5905\tkaban',
    '^_^\t0\t30000\t'
  ].join('\n')
);

describe('Danbooru tags', () => {
  it('find tags by their start, a word in them or an alias, most posts first, after the one typed in full', () => {
    expect(searchTags(list, 'lo').map((m) => m.name)).toEqual(['long_hair', 'oppai_loli']);
    expect(searchTags(list, 'oppai')[0]).toEqual({ name: 'breasts', category: 'general', count: 5022234, alias: 'oppai' });
    // A tag found by an alias ranks by its posts too
    expect(searchTags(list, 'oppa').map((m) => [m.name, m.alias])).toEqual([
      ['breasts', 'oppai'],
      ['oppai_loli', undefined]
    ]);
    expect(searchTags(list, 'h').map((m) => m.name)).toEqual(['long_hair', 'hair_ornament', 'hatsune_miku']);
    expect(searchTags(list, 'hair').map((m) => m.name)).toEqual(['long_hair', 'hair_ornament']);
    // Spaces are typed for underscores, and the series in parentheses is a word too
    expect(searchTags(list, 'long ha').map((m) => m.name)).toEqual(['long_hair']);
    expect(searchTags(list, 'kemono').map((m) => m.name)).toEqual(['kaban_(kemono_friends)']);
    expect(searchTags(list, 'miku')[0]).toMatchObject({ name: 'hatsune_miku', category: 'character' });
    expect(searchTags(list, '  ')).toEqual([]);
    // The tag or alias typed in full comes first
    expect(searchTags(list, 'kaban')[0]).toMatchObject({ name: 'kaban_(kemono_friends)', alias: 'kaban' });
  });
  it('write tags with spaces and escaped parentheses, keeping emoticons', () => {
    expect(tagText('long_hair')).toBe('long hair');
    expect(tagText('kaban_(kemono_friends)')).toBe('kaban \\(kemono friends\\)');
    expect(tagText('^_^')).toBe('^_^');
  });
  it('replace the tag being typed at the end of the prompt', () => {
    expect(tagQuery('1girl, lon')).toBe('lon');
    expect(completeTag('1girl, lon', 'long_hair')).toBe('1girl, long hair, ');
    expect(completeTag('1girl,lon', 'long_hair')).toBe('1girl, long hair, ');
    expect(completeTag('lon', 'long_hair')).toBe('long hair, ');
    expect(completeTag('1girl, (lon', 'long_hair')).toBe('1girl, (long hair, ');
    expect(completeTag('a\nmik', 'hatsune_miku')).toBe('a\nhatsune miku, ');
  });
});

describe('to tags', () => {
  it("read the chat model's answer as one line of tags", () => {
    expect(cleanTags('```\n1girl, solo,\nsmile\n```')).toBe('1girl, solo, smile');
    expect(cleanTags('"1girl, long hair"')).toBe('1girl, long hair');
  });
});
