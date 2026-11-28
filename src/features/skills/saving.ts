// The question a run of run_skill_script asks on its card once the script ended: which of the files it wrote to save
// in the working folder. Asked every time it wrote any; nothing is saved without an answer
import { signal } from '@preact/signals';
import type { ScriptOutputFile, ScriptPrinted } from './tools';

export interface SaveQuestion {
  files: ScriptOutputFile[];
  /** What the run printed, shown while the user decides */
  printed: ScriptPrinted;
  /** The paths to save, or null for none */
  answer(paths: string[] | null): void;
}

/** Questions waiting for the user, by tool call */
export const saveQuestions = signal<Record<string, SaveQuestion>>({});

/** Ask on the card of `toolCallId`; a stop (the signal) answers null */
export function askToSave(toolCallId: string, files: ScriptOutputFile[], printed: ScriptPrinted, signal: AbortSignal): Promise<string[] | null> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(null);
    const answer = (paths: string[] | null) => {
      const { [toolCallId]: _, ...rest } = saveQuestions.value;
      saveQuestions.value = rest;
      signal.removeEventListener('abort', stop);
      resolve(paths);
    };
    const stop = () => answer(null);
    signal.addEventListener('abort', stop, { once: true });
    saveQuestions.value = { ...saveQuestions.value, [toolCallId]: { files, printed, answer } };
  });
}
