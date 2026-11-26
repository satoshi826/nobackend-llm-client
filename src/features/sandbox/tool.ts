// run_javascript: lets a chat model run JavaScript in the sandbox (sandbox/sandbox.html) and read what it printed.
// No network, no DOM, no access to the app or the user's files: whatever the code needs is written into it.
import type { Tool } from '../../lib/tools/types';
import { runJavaScript, runText } from '../../lib/sandbox/client';
import { t } from './messages';

export const RUN_JAVASCRIPT = 'run_javascript';
const TIMEOUT_MS = 10_000;
/** Characters of output given back to the model */
const MAX_OUTPUT = 20_000;

export const runJavaScriptTool: Tool<{ code: string }> = {
  name: RUN_JAVASCRIPT,
  get label() {
    return t('tool.label');
  },
  description: `Run JavaScript in an isolated sandbox and get back what it printed with console.log and the value it returned. Use it for exact arithmetic, statistics, date math, or processing data you already have in the conversation (e.g. parsing CSV text), rather than doing it in your head. The code runs as the body of an async function in a Web Worker: use \`return\` for the result and \`await\` freely. There is no network, no DOM and no access to the user's files or this app, so put any data the code needs into the code itself. It is stopped after ${TIMEOUT_MS / 1000} seconds.`,
  parameters: {
    type: 'object',
    properties: { code: { type: 'string', description: 'The JavaScript to run, as the body of an async function (end with `return value` to get a result back).' } },
    required: ['code']
  },
  risk: 'exec',
  summarize: (i) => i.code.split('\n').find((l) => l.trim()) ?? '',
  prepare(raw) {
    const code = typeof (raw as { code?: unknown })?.code === 'string' ? (raw as { code: string }).code : '';
    if (!code.trim()) throw new Error(t('tool.noCode'));
    return { code };
  },
  async execute(i) {
    const r = await runJavaScript(i.code, TIMEOUT_MS);
    const text = runText(r) || '(no output)';
    return {
      content: text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n[output cut at ${MAX_OUTPUT} characters]` : text,
      isError: !!r.error,
      details: { output: text.slice(0, MAX_OUTPUT), failed: !!r.error }
    };
  }
};
