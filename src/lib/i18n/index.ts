// Localization (Japanese, English, Simplified Chinese). No dependencies.
//
// Each folder keeps its own messages next to its code (messages.ts):
//
//   export const t = defineMessages(
//     { save: '保存', deleted: '{name} を削除しました' },               // Japanese: the reference, defines the keys
//     { en: { save: 'Save', deleted: 'Deleted {name}' }, zh: { save: '保存', deleted: '已删除 {name}' } }
//   );
//   t('deleted', { name: f.name })
//
// TypeScript checks that every language has exactly the same keys. The current language is a plain
// module variable (lib/ stays UI-independent); the app re-renders from its root when it changes.

export type Lang = 'ja' | 'en' | 'zh';
export const LANGS: readonly Lang[] = ['ja', 'en', 'zh'];
/** Names shown in the language picker (each in its own language) */
export const LANG_NAMES: Record<Lang, string> = { ja: '日本語', en: 'English', zh: '简体中文' };
/** Names in English, for prompts that ask a model to answer in the UI language (prompts are in English) */
export const LANG_ENGLISH_NAMES: Record<Lang, string> = { ja: 'Japanese', en: 'English', zh: 'Simplified Chinese' };

let current: Lang = 'ja';

/**
 * Called whenever text is produced (t() and the formatters). The app installs a tracker that reads its
 * language signal, so every component that renders text subscribes to the language and updates when it
 * changes (signal-aware components skip re-renders that only come from their parent).
 */
let track: () => void = () => {};
export function setLanguageTracker(fn: () => void) {
  track = fn;
}

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang) {
  current = l;
}

/** The best language for the browser's preferences (falls back to English) */
export function detectLang(preferred: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []): Lang {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'ja') return 'ja';
    if (base === 'zh') return 'zh';
    if (base === 'en') return 'en';
  }
  return 'en';
}

export type Params = Record<string, string | number>;

/** Replace {name} placeholders (unknown ones are left as they are) */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export type Translate<K extends string> = (key: K, params?: Params) => string;

export function defineMessages<K extends string>(ja: Record<K, string>, others: { en: Record<K, string>; zh: Record<K, string> }): Translate<K> {
  return (key, params) => {
    track();
    return interpolate((current === 'ja' ? ja : others[current])[key] ?? ja[key] ?? key, params);
  };
}

/** BCP 47 locale for Intl formatting */
export function locale(l: Lang = current): string {
  track();
  return { ja: 'ja-JP', en: 'en-US', zh: 'zh-CN' }[l];
}

// Creating an Intl formatter is far slower than using one (tens of µs against under 1 µs), and lists format
// one value per row: formatters are kept per locale and options
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat>();
function formatter<F extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat>(kind: string, opts: object | undefined, make: (loc: string) => F): F {
  const loc = locale();
  const key = `${kind}|${loc}|${opts ? JSON.stringify(opts) : ''}`;
  let f = formatters.get(key) as F | undefined;
  if (!f) formatters.set(key, (f = make(loc)));
  return f;
}

export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return formatter('n', opts, (loc) => new Intl.NumberFormat(loc, opts)).format(n);
}

/**
 * An amount in US dollars, written the same way everywhere: cents from $1 up ($12.34), two significant digits below
 * ($0.50, $0.012, $0.00042), and $0 for nothing
 */
export function formatUsd(n: number): string {
  if (n === 0) return '$0';
  return `$${formatNumber(n, n >= 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { minimumSignificantDigits: 2, maximumSignificantDigits: 2 })}`;
}

/** A size in bytes: B, KB, MB with one decimal, GB with one decimal */
export function formatBytes(n: number): string {
  if (n < 1024) return `${formatNumber(n)} B`;
  if (n < 1024 * 1024) return `${formatNumber(Math.round(n / 1024))} KB`;
  const one = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  if (n < 1024 ** 3) return `${formatNumber(n / 1024 / 1024, one)} MB`;
  return `${formatNumber(n / 1024 ** 3, one)} GB`;
}

export function formatDate(ts: number | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return formatter('d', opts, (loc) => new Intl.DateTimeFormat(loc, opts)).format(ts);
}

export function formatDateTime(ts: number | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string {
  return formatDate(ts, opts);
}

export function formatTime(ts: number | Date): string {
  return formatDate(ts, { hour: '2-digit', minute: '2-digit' });
}

/** Join a list the way the language does ("A, B and C" / "A、B、C") */
export function formatList(items: string[]): string {
  return formatter('l', undefined, (loc) => new Intl.ListFormat(loc, { style: 'short', type: 'conjunction' })).format(items);
}
