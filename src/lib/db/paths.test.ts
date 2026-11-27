import { describe, expect, it } from 'vitest';
import { cleanFileName, cleanFolderName } from './files';
import { freeFolder, freePath, isInside, pathFree, pathKey } from './paths';

const taken = [
  { id: '1', path: 'Todo/index.html' },
  { id: '2', path: 'notes.md' },
  { id: '3', path: 'pics/cat.png' }
];

describe('paths', () => {
  it('cleans names into NFC, so a name from a Mac disk matches the one a model writes', () => {
    const nfd = 'が.md'; // が written as か + a combining mark
    expect(cleanFileName(nfd)).toBe('が.md');
    expect(cleanFolderName(' Site / ./css/../ ')).toBe('Site/css/');
    expect(cleanFolderName('../')).toBe('');
  });

  it('compares paths in NFC with case folded', () => {
    expect(pathKey('Todo/Index.HTML')).toBe('todo/index.html');
    expect(isInside('TODO/app.js', 'todo/')).toBe(true);
    expect(isInside('todo-2/app.js', 'todo/')).toBe(false);
  });

  it('keeps a path free only when no one has it, uses it as a folder, or is a file where it has a folder', () => {
    expect(pathFree('todo/index.html', taken)).toBe(false); // case differs only
    expect(pathFree('todo/index.html', taken, '1')).toBe(true); // the file itself
    expect(pathFree('pics', taken)).toBe(false); // a folder of another path
    expect(pathFree('notes.md/a.css', taken)).toBe(false); // under a file
    expect(pathFree('todo/style.css', taken)).toBe(true);
  });

  it('numbers a taken path or folder', () => {
    expect(freePath('notes.md', taken)).toBe('notes (2).md');
    expect(freePath('Todo/index.html', [...taken, { id: '4', path: 'todo/index (2).html' }])).toBe('Todo/index (3).html');
    expect(freePath('README', [{ id: '1', path: 'readme' }])).toBe('README (2)');
    expect(freeFolder('todo/', taken)).toBe('todo (2)/');
    expect(freeFolder('notes.md/', taken)).toBe('notes.md (2)/');
    expect(freeFolder('fresh/', taken)).toBe('fresh/');
  });
});
