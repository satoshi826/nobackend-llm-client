// Saved system prompts (the system prompt dialog keeps a list to pick from)
import * as repo from '../lib/db/repo';
import type { SavedPrompt } from '../lib/db/schema';

/** The saved prompts, most recently changed first */
export const listSavedPrompts = (): Promise<SavedPrompt[]> => repo.listPrompts();

/** Save a prompt under a name, and return it */
export async function savePrompt(name: string, content: string): Promise<SavedPrompt> {
  const p = { id: repo.newId(), name, content, updatedAt: Date.now() };
  await repo.putPrompt(p);
  return p;
}

export const deleteSavedPrompt = (id: string): Promise<void> => repo.deletePrompt(id);
