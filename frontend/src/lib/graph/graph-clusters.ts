/**
 * The vault graph's clusters, worked out without a canvas: which place or tag
 * each note belongs to, where each cluster's spot is, and the forces that pull
 * the notes to them. The canvas draws what this says and runs the forces.
 *
 * Folders mode gives each top folder a spot, a project's own folder under a
 * `…Projects` folder one of its own. Tags mode gives each tag a spot, and a note
 * counts towards every tag it carries.
 */

import type { DrawnLink, DrawnNode, GraphNode } from "@/lib/graph/graph";
import { tagVariable } from "@/lib/graph/graph";
import type { GraphMode } from "@/lib/graph/graph-mode";

/** Each force's strength, the same numbers the canvas and the tests use. */
export const K = 30;
export const ATTRACT = 0.06;
export const ANCHOR = 0.1;
/**
 * Tags mode pulls harder to the spots and lets links pull less: a link-heavy vault
 * otherwise pulls every tag's notes to one hairball, and no note sits between its tags.
 */
export const TAGS_ANCHOR = 0.3;
export const TAGS_ATTRACT = 0.02;
export const GRAVITY = 0.015;
export const CHARGE = -60;
/** Repulsion stops past this many graph units, so far clusters do not push each other. */
export const CHARGE_REACH = 400;

/** The gap between spot rings, before the largest cluster adds to it. */
const SPACING = 70;

/** The gap between two neighbouring spots, which grows with the largest cluster. */
export function gapOf(spots: Iterable<{ size: number }>): number {
  let largest = 0;
  for (const spot of spots) largest = Math.max(largest, spot.size);
  return SPACING + 14 * Math.sqrt(largest);
}
/** The golden angle in radians, so spots and seeds fan out without lining up. */
const GOLDEN = 2.399963;

/** A cluster's spot: where its notes are pulled, and how it is drawn. */
export interface Spot {
  key: string;
  name: string;
  variable: string;
  x: number;
  y: number;
  size: number;
}

export interface ClusterForce {
  (alpha: number): void;
  initialize(nodes: DrawnNode[]): void;
}

export interface ClusterForces {
  attract: ClusterForce & { links(links: DrawnLink[]): void };
  anchor: ClusterForce;
  gravity: ClusterForce;
}

/** Codepoint order, so the spots are the same in every locale. */
function byKey(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function lastSegment(place: string): string {
  return place.slice(place.lastIndexOf("/") + 1);
}

/**
 * The place a note belongs to: its top folder, or under a `…Projects` folder
 * the project folder below it. A note at the vault root has no place.
 */
export function placeOf(path: string): string | null {
  const parts = path.split("/");
  if (parts.length < 2) return null;
  const [top, child] = parts;
  if (top?.toLowerCase().endsWith("projects") && parts.length > 2) return `${top}/${child}`;
  return top ?? null;
}

/**
 * The (key, name) pairs a note is counted under: its place in Folders mode, and
 * each of its tags in Tags mode. A tag written twice in one note counts once.
 */
function placesOf(node: GraphNode, mode: GraphMode): Array<[string, string]> {
  if (mode === "folders") {
    const place = placeOf(node.path);
    return place === null ? [] : [[place, lastSegment(place)]];
  }
  const seen = new Map<string, string>();
  for (const tag of node.tags) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) seen.set(key, tag);
  }
  return [...seen];
}

/** The notes of each cluster, keyed by the cluster's key, named as the cluster is shown. */
export function groupsOf<N extends GraphNode>(
  nodes: N[],
  mode: GraphMode,
): Map<string, { name: string; members: N[] }> {
  const groups = new Map<string, { name: string; members: N[] }>();
  for (const node of nodes) {
    for (const [key, name] of placesOf(node, mode)) {
      const group = groups.get(key) ?? { name, members: [] };
      group.members.push(node);
      groups.set(key, group);
    }
  }
  return groups;
}

/**
 * One spot per cluster, the biggest first, on a golden-angle spiral. The same
 * notes give the same spots in the same places, whatever order they came in.
 */
export function spotsOf(nodes: GraphNode[], mode: GraphMode): Spot[] {
  const ranked = [...groupsOf(nodes, mode)]
    .map(([key, group]) => ({ key, name: group.name, size: group.members.length }))
    .sort((a, b) => b.size - a.size || byKey(a.key, b.key));
  const spacing = gapOf(ranked);

  return ranked.map((spot, i) => {
    const radius = spacing * Math.sqrt(i);
    const angle = i * GOLDEN;
    return {
      key: spot.key,
      name: spot.name,
      variable: mode === "folders" ? "--k-accent" : tagVariable(spot.name),
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
      size: spot.size,
    };
  });
}

/**
 * Where a note is pulled to: its place's spot, or in Tags mode the mean of its
 * tags' spots, so a note with two tags sits between their areas.
 */
export function anchorOf(
  node: GraphNode,
  mode: GraphMode,
  spots: Map<string, Spot>,
): { x: number; y: number } | null {
  const found = placesOf(node, mode)
    .map(([key]) => spots.get(key))
    .filter((spot): spot is Spot => spot !== undefined);
  if (found.length === 0) return null;
  return {
    x: found.reduce((sum, spot) => sum + spot.x, 0) / found.length,
    y: found.reduce((sum, spot) => sum + spot.y, 0) / found.length,
  };
}

/**
 * A start position for every note that has none: round its spot in a small
 * spiral, the j-th note of a spot a little further out, and a note with no
 * spot on a ring just outside the farthest spot. The spiral is by spot, so no
 * two notes share a point, and a fresh canvas starts every note in the same
 * place.
 */
export function seedPositions(nodes: DrawnNode[], mode: GraphMode, spots: Map<string, Spot>): void {
  let farthest = 0;
  for (const spot of spots.values()) farthest = Math.max(farthest, Math.hypot(spot.x, spot.y));

  const seeded = new Map<string, number>();
  let loose = 0;
  for (const node of nodes) {
    if (node.x !== undefined && node.y !== undefined) continue;
    const anchor = anchorOf(node, mode, spots);
    if (anchor === null) {
      const angle = loose * GOLDEN;
      const radius = farthest + SPACING;
      node.x = radius * Math.cos(angle);
      node.y = radius * Math.sin(angle);
      loose += 1;
      continue;
    }
    const place = `${anchor.x},${anchor.y}`;
    const j = seeded.get(place) ?? 0;
    seeded.set(place, j + 1);
    const radius = 6 * Math.sqrt(j + 1);
    const angle = j * GOLDEN;
    node.x = anchor.x + radius * Math.cos(angle);
    node.y = anchor.y + radius * Math.sin(angle);
  }
}

/**
 * A cluster's area on the canvas: the middle of its members and a radius that
 * holds most of them. The radius is the 75th percentile of the members' distances
 * from the middle, plus a margin, so one stray note does not swell the area over
 * the others, and it is never past 0.45 of the gap to a neighbouring spot, so two
 * neighbours' areas do not cover each other's names.
 */
export function areaOf(
  members: readonly { x?: number; y?: number }[],
  gap: number,
): { x: number; y: number; radius: number } {
  const x = members.reduce((sum, member) => sum + (member.x ?? 0), 0) / members.length;
  const y = members.reduce((sum, member) => sum + (member.y ?? 0), 0) / members.length;
  const distances = members
    .map((member) => Math.hypot((member.x ?? 0) - x, (member.y ?? 0) - y))
    .sort((a, b) => a - b);
  const reach = distances[Math.ceil(0.75 * distances.length) - 1] ?? 0;
  return { x, y, radius: Math.min(Math.max(24, reach + 18), 0.45 * gap) };
}

/**
 * Where each area's name sits, as the baseline of its text, in the order given.
 * A name sits just above its area; when its box would print on a name already
 * placed, it moves up one `line` at a time until it is clear. A box is `half` wide
 * either side of the name's centre and `height` tall above its baseline.
 */
export function nameBaselines(
  names: readonly { x: number; y: number; half: number }[],
  line: number,
  height: number,
): number[] {
  const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  return names.map(({ x, y, half }) => {
    const boxAt = (baseline: number) => ({
      left: x - half,
      right: x + half,
      top: baseline - height,
      bottom: baseline,
    });
    let baseline = y;
    let box = boxAt(baseline);
    while (
      placed.some(
        (other) =>
          other.left < box.right &&
          box.left < other.right &&
          other.top < box.bottom &&
          box.top < other.bottom,
      )
    ) {
      baseline -= line;
      box = boxAt(baseline);
    }
    placed.push(box);
    return baseline;
  });
}

/**
 * The Fruchterman-Reingold forces that replace the default layout in a cluster
 * mode. Repulsion is not here: the canvas sets force-graph's own charge to
 * `CHARGE`, which is the `k²/d` term.
 *
 * `attract` pulls the two ends of each link together, `d/K` per tick scaled by
 * `ATTRACT`, so a note's links keep its neighbours near. `anchor` pulls each note
 * to its spot. `gravity` pulls every note to the middle, so a loose note rings the
 * clusters instead of drifting off the edge.
 */
export function clusterForces(mode: GraphMode, spots: Map<string, Spot>): ClusterForces {
  const attracting = mode === "tags" ? TAGS_ATTRACT : ATTRACT;
  const pulling = mode === "tags" ? TAGS_ANCHOR : ANCHOR;
  let all: DrawnNode[] = [];
  let byPath = new Map<string, DrawnNode>();
  let anchors = new Map<DrawnNode, { x: number; y: number }>();
  let linked: DrawnLink[] = [];

  const endOf = (end: DrawnLink["source"]): DrawnNode | undefined =>
    typeof end === "string" ? byPath.get(end) : end;

  // Each force reads the nodes it is handed, since the simulation hands them to
  // every force at once, and the resolved link ends are read at each tick.
  const initialize = (nodes: DrawnNode[]) => {
    all = nodes;
    byPath = new Map(nodes.map((node) => [node.path, node]));
    anchors = new Map();
    for (const node of nodes) {
      const at = anchorOf(node, mode, spots);
      if (at !== null) anchors.set(node, at);
    }
  };

  const attract = Object.assign(
    (alpha: number) => {
      const pull = (attracting * alpha) / K;
      for (const link of linked) {
        const source = endOf(link.source);
        const target = endOf(link.target);
        if (source === undefined || target === undefined) continue;
        const dx = (target.x ?? 0) - (source.x ?? 0);
        const dy = (target.y ?? 0) - (source.y ?? 0);
        source.vx = (source.vx ?? 0) + dx * pull;
        source.vy = (source.vy ?? 0) + dy * pull;
        target.vx = (target.vx ?? 0) - dx * pull;
        target.vy = (target.vy ?? 0) - dy * pull;
      }
    },
    {
      initialize,
      links(next: DrawnLink[]) {
        linked = next;
      },
    },
  );

  const anchor = Object.assign(
    (alpha: number) => {
      for (const node of all) {
        const at = anchors.get(node);
        if (at === undefined) continue;
        node.vx = (node.vx ?? 0) + (at.x - (node.x ?? 0)) * pulling * alpha;
        node.vy = (node.vy ?? 0) + (at.y - (node.y ?? 0)) * pulling * alpha;
      }
    },
    { initialize },
  );

  const gravity = Object.assign(
    (alpha: number) => {
      for (const node of all) {
        node.vx = (node.vx ?? 0) - (node.x ?? 0) * GRAVITY * alpha;
        node.vy = (node.vy ?? 0) - (node.y ?? 0) * GRAVITY * alpha;
      }
    },
    { initialize },
  );

  return { attract, anchor, gravity };
}
