// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
// The file as the build puts it into the sandbox page's script: a plain script that declares rewritePage
import source from '../../../sandbox/rewrite.js?raw';

type Files = Record<string, string | Blob>;
const rewritePage = new Function(`${source}\nreturn rewritePage;`)() as (html: string, path: string, files: Files) => string;

// URL.createObjectURL gives blob:1, blob:2, ... and keeps each Blob to read back
let blobs: Blob[] = [];
beforeEach(() => {
  blobs = [];
  URL.createObjectURL = (b: Blob) => `blob:${blobs.push(b)}`;
});
const blob = (url: string) => blobs[Number(url.slice('blob:'.length)) - 1];
const textOf = (url: string) => blob(url).text();
const attr = (html: string, selector: string, name: string) =>
  new DOMParser().parseFromString(html, 'text/html').querySelector(selector)!.getAttribute(name)!;
const content = (html: string, selector: string) => new DOMParser().parseFromString(html, 'text/html').querySelector(selector)!.textContent!;

describe('rewritePage', () => {
  it('resolves ./, ../, bare relative and root paths from the page folder', () => {
    const files = { 'site/a.png': 'a', 'img/b.png': 'b', 'site/img/c.png': 'c', 'd.png': 'd' };
    const html = rewritePage(
      '<img id="a" src="./a.png"><img id="b" src="../img/b.png"><img id="c" src="img/c.png?v=2"><img id="d" src="/d.png">',
      'site/index.html',
      files
    );
    for (const id of ['a', 'b', 'c', 'd']) expect(attr(html, `#${id}`, 'src')).toMatch(/^blob:/);
    expect(blobs.map((b) => b.type)).toEqual(['image/png', 'image/png', 'image/png', 'image/png']);
  });

  it('leaves absolute URLs and missing files as they are', () => {
    const page =
      '<img id="a" src="https://x.example/a.png"><img id="b" src="data:image/png;base64,AA=="><img id="c" src="//x.example/c.png"><img id="d" src="missing.png"><script src="#top"></script>';
    const html = rewritePage(page, 'index.html', { 'a.png': 'a' });
    expect(attr(html, '#a', 'src')).toBe('https://x.example/a.png');
    expect(attr(html, '#b', 'src')).toBe('data:image/png;base64,AA==');
    expect(attr(html, '#c', 'src')).toBe('//x.example/c.png');
    expect(attr(html, '#d', 'src')).toBe('missing.png');
    expect(attr(html, 'script', 'src')).toBe('#top');
    expect(blobs).toEqual([]);
  });

  it('keeps an image Blob as it is, and the doctype', () => {
    const png = new Blob(['PNG'], { type: 'image/png' });
    const html = rewritePage('<!doctype html><img src="logo">', 'index.html', { logo: png });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(blob(attr(html, 'img', 'src'))).toBe(png);
  });

  it('turns a stylesheet link into a style, with url() and @import resolved from the stylesheet', () => {
    const files = {
      'site/css/style.css': '@import "parts/base.css";\nbody { background: url(../img/bg.png) }\n.x { background: url("https://x.example/y.png") }',
      'site/css/parts/base.css': 'h1 { background: url(\'/icons/h.svg\') }',
      'site/img/bg.png': new Blob(['png'], { type: 'image/png' }),
      'icons/h.svg': '<svg/>'
    };
    const html = rewritePage('<link rel="Stylesheet" href="css/style.css" media="screen">', 'site/index.html', files);
    expect(html).not.toContain('<link');
    expect(attr(html, 'style', 'media')).toBe('screen');
    const css = content(html, 'style');
    expect(css).toMatch(/^h1 \{ background: url\("blob:\d"\) \}\nbody \{ background: url\("blob:\d"\) \}/);
    expect(css).toContain('url("https://x.example/y.png")');
    expect(blobs.map((b) => b.type).sort()).toEqual(['image/png', 'image/svg+xml']);
  });

  it('resolves url() in style elements and attributes from the page', () => {
    const html = rewritePage('<style>p { background: url(a.png) }</style><p style="background: url(./a.png)"></p>', 'x/i.html', { 'x/a.png': 'a' });
    expect(content(html, 'style')).toBe('p { background: url("blob:1") }');
    expect(attr(html, 'p', 'style')).toBe('background: url("blob:1")');
  });

  it('gives classic scripts, media and srcset candidates blob: URLs', async () => {
    const files = { 'app.js': 'console.log(1)', 'a.png': 'a', 'b.png': 'b', 'v.mp4': 'v', 'p.jpg': 'p' };
    const page =
      '<script src="app.js"></script><img srcset="a.png 1x, b.png 2x, data:image/png;base64,AA 3x"><video src="v.mp4" poster="p.jpg"></video>';
    const html = rewritePage(page, 'index.html', files);
    const src = attr(html, 'script', 'src');
    expect(blob(src).type).toBe('text/javascript');
    expect(await textOf(src)).toBe('console.log(1)');
    expect(attr(html, 'img', 'srcset')).toMatch(/^blob:\d 1x, blob:\d 2x, data:image\/png;base64,AA 3x$/);
    expect(attr(html, 'video', 'src')).toMatch(/^blob:/);
    expect(blob(attr(html, 'video', 'poster')).type).toBe('image/jpeg');
  });

  it('rewrites a module import graph depth-first, once per module, leaving bare specifiers', async () => {
    const files = {
      'js/a.js': "import { b } from './b.js';\nimport React from 'react';\nexport * from \"./c.js\";\nb();",
      'js/b.js': "import {\n  c\n} from './c.js';\nexport const b = () => c;",
      'js/c.js': 'export const c = 1;'
    };
    const html = rewritePage('<script type="module" src="js/a.js"></script>', 'index.html', files);
    const a = await textOf(attr(html, 'script', 'src'));
    const [, bUrl] = /from '(blob:\d)'/.exec(a)!;
    const [, cUrl] = /from "(blob:\d)"/.exec(a)!;
    expect(a).toContain("from 'react'");
    expect(await textOf(bUrl)).toBe(`import {\n  c\n} from '${cUrl}';\nexport const b = () => c;`);
    expect(await textOf(cUrl)).toBe('export const c = 1;');
    expect(blobs).toHaveLength(3);
    expect(blobs.every((b) => b.type === 'text/javascript')).toBe(true);
  });

  it('rewrites inline module scripts, side-effect imports and dynamic imports', async () => {
    const files = { 'lib/x.js': "import('./y.js').then(() => {});", 'lib/y.js': 'export {}', 'data.json': '{}' };
    const page = '<script type="module">import "./lib/x.js";\nimport d from \'/data.json\' with { type: \'json\' };</script><script>import("./lib/x.js")</script>';
    const html = rewritePage(page, 'index.html', files);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const [inline, classic] = [...doc.querySelectorAll('script')].map((s) => s.textContent!);
    const [, xUrl] = /import "(blob:\d)"/.exec(inline)!;
    const [, dUrl] = /import d from '(blob:\d)'/.exec(inline)!;
    expect(blob(dUrl).type).toBe('application/json');
    expect(await textOf(xUrl)).toMatch(/^import\('blob:\d'\)\.then/);
    // A classic inline script is left as it is
    expect(classic).toBe('import("./lib/x.js")');
  });

  it('leaves the specifier that closes an import cycle as it is', async () => {
    const files = { 'a.js': "import './b.js';", 'b.js': "import './a.js';" };
    const html = rewritePage('<script type="module" src="a.js"></script>', 'index.html', files);
    const a = await textOf(attr(html, 'script', 'src'));
    const [, bUrl] = /import '(blob:\d)'/.exec(a)!;
    expect(await textOf(bUrl)).toBe("import './a.js';");
  });
});

describe('rewritePage paths', () => {
  it('finds a site file whatever the case of the reference, as the app compares paths', () => {
    const html = rewritePage('<img id="a" src="IMG/Logo.PNG">', 'index.html', { 'img/logo.png': 'x' });
    expect(attr(html, '#a', 'src')).toMatch(/^blob:/);
  });
});
