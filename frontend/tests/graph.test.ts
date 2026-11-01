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
  radialLayout,
  radiusOf,
  tagColourOf,
} from "@/lib/graph/graph";

function note(path: string, type: string | null = "Note") {
  return { path, name: path.replace(/\.md$/, ""), type, tags: [], missing: false };
}

function edge(source: string, target: string, relation: string | null = null) {
  return { source, target, relation, line: 1 };
}

describe("colourOf", () => {
  it("colours a type the ontology names", () => {
    expect(colourOf({ type: "Concept" })).toBe("--tg-4");
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

describe("tagColourOf", () => {
  it("A3 tagColourOf gives --tg-none to a note with no tag and one of --tg-1 to --tg-10 by the first tag", () => {
    expect(tagColourOf({ tags: [] })).toBe("--tg-none");
    expect(tagColourOf({ tags: ["rust"] })).toMatch(/^--tg-([1-9]|10)$/);
  });

  it("A3 tagColourOf gives one tag the same colour every time and reads only the first tag", () => {
    const first = tagColourOf({ tags: ["Rust"] });

    expect(tagColourOf({ tags: ["Rust"] })).toBe(first);
    expect(tagColourOf({ tags: ["rust"] })).toBe(first);
    expect(tagColourOf({ tags: ["Rust", "Go"] })).toBe(first);
  });
});

describe("radialLayout", () => {
  it("A1 radialLayout puts the note in the middle, its direct links on ring 1 and the second step on ring 2", () => {
    const nodes = ["a.md", "b.md", "c.md", "d.md"].map((path) => note(path));
    const layout = radialLayout(
      nodes,
      [edge("a.md", "b.md"), edge("a.md", "c.md"), edge("b.md", "d.md")],
      "a.md",
    );
    const b = layout.get("b.md");
    const d = layout.get("d.md");

    expect(layout.get("a.md")).toEqual({ x: 0, y: 0, ring: 0 });
    expect(layout.get("c.md")?.ring).toBe(1);
    expect(b).toMatchObject({ ring: 1 });
    expect(d).toMatchObject({ ring: 2 });
    // The second step sits straight out from its parent, on the same spoke.
    expect(d?.x).toBeCloseTo(2 * (b?.x ?? NaN));
    expect(d?.y).toBeCloseTo(2 * (b?.y ?? NaN));
  });

  it("A1 radialLayout puts a second step beside the note it hangs from", () => {
    // Two ring-one notes, each with two notes of its own: a ring-one sector is half the circle.
    const nodes = ["a.md", "p.md", "q.md", "p1.md", "p2.md", "q1.md", "q2.md"].map((path) =>
      note(path),
    );
    const layout = radialLayout(
      nodes,
      [
        edge("a.md", "p.md"),
        edge("a.md", "q.md"),
        edge("p.md", "p1.md"),
        edge("p.md", "p2.md"),
        edge("q.md", "q1.md"),
        edge("q.md", "q2.md"),
      ],
      "a.md",
    );
    const angle = (path: string) => {
      const point = layout.get(path);
      return Math.atan2(point?.y ?? NaN, point?.x ?? NaN);
    };
    const sector = Math.PI;

    for (const [parent, first, second] of [
      ["p.md", "p1.md", "p2.md"],
      ["q.md", "q1.md", "q2.md"],
    ] as const) {
      expect(Math.abs(angle(first) - angle(parent))).toBeLessThanOrEqual(sector / 2);
      expect(Math.abs(angle(second) - angle(parent))).toBeLessThanOrEqual(sector / 2);
      // Path order: one child on each side of the parent.
      expect(angle(first)).toBeLessThan(angle(parent));
      expect(angle(second)).toBeGreaterThan(angle(parent));
    }
  });

  it("A1 radialLayout spaces a ring evenly from the top", () => {
    const nodes = ["a.md", "b.md", "c.md", "d.md", "e.md"].map((path) => note(path));
    const layout = radialLayout(
      nodes,
      [edge("a.md", "b.md"), edge("a.md", "c.md"), edge("a.md", "d.md"), edge("a.md", "e.md")],
      "a.md",
    );

    // Clockwise on screen from the top: b, c, d, e by path.
    const spots = ["b.md", "c.md", "d.md", "e.md"].map((path) => {
      const point = layout.get(path);
      return [point?.x ?? NaN, point?.y ?? NaN];
    });
    expect(spots[0]?.[0]).toBeCloseTo(0);
    expect(spots[0]?.[1]).toBeCloseTo(-1);
    expect(spots[1]?.[0]).toBeCloseTo(1);
    expect(spots[1]?.[1]).toBeCloseTo(0);
    expect(spots[2]?.[0]).toBeCloseTo(0);
    expect(spots[2]?.[1]).toBeCloseTo(1);
    expect(spots[3]?.[0]).toBeCloseTo(-1);
    expect(spots[3]?.[1]).toBeCloseTo(0);
  });

  it("I2 radialLayout places rings past the second, fanned siblings and the notes no edge reaches, the same every time", () => {
    const paths = ["a", "b", "c", "d", "e", "f", "g", "h", "x", "y"].map((name) => `${name}.md`);
    const edges = [
      edge("a.md", "b.md"),
      edge("c.md", "a.md"),
      edge("b.md", "d.md"),
      edge("b.md", "e.md"),
      edge("c.md", "f.md"),
      edge("e.md", "f.md"),
      edge("f.md", "g.md"),
      edge("d.md", "h.md"),
      edge("h.md", "h.md"),
      edge("h.md", "gone.md"),
    ];
    const spots = (center: string, drawn = edges) =>
      [
        ...radialLayout(
          paths.map((path) => note(path)),
          drawn,
          center,
        ),
      ].map(([path, { x, y, ring }]) => `${path} ${ring} ${x.toFixed(3)} ${y.toFixed(3)}`);

    expect(spots("a.md")).toEqual([
      "a.md 0 0.000 0.000",
      "b.md 1 0.000 -1.000",
      "c.md 1 0.000 1.000",
      "d.md 2 -1.414 -1.414",
      "e.md 2 1.414 -1.414",
      "f.md 2 0.000 2.000",
      "h.md 3 -2.121 -2.121",
      "g.md 3 0.000 3.000",
      "x.md 3 0.000 -3.000",
      "y.md 3 0.000 3.000",
    ]);
    expect(spots("a.md", [edge("a.md", "b.md")])).toEqual([
      "a.md 0 0.000 0.000",
      "b.md 1 0.000 -1.000",
      "c.md 1 0.643 -0.766",
      "d.md 1 0.985 -0.174",
      "e.md 1 0.866 0.500",
      "f.md 1 0.342 0.940",
      "g.md 1 -0.342 0.940",
      "h.md 1 -0.866 0.500",
      "x.md 1 -0.985 -0.174",
      "y.md 1 -0.643 -0.766",
    ]);
    expect(spots("nowhere.md")).toEqual([
      "a.md 1 0.000 -1.000",
      "b.md 1 0.588 -0.809",
      "c.md 1 0.951 -0.309",
      "d.md 1 0.951 0.309",
      "e.md 1 0.588 0.809",
      "f.md 1 0.000 1.000",
      "g.md 1 -0.588 0.809",
      "h.md 1 -0.951 0.309",
      "x.md 1 -0.951 -0.309",
      "y.md 1 -0.588 -0.809",
    ]);
  });
});
