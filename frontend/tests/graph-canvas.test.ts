/**
 * The canvas's own arithmetic. The drawing itself needs a canvas, which jsdom
 * has not got, so `force-graph` is replaced and never called.
 */

import type { DrawnNode } from "@/lib/graph";
import { radiusOf } from "@/lib/graph";
import { drawGraph, type GraphCanvasHandlers, hitRadius } from "@/lib/graph-canvas";

// Each setter is kept by name, with the arguments of its last call, and every
// call answers the graph, as the library's setters do.
const { graphs, listeners } = vi.hoisted(() => ({
  graphs: [] as Array<{ seen: Record<string, unknown[]> }>,
  listeners: [] as Array<() => void>,
}));
vi.mock("force-graph", () => ({
  default: function ForceGraph() {
    const seen: Record<string, unknown[]> = {};
    const graph = new Proxy(
      {},
      {
        get(_, name: string) {
          if (name === "seen") return seen;
          return (...args: unknown[]) => {
            seen[name] = args;
            return graph;
          };
        },
      },
    );
    graphs.push(graph as { seen: Record<string, unknown[]> });
    return graph;
  },
}));
vi.mock("@/lib/theme", () => ({
  onThemeChange: (listener: () => void) => {
    listeners.push(listener);
    return () => {};
  },
}));

const handlers: GraphCanvasHandlers = {
  onOpen: () => {},
  onBlank: () => {},
  coarse: () => false,
};

/** A note of the given type, as the canvas paints it: no links, not missing. */
const concept: DrawnNode = {
  path: "a.md",
  name: "a",
  type: "Concept",
  tags: [],
  missing: false,
  degree: 0,
  x: 0,
  y: 0,
} as DrawnNode;

/** The fills a canvas took, in order, each taken at the moment of the fill. */
function paintNode(node: DrawnNode): string[] {
  const fills: string[] = [];
  const ctx = {
    fillStyle: "",
    beginPath() {},
    arc() {},
    stroke() {},
    fillText() {},
    fill: () => fills.push(ctx.fillStyle),
  };
  const paint = graphs.at(-1)?.seen.nodeCanvasObject?.[0] as (
    node: DrawnNode,
    ctx: unknown,
    scale: number,
  ) => void;
  paint(node, ctx, 1);
  return fills;
}

beforeEach(() => {
  graphs.length = 0;
  listeners.length = 0;
});

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("hitRadius", () => {
  it("is the dot and a little more for a mouse, at any zoom", () => {
    expect(hitRadius(4, 0.2, false)).toBe(radiusOf(4) + 2);
    expect(hitRadius(4, 3, false)).toBe(radiusOf(4) + 2);
  });

  it("stays 24 pixels across on screen for a finger when zoomed out", () => {
    const scale = 0.5;
    expect(hitRadius(0, scale, true) * scale * 2).toBe(24);
  });

  it("is the mouse's area for a finger once the dot is drawn larger than that", () => {
    expect(hitRadius(4, 3, true)).toBe(hitRadius(4, 3, false));
  });
});

describe("drawGraph colours", () => {
  it("colours a note by its type from the tag slots", () => {
    document.documentElement.style.setProperty("--tg-4", "#9c5a8d");
    drawGraph(document.createElement("div"), handlers);

    expect(paintNode(concept)).toEqual(["#9c5a8d"]);
  });

  it("repaints in the new colours after a theme switch", () => {
    document.documentElement.style.setProperty("--k-bg", "#ffffff");
    document.documentElement.style.setProperty("--tg-4", "#9c5a8d");
    drawGraph(document.createElement("div"), handlers);
    // Read once before the switch, so a cache left in place would show.
    paintNode(concept);

    document.documentElement.style.setProperty("--k-bg", "#1d2026");
    document.documentElement.style.setProperty("--tg-4", "#c79ad0");
    listeners[0]?.();

    expect({
      background: graphs.at(-1)?.seen.backgroundColor?.[0],
      fill: paintNode(concept)[0],
    }).toEqual({ background: "#1d2026", fill: "#c79ad0" });
  });
});
