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
 * The types in `99 Misc/01 Config/01 Agents/Ontology.md`, each on a colour of
 * the One Dark palette the rest of the app is drawn in. A type the ontology
 * does not name is drawn like a plain note: the list is what somebody decided
 * the vocabulary is, and inventing a colour for a typo would dress it up.
 */
export const TYPE_COLOURS: Record<string, string> = {
  Concept: "--color-one-purple",
  Source: "--color-one-orange",
  Person: "--color-one-green",
  Book: "--color-one-yellow",
  Reference: "--color-one-accent",
  "Periodic Note": "--color-one-muted",
};

/** The variable a note is drawn in when its type has no colour of its own. */
export const PLAIN = "--color-one-fg";

/** The variable of the note's colour. */
export function colourOf(node: Pick<GraphNode, "type">): string {
  return (node.type !== null && TYPE_COLOURS[node.type]) || PLAIN;
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
