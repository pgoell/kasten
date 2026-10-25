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

/** Each column's nodes top down, spaced so the labels fit, at `scale` units per euro. */
function placeColumn<N extends FlowNode>(nodes: N[], x: number, scale: number): PlacedNode<N>[] {
  const placed: PlacedNode<N>[] = [];
  let bottom = -GAP;
  let centre = -LABEL_STEP;
  for (const node of nodes) {
    const height = Math.max(1, node.amount * scale);
    const y = Math.max(bottom + GAP, centre + LABEL_STEP - height / 2);
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

/**
 * Lay out a sankey `width` units wide with its columns at `xs`. A node's links leave and
 * arrive in the order of the nodes at their other end, so the bands do not cross at a node.
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
  const placed = columns.flatMap((list, column) => placeColumn(list, xs[column] ?? 0, scale));
  const at = new Map(placed.map((entry) => [entry.node.key, entry]));
  const order = new Map(placed.map((entry, index) => [entry.node.key, index]));
  const rank = (key: string) => order.get(key) ?? 0;
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  const sorted = [...links].sort(
    (a, b) => rank(a.source) - rank(b.source) || rank(a.target) - rank(b.target),
  );
  const offsets = new Map<L, number>();
  for (const link of sorted) {
    offsets.set(link, outgoing.get(link.source) ?? 0);
    outgoing.set(link.source, (offsets.get(link) ?? 0) + link.amount * scale);
  }
  const bands: PlacedLink<L>[] = [];
  for (const link of [...links].sort((a, b) => rank(a.source) - rank(b.source))) {
    const from = at.get(link.source);
    const to = at.get(link.target);
    if (from === undefined || to === undefined) continue;
    const thick = link.amount * scale;
    const into = incoming.get(link.target) ?? 0;
    incoming.set(link.target, into + thick);
    const y0 = from.y + (offsets.get(link) ?? 0);
    bands.push({ link, path: band(from.x + NODE_WIDTH, y0, to.x, to.y + into, thick) });
  }
  const height = Math.max(0, ...placed.map((entry) => entry.y + entry.height));
  return { nodes: placed, links: bands, width, height };
}
