/**
 * What the graph pane draws, worked out from what `GET /api/graph` answers.
 *
 * Nothing here reads the query: the backend is the one parser of it. This is
 * the drawing's arithmetic, kept apart from the canvas so it can be tested
 * without one: which colour a type is, how big a note is drawn, and how a new
 * answer takes over the positions the last one had settled into.
 */

import type { components } from "@/lib/api-types";

export type GraphNode = components["schemas"]["GraphNode"];
export type GraphEdge = components["schemas"]["GraphEdge"];

/**
 * One note as the canvas holds it.
 *
 * The simulation writes `x`, `y` and the velocities onto the object itself,
 * which is why a redraw hands back the same object for a note it drew before:
 * a fresh one would start at the origin and the whole drawing would jump.
 */
export interface DrawnNode extends GraphNode {
  /** How many edges touch it in this drawing, which sets its size. */
  degree: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}

/**
 * One edge as the canvas holds it. The simulation swaps the two paths for the
 * node objects once it has read them, so either may be either.
 */
export interface DrawnLink {
  source: string | DrawnNode;
  target: string | DrawnNode;
  relation: string | null;
  line: number;
}

export interface Drawing {
  nodes: DrawnNode[];
  links: DrawnLink[];
}

/**
 * The colour of each type the ontology names, as a theme variable.
 *
 * The types in `99 Misc/01 Config/01 Agents/Ontology.md`, each on a tag slot of
 * the theme. Each slot takes the hue the type had under One Dark, so the graph
 * reads as it did; which tag gets which slot will come from config (#782), and
 * until then the type names the slot. A type the ontology does not name is
 * drawn like a plain note: the list is what somebody decided the vocabulary
 * is, and inventing a colour for a typo would dress it up.
 */
export const TYPE_COLOURS: Record<string, string> = {
  Concept: "--tg-4",
  Source: "--tg-8",
  Person: "--tg-2",
  Book: "--tg-5",
  Reference: "--tg-3",
  "Periodic Note": "--tg-none",
};

/** The variable a note is drawn in when its type has no colour of its own. */
export const PLAIN = "--tg-none";

/** The variable of the note's colour. */
export function colourOf(node: Pick<GraphNode, "type">): string {
  return (node.type !== null && TYPE_COLOURS[node.type]) || PLAIN;
}

/**
 * The colour of a note's first tag, as one of the ten tag slots.
 *
 * The palettes of #778 set `--tg-1` to `--tg-10`, so a tag takes a slot by its
 * hash rather than by its place in a list: the same tag keeps its colour across
 * notes and across palettes. Only the first tag counts, so a note's colour does
 * not change when a second tag is added. Lowercased, so `Rust` and `rust` match.
 */
export function tagColourOf(node: Pick<GraphNode, "tags">): string {
  const first = node.tags[0];
  if (first === undefined) return PLAIN;
  return `--tg-${1 + (fnv1a(first.toLowerCase()) % 10)}`;
}

/** A 32-bit FNV-1a hash, unsigned, so the same text hashes the same in every run. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * How big a note is drawn: a little bigger for every link, and less so the
 * more it has, so a daily note linking forty things is large without covering
 * the forty.
 */
export function radiusOf(degree: number): number {
  return 3 + Math.sqrt(degree) * 1.6;
}

/** The path an edge end names, before or after the simulation has read it. */
export function endOf(end: string | DrawnNode): string {
  return typeof end === "string" ? end : end.path;
}

/**
 * The answer, as objects the canvas can take, keeping every note it had.
 *
 * A note in both the last drawing and this one keeps its object, position and
 * all, so narrowing a filter takes notes away and moves nothing else. The
 * edges are new objects every time, the simulation reading them afresh.
 */
export function mergeDrawing(previous: Drawing, nodes: GraphNode[], edges: GraphEdge[]): Drawing {
  const held = new Map(previous.nodes.map((node) => [node.path, node]));
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  return {
    nodes: nodes.map((node) => {
      const kept = held.get(node.path);
      const drawn: DrawnNode = kept ?? { ...node, degree: 0 };
      Object.assign(drawn, node, { degree: degree.get(node.path) ?? 0 });
      return drawn;
    }),
    links: edges.map((edge) => ({ ...edge })),
  };
}

/** The note and every note one edge from it, which a hover lights up. */
export function neighbourhood(links: DrawnLink[], path: string): Set<string> {
  const near = new Set([path]);
  for (const link of links) {
    const source = endOf(link.source);
    const target = endOf(link.target);
    if (source === path) near.add(target);
    if (target === path) near.add(source);
  }
  return near;
}

/**
 * Whether a row's value is a note rather than a relation's name.
 *
 * A pattern's column holds one or the other, and a note is what a click
 * opens. A path ends in the suffix every note has; a relation's name cannot.
 */
export function isNotePath(value: string): boolean {
  return value.endsWith(".md");
}

/** Where a note sits in a radial drawing: its ring, and its place in unit radii. */
export interface RadialPoint {
  x: number;
  y: number;
  ring: number;
}

/** Codepoint order, so the layout is the same in every locale. */
function byPath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Each note's place in a radial drawing, in unit radii: the centre at the
 * origin and each ring one unit further out.
 *
 * A note's ring is its distance from the centre, edges counted either way
 * round. A ring's notes are spread evenly from the top and run clockwise on
 * screen, since y grows downwards. Ring 1 is ordered by path. A note further
 * out is ordered by the first note it links to on the ring in, so a second step
 * sits beside its parent. A note no edge reaches goes on the outermost ring.
 */
export function radialLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  center: string,
): Map<string, RadialPoint> {
  const known = new Set(nodes.map((node) => node.path));
  const adjacent = new Map<string, string[]>();
  for (const path of known) adjacent.set(path, []);
  for (const edge of edges) {
    if (edge.source === edge.target || !known.has(edge.source) || !known.has(edge.target)) continue;
    adjacent.get(edge.source)?.push(edge.target);
    adjacent.get(edge.target)?.push(edge.source);
  }

  const distance = new Map<string, number>();
  if (known.has(center)) {
    distance.set(center, 0);
    let frontier = [center];
    for (let step = 1; frontier.length > 0; step++) {
      const next: string[] = [];
      for (const path of frontier) {
        for (const other of adjacent.get(path) ?? []) {
          if (distance.has(other)) continue;
          distance.set(other, step);
          next.push(other);
        }
      }
      frontier = next;
    }
  }

  const rings: string[][] = [];
  for (const [path, step] of distance) {
    const ring = rings[step] ?? [];
    ring.push(path);
    rings[step] = ring;
  }

  // Each ring is ordered by the slot of its first neighbour on the ring in. The
  // ring in is already ordered, so its slots are set before this ring's are read.
  const slot = new Map<string, number>();
  rings.forEach((ring, step) => {
    if (step > 0) {
      const lead = (path: string) =>
        Math.min(
          ...(adjacent.get(path) ?? [])
            .filter((other) => distance.get(other) === step - 1)
            .map((other) => slot.get(other) ?? 0),
        );
      ring.sort((a, b) => lead(a) - lead(b) || byPath(a, b));
    }
    for (const [i, path] of ring.entries()) slot.set(path, i);
  });

  const unreached = nodes
    .map((node) => node.path)
    .filter((path) => !distance.has(path))
    .sort(byPath);
  const outer = Math.max(1, rings.length - 1);
  rings[outer] = [...(rings[outer] ?? []), ...unreached];

  const layout = new Map<string, RadialPoint>();
  rings.forEach((ring, step) => {
    ring.forEach((path, i) => {
      if (step === 0) {
        layout.set(path, { x: 0, y: 0, ring: 0 });
        return;
      }
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / ring.length;
      layout.set(path, { x: step * Math.cos(angle), y: step * Math.sin(angle), ring: step });
    });
  });
  return layout;
}
