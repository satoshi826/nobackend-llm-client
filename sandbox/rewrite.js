// Rewrites an HTML page of a project so that the project files it uses (stylesheets, scripts, ES modules, images,
// media) come from what the app passed in, not from the network, which the sandbox's CSP blocks. The build puts this
// file into the sandbox page's own script (vite.config.ts), so it uses only what that page has: DOMParser, Blob,
// URL.createObjectURL. It must not contain a closing script tag.
//   rewritePage(html, path, files, names): path is the page's own project path ('site/index.html'); files maps project
//   paths (no leading slash, e.g. 'site/css/style.css') to text or a Blob. Returns the html to write. names (a Map,
//   optional) gets each blob: URL made, with the path it stands for, so messages about it can name the file.
// A reference resolves from the folder of the file it is in ('/' is the project root), and matches a path whatever its
// case. Absolute URLs ('https:', 'data:', '//host', '#top'), bare module specifiers ('react') and paths not in files
// are left as they are.
// - A stylesheet becomes a <style> with its text (the CSP allows no blob: styles). Its url()s resolve from the
//   stylesheet's own path, and an @import of a project stylesheet without conditions is inlined in its place (one with
//   a media list or other conditions is not, and fails).
// - Scripts, images and media get blob: URLs of the files. Fonts would too, but the CSP allows them only from data:.
// - In module scripts, the specifiers of static and dynamic imports and of `export ... from` get blob: URLs of the
//   rewritten modules. A module whose import leads back to a module still being rewritten keeps that specifier (a
//   cycle cannot be built from blob: URLs; the browser then reports the failed import).
// Only files given as text are rewritten (stylesheets, modules); a Blob is used as it is.

const TYPES = {
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  html: 'text/html',
  txt: 'text/plain',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  vtt: 'text/vtt'
};
const typeOf = (path) => TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] || '';

// Static imports and exports with `from`, side-effect imports, and import() of a string literal
const IMPORT = /(\b(?:import|export)\b[\w\s{},*$]*?\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])([^'"\n]+)\2/g;
// An @import without conditions ('@import "a.css";', '@import url(a.css);'), or any url()
const CSS_REF = /@import\s+(?:url\(\s*(['"]?)([^'")]*)\1\s*\)|(['"])([^'"]*)\3)\s*;|url\(\s*(['"]?)([^'")]*)\5\s*\)/g;
// The URL of each srcset candidate: at the start or after a comma and a space (a data: URL has commas of its own)
const SRCSET_URL = /(^\s*|,\s+)(\S+?)(?=,?(?:\s|$))/g;

const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** The project path a reference points at from the file at `from`, or null for an absolute URL. Drops ?query and #hash */
function resolvePath(ref, from) {
  ref = ref.trim();
  if (!ref || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(ref)) return null;
  const parts = ref.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const seg of ref.replace(/[?#].*/s, '').split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(decode(seg));
  }
  return parts.join('/');
}

function rewritePage(html, path, files, names) {
  const assets = new Map(); // path → blob: URL of the file as it is
  const modules = new Map(); // path → blob: URL of the rewritten module
  const inProgress = new Set(); // modules and stylesheets being rewritten: a reference back to one is a cycle
  // Paths match whatever their case (in NFC), as in the app: 'CSS/Style.css' finds 'css/style.css'
  const keys = new Map(Object.keys(files).map((k) => [k.normalize('NFC').toLowerCase(), k]));
  const at = (ref, from) => {
    const p = resolvePath(ref, from);
    return p === null ? null : Object.hasOwn(files, p) ? p : (keys.get(p.normalize('NFC').toLowerCase()) ?? p);
  };
  const has = (p) => p !== null && Object.hasOwn(files, p);
  const text = (p) => (typeof files[p] === 'string' ? files[p] : null);

  function asset(p) {
    if (!assets.has(p)) {
      const f = files[p];
      assets.set(p, URL.createObjectURL(f instanceof Blob && f.type ? f : new Blob([f], { type: typeOf(p) })));
      names?.set(assets.get(p), p);
    }
    return assets.get(p);
  }

  /** A module's blob: URL, or null when it is still being rewritten (a cycle) */
  function moduleUrl(p) {
    if (modules.has(p)) return modules.get(p);
    if (text(p) === null || typeOf(p) !== 'text/javascript') return asset(p); // JSON, CSS (import attributes), a Blob
    if (inProgress.has(p)) return null;
    inProgress.add(p);
    const url = URL.createObjectURL(new Blob([rewriteModule(text(p), p)], { type: 'text/javascript' }));
    names?.set(url, p);
    inProgress.delete(p);
    modules.set(p, url);
    return url;
  }

  function rewriteModule(code, from) {
    return code.replace(IMPORT, (all, head, q, spec) => {
      // Only relative and root specifiers name files; 'react' or 'lib/x' are bare, left for an import map
      if (!/^\.{0,2}\//.test(spec) || spec.startsWith('//')) return all;
      const p = at(spec, from);
      const url = has(p) ? moduleUrl(p) : null;
      return url ? head + q + url + q : all;
    });
  }

  /** A stylesheet's text with its references resolved, or null when it is not text or is being rewritten (a cycle) */
  function stylesheet(p) {
    if (text(p) === null || inProgress.has(p)) return null;
    inProgress.add(p);
    const css = rewriteCss(text(p), p);
    inProgress.delete(p);
    return css;
  }

  function rewriteCss(css, from) {
    return css.replace(CSS_REF, (all, _q1, importUrl, _q2, importText, _q3, url) => {
      const p = at(url ?? importUrl ?? importText, from);
      if (!has(p)) return all;
      return url === undefined ? (stylesheet(p) ?? all) : `url("${asset(p)}")`;
    });
  }

  /** The URL for a reference from the page: the file's blob: URL when it is a project file, else the reference */
  const ref = (r, make = asset) => {
    const p = at(r, path);
    return (has(p) && make(p)) || r;
  };

  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Styles in the page first, so the stylesheets inlined below are not resolved a second time from the page
  for (const el of doc.querySelectorAll('style')) el.textContent = rewriteCss(el.textContent, path);
  for (const el of doc.querySelectorAll('[style]')) el.setAttribute('style', rewriteCss(el.getAttribute('style'), path));
  for (const link of doc.querySelectorAll('link[rel~="stylesheet" i][href]')) {
    const p = at(link.getAttribute('href'), path);
    const css = has(p) ? stylesheet(p) : null;
    if (css === null) continue;
    const style = doc.createElement('style');
    if (link.hasAttribute('media')) style.setAttribute('media', link.getAttribute('media'));
    style.textContent = css;
    link.replaceWith(style);
  }
  for (const s of doc.querySelectorAll('script')) {
    const isModule = (s.getAttribute('type') || '').trim().toLowerCase() === 'module';
    if (s.hasAttribute('src')) s.setAttribute('src', ref(s.getAttribute('src'), isModule ? moduleUrl : asset));
    else if (isModule) s.textContent = rewriteModule(s.textContent, path);
  }
  for (const el of doc.querySelectorAll('img[src], source[src], video[src], audio[src], track[src]')) el.setAttribute('src', ref(el.getAttribute('src')));
  for (const el of doc.querySelectorAll('video[poster]')) el.setAttribute('poster', ref(el.getAttribute('poster')));
  for (const el of doc.querySelectorAll('img[srcset], source[srcset]'))
    el.setAttribute('srcset', el.getAttribute('srcset').replace(SRCSET_URL, (_, sep, url) => sep + ref(url)));
  return (doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : '') + doc.documentElement.outerHTML;
}
