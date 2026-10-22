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
    strokeText() {},
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

/** What a label was drawn with: the text, the colour, the face and the stroke, at the moment it was drawn. */
interface Ink {
  op: "fill" | "stroke";
  text: string;
  style: string;
  font: string;
  width: number;
  join: string;
}

/** The text a note's canvas drew, filled or stroked, in the state each mark was drawn in. */
function inkOf(node: DrawnNode): Ink[] {
  const marks: Ink[] = [];
  const mark = (op: Ink["op"], text: string) =>
    marks.push({
      op,
      text,
      style: op === "fill" ? ctx.fillStyle : ctx.strokeStyle,
      font: ctx.font,
      width: ctx.lineWidth,
      join: ctx.lineJoin,
    });
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    lineWidth: 1,
    lineJoin: "miter",
    beginPath() {},
    arc() {},
    stroke() {},
    fill() {},
    fillText: (text: string) => mark("fill", text),
    strokeText: (text: string) => mark("stroke", text),
  };
  const paint = graphs.at(-1)?.seen.nodeCanvasObject?.[0] as (
    node: DrawnNode,
    ctx: unknown,
    scale: number,
  ) => void;
  paint(node, ctx, 1);
  return marks;
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

  it("draws a plain link in the muted colour, half strength", () => {
    document.documentElement.style.setProperty("--k-muted", "#ff0000");
    drawGraph(document.createElement("div"), handlers);
    const linkColor = graphs.at(-1)?.seen.linkColor?.[0] as (link: unknown) => string;

    expect(linkColor({ source: "a.md", target: "b.md", relation: null })).toBe(
      "rgba(255, 0, 0, 0.5)",
    );
  });

  it("rings each name in the page colour so it reads over dots and lines", () => {
    document.documentElement.style.setProperty("--k-bg", "#ffffff");
    drawGraph(document.createElement("div"), handlers);

    expect(
      inkOf(concept)
        .filter((mark) => mark.op === "stroke")
        .map(({ text, style, width, join }) => ({ text, style, width, join })),
    ).toEqual([{ text: "a", style: "#ffffff", width: 3, join: "round" }]);
  });

  it("names notes in the mono token's face", () => {
    document.documentElement.style.setProperty("--k-mono", "Test Mono, monospace");
    drawGraph(document.createElement("div"), handlers);

    expect(inkOf(concept).map((mark) => mark.font)).toEqual([
      "12px Test Mono, monospace",
      "12px Test Mono, monospace",
    ]);
  });
});
