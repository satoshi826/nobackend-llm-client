// Server-Sent Events パーサ（fetch の ReadableStream 用）
// - チャンク境界でイベントや UTF-8 文字が分割されても正しく扱う
// - コメント行（": keep-alive"）を無視
// - 複数行 data を "\n" で連結

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
        // \r\n を 1 つの改行として扱う
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
    // 末尾に空行がなくても残りの data を出す
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
  if (n < 0) return r < 0 ? -1 : r === s.length - 1 ? -1 : r; // 末尾の \r は \n を待つ
  if (r < 0) return n;
  return Math.min(n, r);
}
