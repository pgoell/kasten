/**
 * The clusters' arithmetic, with no canvas: places, spots, anchors, the seed
 * positions and the forces. None of it exists on main, so these cannot run there.
 */

import type { DrawnLink, DrawnNode, GraphNode } from "@/lib/graph/graph";
import { tagVariable } from "@/lib/graph/graph";
import {
  ANCHOR,
  ATTRACT,
  anchorOf,
  clusterForces,
  GRAVITY,
  K,
  placeOf,
  type Spot,
  seedPositions,
  spotsOf,
} from "@/lib/graph/graph-clusters";

/** A note as the vault's graph answers it, with the tags as written. */
function note(path: string, tags: string[] = []): GraphNode {
  return { path, name: path.replace(/\.md$/, ""), type: null, tags, missing: false };
}

/** A note the canvas holds: no position yet, no links. */
function drawn(path: string, tags: string[] = []): DrawnNode {
  return { ...note(path, tags), degree: 0 };
}

function spotMap(spots: Spot[]): Map<string, Spot> {
  return new Map(spots.map((spot) => [spot.key, spot]));
}

describe("placeOf", () => {
  it("A1 placeOf takes the top folder, and a project's own folder under a Projects folder", () => {
    expect(placeOf("03 Areas/08 People/x.md")).toBe("03 Areas");
    expect(placeOf("02 Projects/Terraform/x.md")).toBe("02 Projects/Terraform");
    expect(placeOf("02 Projects/Terraform/deep/x.md")).toBe("02 Projects/Terraform");
    expect(placeOf("projects/Kasten/x.md")).toBe("projects/Kasten");
    expect(placeOf("02 Projects/x.md")).toBe("02 Projects");
  });

  it("A1 placeOf leaves notes at the vault root and unwritten notes without a place", () => {
    expect(placeOf("Loose.md")).toBeNull();
    expect(spotsOf([note("Loose.md"), note("Unwritten.md", ["#ai"])], "folders")).toEqual([]);
    expect(anchorOf(note("Loose.md"), "folders", new Map())).toBeNull();
  });
});

describe("spotsOf", () => {
  const vault = [
    note("03 Areas/a.md"),
    note("02 Projects/Terraform/b.md"),
    note("03 Areas/c.md"),
    note("01 Inbox/d.md"),
  ];

  it("A1 spotsOf gives each top folder one spot, biggest first, the same every time", () => {
    const spots = spotsOf(vault, "folders");

    expect(spots.map((spot) => [spot.key, spot.name, spot.size, spot.variable])).toEqual([
      ["03 Areas", "03 Areas", 2, "--k-accent"],
      ["01 Inbox", "01 Inbox", 1, "--k-accent"],
      ["02 Projects/Terraform", "Terraform", 1, "--k-accent"],
    ]);
    // Biggest at the middle, the rest on a spiral whose gap grows with the largest.
    expect(spots[0]).toMatchObject({ x: 0, y: 0 });
    expect(Math.hypot(spots[1]?.x ?? 0, spots[1]?.y ?? 0)).toBeCloseTo(70 + 14 * Math.sqrt(2));
    expect(spotsOf([...vault].reverse(), "folders")).toEqual(spots);
    expect(spotsOf(vault, "folders")).toEqual(spots);
  });

  it("A2 spotsOf in Tags mode counts a note towards every tag it carries", () => {
    const tagged = [
      note("a.md", ["#ai", "#rust"]),
      note("b.md", ["#ai"]),
      note("c.md", ["#Rust", "#rust"]),
    ];
    const spots = spotsOf(tagged, "tags");

    expect(spots.map((spot) => [spot.key, spot.name, spot.size, spot.variable])).toEqual([
      ["#ai", "#ai", 2, tagVariable("#ai")],
      ["#rust", "#rust", 2, tagVariable("#rust")],
    ]);
  });
});

describe("anchorOf", () => {
  it("A2 anchorOf puts a note with two tags between their two spots", () => {
    const tagged = [note("a.md", ["#ai"]), note("b.md", ["#rust"]), note("c.md", ["#ai", "#rust"])];
    const spots = spotMap(spotsOf(tagged, "tags"));
    const ai = spots.get("#ai");
    const rust = spots.get("#rust");

    const at = anchorOf(tagged[2] as GraphNode, "tags", spots);
    expect(at?.x).toBeCloseTo(((ai?.x ?? 0) + (rust?.x ?? 0)) / 2);
    expect(at?.y).toBeCloseTo(((ai?.y ?? 0) + (rust?.y ?? 0)) / 2);
  });
});

describe("seedPositions", () => {
  it("A7 seedPositions gives the same start to the same notes, no two on one point", () => {
    const paths = ["03 Areas/a.md", "03 Areas/b.md", "03 Areas/c.md", "Loose.md", "Loose2.md"];
    const seed = () => {
      const nodes = paths.map((path) => drawn(path));
      seedPositions(nodes, "folders", spotMap(spotsOf(nodes, "folders")));
      return nodes.map((node) => `${node.x},${node.y}`);
    };

    const first = seed();
    expect(seed()).toEqual(first);
    expect(new Set(first).size).toBe(paths.length);
  });
});

describe("clusterForces", () => {
  it("A7 the anchor and gravity forces pull a note toward its spot and the middle", () => {
    const spots = spotMap([
      { key: "03 Areas", name: "03 Areas", variable: "--k-accent", x: 100, y: 0, size: 1 },
    ]);
    const forces = clusterForces("folders", spots);

    const inArea = drawn("03 Areas/a.md");
    Object.assign(inArea, { x: 0, y: 0, vx: 0, vy: 0 });
    forces.anchor.initialize([inArea]);
    forces.anchor(1);
    expect(inArea.vx).toBeCloseTo(100 * ANCHOR);
    expect(inArea.vy).toBeCloseTo(0);

    const loose = drawn("Loose.md");
    Object.assign(loose, { x: 200, y: 0, vx: 0, vy: 0 });
    forces.gravity.initialize([loose]);
    forces.gravity(1);
    expect(loose.vx).toBeCloseTo(-200 * GRAVITY);
    expect(loose.vy).toBeCloseTo(0);
  });

  it("A7 the attraction pulls the two ends of a link together, more the farther apart", () => {
    const pulled = (distance: number) => {
      const source = drawn("a.md");
      const target = drawn("b.md");
      Object.assign(source, { x: 0, y: 0, vx: 0, vy: 0 });
      Object.assign(target, { x: distance, y: 0, vx: 0, vy: 0 });
      const forces = clusterForces("folders", new Map());
      forces.attract.initialize([source, target]);
      forces.attract.links([{ source, target, relation: null, line: 1 } as DrawnLink]);
      forces.attract(1);
      return { source: source.vx ?? 0, target: target.vx ?? 0 };
    };

    const near = pulled(30);
    const far = pulled(90);
    expect(near.source).toBeCloseTo((30 * ATTRACT) / K);
    expect(near.source).toBeGreaterThan(0);
    expect(near.target).toBeCloseTo(-near.source);
    expect(far.source).toBeGreaterThan(near.source);
  });
});
