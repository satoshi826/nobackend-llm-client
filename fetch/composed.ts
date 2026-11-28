// How an address is asked about. One the model put together (the app's check, src/state/fetch-check.ts) is asked about
// even on a site the user chose not to be asked about, with no choice to stop asking, and with the parts that appeared
// nowhere in the conversation marked. Every address is shown readable: percent-escapes decoded where that hides nothing.
import type { FetchCheck } from '../src/lib/fetcher/protocol';

/**
 * Whether the question is skipped and the address fetched straight away: only on a site not asked about, for an
 * address that came from the conversation as it is, never for a redirect whose target is hidden
 */
export const skipsQuestion = (host: string, remembered: readonly string[], o: { blind?: boolean; check: FetchCheck | null }) => !o.blind && !o.check && remembered.includes(host);

/** A question offers not to ask again only for an address that came from the conversation, and not for a hidden redirect */
export const offersRemember = (o: { blind?: boolean; check: FetchCheck | null }) => !o.blind && !o.check;

/**
 * Percent-escapes as the user reads them: each run decoded to its characters, but those that would hide or blur what is
 * sent stay escaped: controls, invisible and direction-changing characters, white space other than a space, and the
 * characters that split an address (/ ? # & = + %). A run that is not UTF-8 stays as it is
 */
export function readable(s: string): string {
  return s.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    let text: string;
    try {
      text = decodeURIComponent(run);
    } catch {
      return run;
    }
    return [...text].map((c) => (/[\p{L}\p{M}\p{N}\p{P}\p{S} ]/u.test(c) && !/[/?#&=+%]/.test(c) ? c : encodeURIComponent(c).toUpperCase())).join('');
  });
}

/**
 * The address in pieces for showing it, readable (the fetch uses the address as it is), the put-together ranges marked.
 * The ranges lie between pieces of the address (host, path segments, parameters), so no escape is split
 */
export function markedPieces(href: string, ranges: [number, number][]): { text: string; marked: boolean }[] {
  const out: { text: string; marked: boolean }[] = [];
  const push = (text: string, marked: boolean) => out.push({ text: readable(text), marked });
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) push(href.slice(at, start), false);
    push(href.slice(start, end), true);
    at = end;
  }
  if (at < href.length) push(href.slice(at), false);
  return out;
}
