// run_javascript: lets a chat model run JavaScript in the sandbox (sandbox/sandbox.html) and read what it printed.
// No network and no access to the app; files of the conversation can be handed in, read-only.
import type { Tool } from '../../lib/tools/types';
import { RUN_TIMEOUT_MS, runJavaScript, runText } from '../../lib/sandbox/client';
import { t } from './messages';

export const RUN_JAVASCRIPT = 'run_javascript';
/** Characters of output given back to the model */
const MAX_OUTPUT = 20_000;

export interface RunInput {
  code: string;
  file_ids: string[];
  dom: boolean;
}

/** A file of the conversation by id (undefined when it is not one), as the files feature gives it */
export type FileReader = (id: string) => Promise<{ name: string; text: string } | undefined>;

export function makeRunJavaScriptTool(readFile: FileReader): Tool<RunInput> {
  return {
    name: RUN_JAVASCRIPT,
    get label() {
      return t('tool.label');
    },
    description: `Run JavaScript in an isolated sandbox and get back what it printed with console.log and the value it returned. Use it for exact arithmetic, statistics, date math, or processing data rather than doing it in your head, and to try code on a file of this conversation (e.g. a scraper on an HTML page saved with fetch_file). The code runs as the body of an async function: use \`return\` for the result and \`await\` freely. Files given in file_ids are readable as \`files\` ({ "name": text }); set dom to true when the code needs DOMParser (to parse HTML). There is no network and no access to the user's other files or this app, so put any other data the code needs into the code itself. It is stopped after ${RUN_TIMEOUT_MS / 1000} seconds.`,
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The JavaScript to run, as the body of an async function (end with `return value` to get a result back).' },
        file_ids: { type: 'array', items: { type: 'string' }, description: 'Optional. Ids of files of this conversation to read as `files` (from the files list in the system prompt, or create_file / fetch_file results).' },
        dom: { type: 'boolean', description: 'Optional. true to have DOMParser and document (for parsing HTML); default false.' }
      },
      required: ['code']
    },
    risk: 'exec',
    summarize: (i) => i.code.split('\n').find((l) => l.trim()) ?? '',
    prepare(raw) {
      const r = (raw ?? {}) as { code?: unknown; file_ids?: unknown; dom?: unknown };
      const code = typeof r.code === 'string' ? r.code : '';
      if (!code.trim()) throw new Error(t('tool.noCode'));
      const file_ids = Array.isArray(r.file_ids) ? r.file_ids.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 10) : [];
      return { code, file_ids, dom: r.dom === true };
    },
    async execute(i) {
      const files: Record<string, string> = {};
      for (const id of i.file_ids) {
        const f = await readFile(id);
        if (!f) return { content: `No file with id ${id} in this conversation.`, isError: true, details: { output: '', failed: true } };
        files[f.name] = f.text;
      }
      const r = await runJavaScript(i.code, { files, dom: i.dom });
      const text = runText(r) || '(no output)';
      return {
        content: text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n[output cut at ${MAX_OUTPUT} characters]` : text,
        isError: !!r.error,
        details: { output: text.slice(0, MAX_OUTPUT), failed: !!r.error }
      };
    }
  };
}
