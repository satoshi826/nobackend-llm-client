// Conversation tree utilities (independent of UI and DB)
export interface TreeNode {
  id: string;
  parentId: string | null;
  createdAt: number;
}

/** Path from leaf to root (root first) */
export function pathToLeaf<T extends TreeNode>(byId: Map<string, T>, leafId: string | null): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  let cur = leafId ? byId.get(leafId) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out.reverse();
}

export function childrenOf<T extends TreeNode>(all: Iterable<T>, parentId: string | null): T[] {
  const out: T[] = [];
  for (const m of all) if (m.parentId === parentId) out.push(m);
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * The children of `parentId`, moved under `nodeId` (the records to save): puts a new node between a message and every
 * branch below it, so the node is on all their paths. `all` must not hold the new node yet
 */
export function moveChildren<T extends TreeNode>(all: T[], parentId: string | null, nodeId: string): T[] {
  return childrenOf(all, parentId).map((m) => ({ ...m, parentId: nodeId }));
}

/** The leaf reached from a node by always following the newest child */
export function deepestLatestLeaf<T extends TreeNode>(all: T[], startId: string): string {
  let cur = startId;
  const seen = new Set<string>();
  while (!seen.has(cur)) {
    seen.add(cur);
    const kids = childrenOf(all, cur);
    if (kids.length === 0) return cur;
    cur = kids[kids.length - 1].id;
  }
  return cur;
}

/**
 * The leaf to show for a conversation. If the saved leaf no longer exists (e.g. the tab was closed
 * after the leaf was switched to a new reply but before that reply was written), fall back to the
 * newest message and follow its newest children.
 */
export function resolveLeaf<T extends TreeNode>(all: T[], leafId: string | null): string | null {
  if (leafId && all.some((m) => m.id === leafId)) return leafId;
  if (all.length === 0) return null;
  const newest = all.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return deepestLatestLeaf(all, newest.id);
}
