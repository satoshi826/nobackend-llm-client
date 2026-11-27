// What the usage tab reads: the usage records the app keeps for each request (written in state/request-helpers.ts)
import * as repo from '../../lib/db/repo';
import type { UsageRecord } from '../../lib/usage';

/** Records since a time (all with null), oldest first */
export const listUsage = (since: number | null): Promise<UsageRecord[]> => repo.listUsage(since);

export const clearUsage = (): Promise<void> => repo.clearUsage();
