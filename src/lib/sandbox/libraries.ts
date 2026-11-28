// Libraries a skill's script may require by name (require('docx')) in the sandbox. Each is the source of one
// CommonJS module, loaded only when a script asks for it: the sandbox reaches nothing, so the app loads what a run
// needs before it starts (a library is a file the app serves, fetched on first use) and hands it over with the job.
// None is registered yet.

const libraries = new Map<string, () => Promise<string>>();
const loaded = new Map<string, Promise<string>>();

/** Make a library available to scripts: load gives its source (a CommonJS module, in one file) */
export function registerLibrary(name: string, load: () => Promise<string>) {
  libraries.set(name, load);
}

/** Every library a script could require */
export const libraryNames = (): string[] => [...libraries.keys()].sort();

/** The registered names `source` requires with a string literal: require('name') or require("name") */
function requiredIn(source: string): string[] {
  return [...source.matchAll(/\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g)].map((m) => m[2]).filter((n) => libraries.has(n));
}

/**
 * The libraries these sources (a script and the skill's other .js files) require, and the ones those require, by
 * name: their sources. A library is loaded once per page
 */
export async function librariesFor(sources: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let next = [...new Set(sources.flatMap(requiredIn))];
  while (next.length) {
    const got = await Promise.all(next.map((n) => loadLibrary(n)));
    next.forEach((n, i) => (out[n] = got[i]));
    next = [...new Set(got.flatMap(requiredIn))].filter((n) => !(n in out));
  }
  return out;
}

function loadLibrary(name: string): Promise<string> {
  let p = loaded.get(name);
  if (!p) {
    p = libraries.get(name)!();
    loaded.set(name, p);
    // A failed load is tried again next time
    p.catch(() => loaded.delete(name));
  }
  return p;
}
