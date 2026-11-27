// localStorage and sessionStorage for the sandbox. A page without an origin has neither (reading them throws), so
// these stand in for both. The build puts this file into the sandbox page's own script (vite.config.ts), like
// rewrite.js; it must not contain a closing script tag.
//   makeStorage(initial, onChange): an object with the Storage methods over a Map of strings, whose items can also be
//   used as properties (localStorage.theme = 'dark') through a Proxy. onChange(items) after every change that
//   changed something (null: nothing is told).
//   installStorage(local, session): put them on the window as localStorage and sessionStorage.

function makeStorage(initial, onChange) {
  const map = new Map(Object.entries(initial || {}).filter(([, v]) => typeof v === 'string'));
  const changed = () => onChange && onChange(Object.fromEntries(map));
  const api = {
    get length() {
      return map.size;
    },
    key(i) {
      const k = [...map.keys()][Math.floor(Number(i))];
      return k === undefined ? null : k;
    },
    getItem(k) {
      k = String(k);
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      k = String(k);
      v = String(v);
      if (map.get(k) === v) return;
      map.set(k, v);
      changed();
    },
    removeItem(k) {
      if (map.delete(String(k))) changed();
    },
    clear() {
      if (!map.size) return;
      map.clear();
      changed();
    }
  };
  const own = (p) => typeof p === 'symbol' || p in api;
  return new Proxy(api, {
    get: (t, p) => (own(p) ? Reflect.get(t, p) : map.has(p) ? map.get(p) : undefined),
    // As in browsers, assigning stores an item even under a method's name; the method stays what it reads as
    set: (t, p, v) => (typeof p === 'symbol' ? Reflect.set(t, p, v) : (api.setItem(p, v), true)),
    deleteProperty: (t, p) => (own(p) || api.removeItem(p), true),
    has: (t, p) => own(p) || map.has(p),
    ownKeys: () => [...map.keys()],
    getOwnPropertyDescriptor: (t, p) => (!own(p) && map.has(p) ? { value: map.get(p), writable: true, enumerable: true, configurable: true } : undefined)
  });
}

function installStorage(local, session) {
  for (const [name, value] of [
    ['localStorage', local],
    ['sessionStorage', session]
  ]) {
    try {
      Object.defineProperty(window, name, { value, configurable: true, enumerable: true });
    } catch {
      /* left as it is */
    }
  }
}
