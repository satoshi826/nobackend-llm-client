// Server-Sent Events parser (for fetch's ReadableStream)
// - handles events and UTF-8 characters split across chunk boundaries
// - ignores comment lines (": keep-alive")
// - joins multi-line data with "\n"

export interface SSEMessage {
  event?: string;
  data: string;
  id?: string;
}

export async function* parseSSE(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SSEMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let event: string | undefined;
  let id: string | undefined;

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = indexOfNewline(buffer)) >= 0) {
        let line = buffer.slice(0, nl);
        const skip = buffer[nl] === '\r' && buffer[nl + 1] === '\n' ? 2 : 1;
        buffer = buffer.slice(nl + skip);
        if (line === '') {
          if (dataLines.length > 0) {
            yield { event, data: dataLines.join('\n'), id };
          }
          dataLines = [];
          event = undefined;
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        let field = line;
        let val = '';
        if (colon >= 0) {
          field = line.slice(0, colon);
          val = line.slice(colon + 1);
          if (val.startsWith(' ')) val = val.slice(1);
        }
        if (field === 'data') dataLines.push(val);
        else if (field === 'event') event = val;
        else if (field === 'id') id = val;
        line = '';
      }
    }
    buffer += decoder.decode();
    // Emit the remaining data even without a trailing blank line
    if (buffer.length > 0) {
      for (const line of buffer.split(/\r?\n/)) {
        if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (dataLines.length > 0) yield { event, data: dataLines.join('\n'), id };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

function indexOfNewline(s: string): number {
  const n = s.indexOf('\n');
  const r = s.indexOf('\r');
  if (n < 0) return r < 0 ? -1 : r === s.length - 1 ? -1 : r; // a trailing \r waits for \n
  if (r < 0) return n;
  return Math.min(n, r);
}
