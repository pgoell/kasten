import type { GraphEdge, GraphNode } from "@/lib/graph/graph";
import { tagCounts, withoutTags } from "@/lib/graph/graph-tags";

function note(path: string, tags: string[]): GraphNode {
  return { path, name: path.replace(/\.md$/, ""), type: null, tags, missing: false };
}

describe("graph tags", () => {
  it("A4 tagCounts counts each note once per tag, first spelling, by count then key", () => {
    const counts = tagCounts([
      note("a.md", ["Rust", "rust", "async"]),
      note("b.md", ["async"]),
      note("c.md", ["Zed"]),
      note("d.md", ["bee"]),
    ]);

    expect(counts).toEqual([
      { tag: "async", key: "async", count: 2 },
      { tag: "bee", key: "bee", count: 1 },
      { tag: "Rust", key: "rust", count: 1 },
      { tag: "Zed", key: "zed", count: 1 },
    ]);
  });

  it("I4 withoutTags drops a note whose every tag is hidden with its links, keeps a shown tag first, and leaves the answer alone", () => {
    const rust = note("rust.md", ["async", "Rust"]);
    const log = note("log.md", ["ASYNC"]);
    const plain = note("plain.md", []);
    const nodes = [rust, log, plain];
    const edges: GraphEdge[] = [
      { source: "rust.md", target: "log.md", relation: null, line: 1 },
      { source: "log.md", target: "plain.md", relation: null, line: 2 },
      { source: "rust.md", target: "plain.md", relation: null, line: 3 },
    ];

    const drawn = withoutTags(nodes, edges, new Set(["async"]));

    expect(drawn.nodes).toEqual([{ ...rust, tags: ["Rust"] }, plain]);
    expect(drawn.edges).toEqual([edges[2]]);
    expect(rust.tags).toEqual(["async", "Rust"]);
    expect(log.tags).toEqual(["ASYNC"]);
  });
});
