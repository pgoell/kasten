/**
 * The drawing's arithmetic, apart from the canvas it is drawn on.
 *
 * What matters most is `mergeDrawing` keeping a note's object across two
 * answers: the simulation writes the position onto it, and a new object would
 * send the note back to the origin every time the filter narrowed.
 */

import {
  colourOf,
  type DrawnNode,
  isNotePath,
  mergeDrawing,
  neighbourhood,
  PLAIN,
  radiusOf,
} from "@/lib/graph";

function note(path: string, type: string | null = "Note") {
  return { path, name: path.replace(/\.md$/, ""), type, tags: [], missing: false };
}

function edge(source: string, target: string, relation: string | null = null) {
  return { source, target, relation, line: 1 };
}

describe("colourOf", () => {
  it("colours a type the ontology names", () => {
    expect(colourOf({ type: "Concept" })).toBe("--color-one-purple");
  });

  it("draws an unknown type and no type as a plain note", () => {
    expect(colourOf({ type: "Invented" })).toBe(PLAIN);
    expect(colourOf({ type: null })).toBe(PLAIN);
  });
});

describe("radiusOf", () => {
  it("grows with the links, slower the more there are", () => {
    expect(radiusOf(4)).toBeGreaterThan(radiusOf(1));
    expect(radiusOf(4) - radiusOf(1)).toBeGreaterThan(radiusOf(40) - radiusOf(37));
  });
});

describe("mergeDrawing", () => {
  it("keeps the object, and so the position, of a note drawn before", () => {
    const first = mergeDrawing({ nodes: [], links: [] }, [note("a.md"), note("b.md")], []);
    const a = first.nodes[0] as DrawnNode;
    a.x = 40;
    a.y = -7;

    const second = mergeDrawing(first, [note("a.md", "Concept")], [edge("a.md", "a.md")]);

    expect(second.nodes).toHaveLength(1);
    expect(second.nodes[0]).toBe(a);
    expect(second.nodes[0]).toMatchObject({ x: 40, y: -7, type: "Concept" });
  });

  it("counts each note's edges", () => {
    const drawing = mergeDrawing(
      { nodes: [], links: [] },
      [note("a.md"), note("b.md"), note("c.md")],
      [edge("a.md", "b.md"), edge("c.md", "b.md", "supports")],
    );

    expect(drawing.nodes.map((n) => n.degree)).toEqual([1, 2, 1]);
  });
});

describe("neighbourhood", () => {
  it("is the note and every note one edge from it, either way round", () => {
    const links = [edge("a.md", "b.md"), edge("c.md", "a.md"), edge("c.md", "d.md")];

    expect(neighbourhood(links, "a.md")).toEqual(new Set(["a.md", "b.md", "c.md"]));
  });
});

describe("isNotePath", () => {
  it("tells a note from a relation's name", () => {
    expect(isNotePath("ideas/rag.md")).toBe(true);
    expect(isNotePath("depends-on")).toBe(false);
  });
});
