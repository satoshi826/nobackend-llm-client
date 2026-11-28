// An address the model put together (the app's check, src/state/fetch-check.ts): it is asked about even on a site the
// user chose not to be asked about, with the parts that appeared nowhere in the conversation marked.
import type { FetchCheck } from '../src/lib/fetcher/protocol';

/**
 * Whether the question is skipped and the address fetched straight away: only on a site not asked about, for an
 * address that came from the conversation as it is, never for a redirect whose target is hidden
 */
export const skipsQuestion = (host: string, remembered: readonly string[], o: { blind?: boolean; check: FetchCheck | null }) => !o.blind && !o.check && remembered.includes(host);

/** The address in pieces for showing it, the put-together ranges marked */
export function markedPieces(href: string, ranges: [number, number][]): { text: string; marked: boolean }[] {
  const out: { text: string; marked: boolean }[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) out.push({ text: href.slice(at, start), marked: false });
    out.push({ text: href.slice(start, end), marked: true });
    at = end;
  }
  if (at < href.length) out.push({ text: href.slice(at), marked: false });
  return out;
}
