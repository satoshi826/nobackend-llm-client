// 会話ツリーのユーティリティ（UI・DB 非依存）
export interface TreeNode {
  id: string;
  parentId: string | null;
  createdAt: number;
}

/** leaf から root までの経路（root が先頭） */
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

/** あるノードから、最新の子を辿り続けた末端 */
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

export function siblingsOf<T extends TreeNode>(all: T[], node: T): T[] {
  return childrenOf(all, node.parentId);
}
