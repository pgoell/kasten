/**
 * The geometry of a sankey: where each node stands and the band each link draws. The backend
 * orders the nodes in each column and sends their amounts; this only places them, so the
 * chart has no library to load past the CSP.
 */

export interface FlowNode {
  key: string;
  column: number;
  amount: number;
}

export interface FlowLink {
  source: string;
  target: string;
  amount: number;
}

export interface PlacedNode<N extends FlowNode> {
  node: N;
  x: number;
  y: number;
  height: number;
}

export interface PlacedLink<L extends FlowLink> {
  link: L;
  /** The band as one closed svg path. */
  path: string;
}

export interface Sankey<N extends FlowNode, L extends FlowLink> {
  nodes: PlacedNode<N>[];
  links: PlacedLink<L>[];
  width: number;
  height: number;
}

export const NODE_WIDTH = 10;
/** The tallest column's money fills this many units; a column of small nodes grows past it. */
const SCALE_HEIGHT = 340;
const GAP = 6;
/** Nodes stand at least this far apart, centre to centre, so their one-line labels never meet. */
const LABEL_STEP = 20;
/** Room above the first node, so the label of a thin node at the top is not cut off. */
const TOP = 10;
/** The column placed first; the others follow it out from there, the sources last. */
const FIRST = 1;

/** Where each link leaves its source and enters its target, below the node's top. */
interface Offsets {
  out: number;
  in: number;
}

/**
 * Each link's offsets: a node's links leave in the order of their targets and arrive in the
 * order of their sources, so no two bands cross at a node.
 */
function offsetsOf<L extends FlowLink>(
  links: L[],
  rank: (key: string) => number,
  scale: number,
): Map<L, Offsets> {
  const offsets = new Map<L, Offsets>();
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  const byTarget = [...links].sort((a, b) => rank(a.target) - rank(b.target));
  for (const link of byTarget) {
    const out = outgoing.get(link.source) ?? 0;
    outgoing.set(link.source, out + link.amount * scale);
    offsets.set(link, { out, in: 0 });
  }
  const bySource = [...links].sort((a, b) => rank(a.source) - rank(b.source));
  for (const link of bySource) {
    const into = incoming.get(link.target) ?? 0;
    incoming.set(link.target, into + link.amount * scale);
    const found = offsets.get(link);
    if (found) found.in = into;
  }
  return offsets;
}

/**
 * The top each node of a column would take for its bands to run straight from the placed nodes
 * it links to, as the mean by amount.
 */
function wantedTops<N extends FlowNode, L extends FlowLink>(
  links: L[],
  offsets: Map<L, Offsets>,
  at: Map<string, PlacedNode<N>>,
): Map<string, number> {
  const sums = new Map<string, { total: number; weight: number }>();
  const add = (key: string, top: number, weight: number) => {
    const sum = sums.get(key) ?? { total: 0, weight: 0 };
    sums.set(key, { total: sum.total + top * weight, weight: sum.weight + weight });
  };
  for (const link of links) {
    const { out, in: into } = offsets.get(link) ?? { out: 0, in: 0 };
    const source = at.get(link.source);
    const target = at.get(link.target);
    if (source && !target) add(link.target, source.y + out - into, link.amount);
    if (target && !source) add(link.source, target.y + into - out, link.amount);
  }
  return new Map([...sums].map(([key, sum]) => [key, sum.weight ? sum.total / sum.weight : 0]));
}

/**
 * A column's nodes top down in the order given, each as near its wanted top as the nodes above
 * it allow, spaced so the labels fit, at `scale` units per euro.
 */
function placeColumn<N extends FlowNode>(
  nodes: N[],
  x: number,
  scale: number,
  wanted: Map<string, number>,
): PlacedNode<N>[] {
  const placed: PlacedNode<N>[] = [];
  let bottom = TOP - GAP;
  let centre = TOP - LABEL_STEP;
  for (const node of nodes) {
    const height = Math.max(1, node.amount * scale);
    const y = Math.max(bottom + GAP, centre + LABEL_STEP - height / 2, wanted.get(node.key) ?? TOP);
    placed.push({ node, x, y, height });
    bottom = y + height;
    centre = y + height / 2;
  }
  return placed;
}

/** The band from (x0, y0) to (x1, y1), `thick` high at both ends, as a closed path. */
function band(x0: number, y0: number, x1: number, y1: number, thick: number): string {
  const mid = (x0 + x1) / 2;
  return [
    `M${x0},${y0}`,
    `C${mid},${y0} ${mid},${y1} ${x1},${y1}`,
    `L${x1},${y1 + thick}`,
    `C${mid},${y1 + thick} ${mid},${y0 + thick} ${x0},${y0 + thick}`,
    "Z",
  ].join(" ");
}

/** The order columns are placed in: the first, then outward to the right, then to the left. */
function placingOrder(count: number): number[] {
  const right = Array.from({ length: count - FIRST }, (_, step) => FIRST + step);
  const left = Array.from({ length: FIRST }, (_, step) => FIRST - 1 - step);
  return [...right, ...left];
}

/**
 * Lay out a sankey `width` units wide with its columns at `xs`. Each column keeps the order of
 * the nodes given and stands each node where its bands run straightest.
 */
export function layout<N extends FlowNode, L extends FlowLink>(
  nodes: N[],
  links: L[],
  xs: number[],
  width: number,
): Sankey<N, L> {
  const columns = xs.map((_, column) => nodes.filter((node) => node.column === column));
  const tallest = Math.max(1, ...columns.map((list) => list.reduce((sum, n) => sum + n.amount, 0)));
  const scale = SCALE_HEIGHT / tallest;
  const order = new Map(nodes.map((node, index) => [node.key, index]));
  const offsets = offsetsOf(links, (key) => order.get(key) ?? 0, scale);
  const at = new Map<string, PlacedNode<N>>();
  for (const column of placingOrder(xs.length)) {
    const wanted = wantedTops(links, offsets, at);
    for (const entry of placeColumn(columns[column] ?? [], xs[column] ?? 0, scale, wanted)) {
      at.set(entry.node.key, entry);
    }
  }
  const bands = links.flatMap((link) => {
    const from = at.get(link.source);
    const to = at.get(link.target);
    const { out, in: into } = offsets.get(link) ?? { out: 0, in: 0 };
    if (from === undefined || to === undefined) return [];
    const path = band(from.x + NODE_WIDTH, from.y + out, to.x, to.y + into, link.amount * scale);
    return [{ link, path }];
  });
  const placed = [...at.values()];
  const height = Math.max(0, ...placed.map((entry) => entry.y + entry.height)) + TOP;
  return { nodes: placed, links: bands, width, height };
}
