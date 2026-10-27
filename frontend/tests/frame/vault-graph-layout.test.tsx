/**
 * Where the vault graph's notes settle, read off a real canvas: the same vault on two
 * fresh canvases, the bound on how far out a settled note sits, and whether each note
 * sits by its own folder's spot or its tags' areas. The positions are read at the
 * moment the engine stops, through `onSettle`.
 */

import type { DrawnNode } from "@/lib/graph/graph";
import type { Graph } from "@/lib/graph/graph-api";
import { drawGraph, type GraphCanvasHandlers } from "@/lib/graph/graph-canvas";
import { placeOf, spotsOf } from "@/lib/graph/graph-clusters";
import { boxOf, DEV_ANSWER, registerVaultFixture, SYNTHETIC } from "./vault-graph-fixture";

registerVaultFixture();

const BOX = { width: 900, height: 600 };
/**
 * How long a settle waits before it reads null. The product runs 300 force ticks, one
 * per animation frame, and a loaded headless browser draws its frames slower, so a
 * settle can take well over the 5 s of a quiet run. The cap stays below each test's
 * timeout, so a stuck engine fails on its own expect and not on vitest's timeout.
 */
const CAP = 25_000;

/**
 * Draws the answer on a fresh canvas in a mode, and gives back the notes as they
 * are when the engine stops, or null when it never stops.
 */
async function settle(
  answer: Graph,
  mode: "folders" | "tags",
  cap = CAP,
): Promise<DrawnNode[] | null> {
  const element = boxOf(BOX.width, BOX.height);
  let finish: (nodes: DrawnNode[]) => void = () => {};
  const stopped = new Promise<DrawnNode[]>((resolve) => {
    finish = resolve;
  });
  const handlers: GraphCanvasHandlers = {
    onOpen: () => {},
    onBlank: () => {},
    coarse: () => false,
    onSettle: (nodes) => finish(nodes.map((node) => ({ ...node }))),
  };
  const made = drawGraph(element, handlers);
  made.update(structuredClone(answer.nodes), structuredClone(answer.edges));
  made.cluster?.(mode);
  const nodes = await Promise.race([
    stopped,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), cap)),
  ]);
  made.destroy();
  element.remove();
  return nodes;
}

const distance = (node: DrawnNode, x: number, y: number) =>
  Math.hypot((node.x ?? 0) - x, (node.y ?? 0) - y);

describe("vault graph layout on a canvas", () => {
  it("A7 the same vault lays out the same on two fresh canvases", async () => {
    // Two settles of CAP each fit inside the 60 s timeout.
    const first = await settle(DEV_ANSWER, "folders");
    const second = await settle(DEV_ANSWER, "folders");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    const drift = (first ?? []).map((node) => {
      const twin = second?.find((other) => other.path === node.path);
      return Math.max(
        Math.abs((node.x ?? 0) - (twin?.x ?? Number.NaN)),
        Math.abs((node.y ?? 0) - (twin?.y ?? Number.NaN)),
      );
    });
    expect(drift.length).toBe(DEV_ANSWER.nodes.length);
    expect(Math.max(...drift)).toBeLessThan(1e-6);
  }, 60_000);

  it("A7 after settle no note lies farther from the middle than the farthest spot plus two spot spacings", async () => {
    // Two settles of CAP each fit inside the 60 s timeout.
    for (const answer of [DEV_ANSWER, SYNTHETIC]) {
      const nodes = await settle(answer, "folders");
      expect(nodes).not.toBeNull();

      const spots = spotsOf(answer.nodes, "folders");
      const largest = Math.max(...spots.map((spot) => spot.size));
      // graph-clusters' spacing: its base gap, and the largest cluster's share of it.
      const spacing = 70 + 14 * Math.sqrt(largest);
      const farthestSpot = Math.max(...spots.map((spot) => Math.hypot(spot.x, spot.y)));
      const farthestNote = Math.max(...(nodes ?? []).map((node) => distance(node, 0, 0)));
      expect(farthestNote).toBeLessThanOrEqual(farthestSpot + 2 * spacing);
    }
  }, 60_000);

  it("A2 in Tags mode a note with exactly two tags settles inside the circle whose diameter joins its two tags' spots, for most such notes", async () => {
    const nodes = await settle(SYNTHETIC, "tags");
    expect(nodes).not.toBeNull();
    const spots = new Map(spotsOf(SYNTHETIC.nodes, "tags").map((spot) => [spot.key, spot]));

    let inside = 0;
    let total = 0;
    for (const node of nodes ?? []) {
      const keys = [...new Set(node.tags.map((tag) => tag.toLowerCase()))];
      const [first, second] = keys;
      if (keys.length !== 2 || first === undefined || second === undefined) continue;
      const one = spots.get(first);
      const two = spots.get(second);
      if (one === undefined || two === undefined) continue;
      total += 1;
      const gap = Math.hypot(one.x - two.x, one.y - two.y);
      const midpoint = { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2 };
      if (distance(node, midpoint.x, midpoint.y) <= gap / 2) inside += 1;
    }
    console.error(`A2: ${inside} of ${total} two-tag notes settle inside their circle`);
    expect(total).toBeGreaterThan(10);
    expect(inside / total).toBeGreaterThanOrEqual(0.9);
  }, 60_000);

  it("A1 in Folders mode each note settles nearer its own folder's spot than any other spot, for most notes", async () => {
    // The product runs 300 force ticks, one per animation frame: 5 s alone at 60 fps,
    // and longer when a loaded headless browser draws its frames slower (CI ran past 15 s).
    const nodes = await settle(SYNTHETIC, "folders", 50_000);
    expect(nodes).not.toBeNull();
    const spots = spotsOf(SYNTHETIC.nodes, "folders");

    let own = 0;
    let total = 0;
    for (const node of nodes ?? []) {
      const mine = spots.find((spot) => spot.key === placeOf(node.path));
      if (mine === undefined) continue;
      total += 1;
      const here = distance(node, mine.x, mine.y);
      if (
        spots.every(
          (spot) =>
            spot === mine || Math.hypot(spot.x - (node.x ?? 0), spot.y - (node.y ?? 0)) > here,
        )
      ) {
        own += 1;
      }
    }
    console.error(`A1: ${own} of ${total} notes settle nearest their own folder's spot`);
    expect(total).toBeGreaterThan(100);
    expect(own / total).toBeGreaterThanOrEqual(0.9);
  }, 60_000);
});
