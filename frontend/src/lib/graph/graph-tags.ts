/**
 * The tags of a graph answer, counted for the tag list, and the answer with hidden tags removed for the canvas.
 * Tags match by lowercased key, so `Rust` and `rust` are one tag.
 */

import type { GraphEdge, GraphNode } from "@/lib/graph/graph";

export interface TagCount {
  /** The tag as first spelled in the answer. */
  tag: string;
  /** The tag lowercased, which is what is counted and hidden by. */
  key: string;
  /** How many notes of the answer carry it. */
  count: number;
}

/** Each tag of the answer with its count, the most used first and then by key. */
export function tagCounts(nodes: GraphNode[]): TagCount[] {
  const found = new Map<string, TagCount>();
  for (const node of nodes) {
    // A note that writes a tag twice still counts once for it.
    const seen = new Set<string>();
    for (const tag of node.tags) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = found.get(key);
      if (entry) entry.count += 1;
      else found.set(key, { tag, key, count: 1 });
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
}

/**
 * The answer as the canvas should draw it, hidden tags gone. A note with tags and none shown leaves,
 * with its links. Shown tags keep their order, so the first one fills the dot.
 */
export function withoutTags(
  nodes: GraphNode[],
  edges: GraphEdge[],
  hidden: Set<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const left: GraphNode[] = [];
  const gone = new Set<string>();
  for (const node of nodes) {
    const tags = node.tags.filter((tag) => !hidden.has(tag.toLowerCase()));
    if (tags.length === 0 && node.tags.length > 0) gone.add(node.path);
    else left.push({ ...node, tags });
  }
  return {
    nodes: left,
    edges: edges.filter((edge) => !gone.has(edge.source) && !gone.has(edge.target)),
  };
}
