// Turning a file the user picked into text the model can read.
// Text formats are read as-is; PDFs go through pdf.js, which is loaded only when needed.

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'html', 'htm', 'yaml', 'yml', 'toml', 'ini', 'log',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php',
  'sh', 'ps1', 'bat', 'sql', 'css', 'scss', 'vue', 'svelte', 'tex', 'srt', 'vtt'
]);

/** Largest file accepted from disk */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
/** Largest text kept from one upload */
export const MAX_UPLOAD_CHARS = 2_000_000;

export class UnsupportedFileError extends Error {}

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';

export function isPdf(f: { name: string; type: string }) {
  return f.type === 'application/pdf' || ext(f.name) === 'pdf';
}

export function isTextLike(f: { name: string; type: string }) {
  return f.type.startsWith('text/') || /^application\/(json|xml|x-yaml|javascript|x-sh)/.test(f.type) || TEXT_EXT.has(ext(f.name));
}

export interface Extracted {
  text: string;
  /** How the text was obtained (shown in the Files tab) */
  source?: string;
  truncated: boolean;
}

export async function extractText(file: File): Promise<Extracted> {
  if (file.size > MAX_UPLOAD_BYTES) throw new UnsupportedFileError(`ファイルが大きすぎます（上限 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB）。`);
  let text: string;
  let source: string | undefined;
  if (isPdf(file)) {
    text = await pdfToText(await file.arrayBuffer());
    source = 'PDF から抽出';
    if (!text.trim()) throw new UnsupportedFileError('この PDF からは文字を取り出せませんでした（画像だけの PDF の可能性があります）。');
  } else if (isTextLike(file)) {
    text = await file.text();
  } else {
    throw new UnsupportedFileError(`「${file.name}」の形式には対応していません。テキスト・Markdown・CSV・JSON・コード・PDF を添付できます。`);
  }
  const truncated = text.length > MAX_UPLOAD_CHARS;
  return { text: truncated ? text.slice(0, MAX_UPLOAD_CHARS) : text, source, truncated };
}

// ---- PDF ----
let workerPort: Worker | null = null;

/** pdf.js worker created through a Trusted Types policy that allows only the bundled worker URL */
function pdfWorker(url: string): Worker {
  if (workerPort) return workerPort;
  const tt = (globalThis as any).trustedTypes;
  const scriptUrl = tt?.createPolicy
    ? tt
        .createPolicy('app-pdf', {
          createScriptURL: (u: string) => {
            if (u !== url) throw new TypeError('許可されていない Worker URL');
            return u;
          }
        })
        .createScriptURL(url)
    : url;
  const w = new Worker(scriptUrl, { type: 'module' });
  // A worker that fails to load is dropped so the next attempt starts a fresh one
  w.addEventListener('error', () => {
    if (workerPort === w) workerPort = null;
  });
  workerPort = w;
  return w;
}

/** pdf.js can hang when its worker cannot start; give up after a while instead of waiting forever */
function pdfToText(data: ArrayBuffer): Promise<string> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      workerPort?.terminate();
      workerPort = null;
      reject(new UnsupportedFileError('PDF を読み込めませんでした（時間切れ）。'));
    }, 60_000);
  });
  return Promise.race([readPdf(data), timeout]).finally(() => clearTimeout(timer));
}

async function readPdf(data: ArrayBuffer): Promise<string> {
  const [pdfjs, { default: workerUrl }] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  const worker = pdfWorker(new URL(workerUrl, location.href).href);
  pdfjs.GlobalWorkerOptions.workerPort = worker;
  const failed = new Promise<never>((_, reject) =>
    worker.addEventListener('error', () => reject(new UnsupportedFileError('PDF を読む部品を起動できませんでした。')), { once: true })
  );
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    disableFontFace: true,
    useSystemFonts: false
  });
  failed.catch(() => {});
  const doc = await Promise.race([task.promise, failed]);
  try {
    const pages: string[] = [];
    let any = false;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let line = '';
      const lines: string[] = [];
      for (const item of tc.items as { str?: string; hasEOL?: boolean }[]) {
        if (typeof item.str !== 'string') continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = '';
        }
      }
      if (line) lines.push(line);
      const body = lines.join('\n').trim();
      if (body) any = true;
      pages.push(`--- ${i} ページ ---\n${body}`);
      page.cleanup();
    }
    return any ? pages.join('\n\n') : '';
  } finally {
    void task.destroy();
  }
}
