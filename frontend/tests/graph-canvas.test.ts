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
          // The one answer a test needs back: a screen place, offset from the graph place.
          if (name === "graph2ScreenCoords")
            return (x: number, y: number) => ({ x: x + 10, y: y + 20 });
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

/** A note as the margin hands it over: a graph note, with no place yet. */
function graphNote(path: string, tags: string[] = [], type: string | null = "Concept") {
  return { path, name: path.replace(/\.md$/, ""), type, tags, missing: false };
}

function link(source: string, target: string) {
  return { source, target, relation: null, line: 1 };
}

/** The node the canvas holds for a path, as the last redraw left it. */
function drawnOf(path: string): DrawnNode {
  const drawing = graphs.at(-1)?.seen.graphData?.[0] as { nodes: DrawnNode[] };
  return drawing.nodes.find((node) => node.path === path) as DrawnNode;
}

/** Each stroke a note's canvas drew: the radius of its arc, and the line's width and colour. */
function strokesOf(node: DrawnNode): Array<{ radius: number; width: number; style: string }> {
  const drawn: Array<{ radius: number; width: number; style: string }> = [];
  let radius = 0;
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    beginPath() {},
    arc: (_x: number, _y: number, r: number) => {
      radius = r;
    },
    fill() {},
    fillText() {},
    strokeText() {},
    stroke: () => drawn.push({ radius, width: ctx.lineWidth, style: ctx.strokeStyle }),
  };
  const paint = graphs.at(-1)?.seen.nodeCanvasObject?.[0] as (
    node: DrawnNode,
    ctx: unknown,
    scale: number,
  ) => void;
  paint(node, ctx, 1);
  return drawn;
}

/**
 * Each tag slot set to a colour of its own, made from `shade` so a second call
 * gives different colours. A fill that is one of them came from a tag slot.
 */
function tagSlots(shade: string): string[] {
  const colours: string[] = [];
  for (let slot = 1; slot <= 10; slot++) {
    const colour = `#${shade}${slot.toString(16).padStart(2, "0")}00`;
    document.documentElement.style.setProperty(`--tg-${slot}`, colour);
    colours.push(colour);
  }
  return colours;
}

describe("drawGraph radial", () => {
  it("A1 a radial drawing turns off zoom, pan and drag and fixes each note on its ring", () => {
    const canvas = drawGraph(document.createElement("div"), handlers, { radial: true });
    canvas.resize(200, 200);
    canvas.update(
      [graphNote("a.md"), graphNote("b.md"), graphNote("c.md"), graphNote("d.md")],
      [link("a.md", "b.md"), link("a.md", "c.md"), link("b.md", "d.md")],
      "a.md",
    );
    const seen = graphs.at(-1)?.seen;

    expect({
      zoom: seen?.enableZoomInteraction,
      pan: seen?.enablePanInteraction,
      drag: seen?.enableNodeDrag,
      settle: seen?.cooldownTicks,
      centre: seen?.centerAt,
      scale: seen?.zoom,
    }).toEqual({
      zoom: [false],
      pan: [false],
      drag: [false],
      settle: [0],
      centre: [0, 0],
      scale: [1],
    });
    // Two rings, so the unit is (200 / 2 - 16) / 2 = 42: ring 1 at 42, ring 2 at 84.
    expect(drawnOf("a.md")).toMatchObject({ fx: 0, fy: 0 });
    expect(drawnOf("b.md").fy).toBeCloseTo(-42);
    expect(drawnOf("c.md").fy).toBeCloseTo(42);
    expect(drawnOf("d.md").fy).toBeCloseTo(-84);
    expect(drawnOf("d.md").fx).toBeCloseTo(0);
    expect(drawnOf("d.md").y).toBe(drawnOf("d.md").fy);
  });

  it("A1 a still radial drawing pauses its redraw, and a hover asks one repaint", () => {
    const canvas = drawGraph(document.createElement("div"), handlers, { radial: true });
    canvas.update([graphNote("a.md")], [], "a.md");
    const graph = graphs.at(-1);
    const seen = graph?.seen;
    expect(seen?.autoPauseRedraw).toEqual([true]);

    // Another zoom stands in for a zoom left behind, so a hover that resets it shows.
    (graph as unknown as { zoom: (k: number) => unknown }).zoom(2);
    const hover = seen?.onNodeHover?.[0] as (node: DrawnNode) => void;
    hover({ path: "a.md", x: 0, y: 0 } as DrawnNode);

    expect(seen?.zoom).toEqual([1]);
  });

  it("L9 a radial drawing rings the centre with a gap", () => {
    document.documentElement.style.setProperty("--k-accent", "#123456");
    const canvas = drawGraph(document.createElement("div"), handlers, { radial: true });
    canvas.update([graphNote("a.md"), graphNote("b.md")], [link("a.md", "b.md")], "a.md");

    // The centre's dot is 7 px, so its ring is 2.5 px out, and the hovered note's
    // ring is 2.5 px out of its own dot, here 5 px.
    expect(strokesOf(drawnOf("a.md"))).toEqual([{ radius: 9.5, width: 1.5, style: "#123456" }]);
    const hover = graphs.at(-1)?.seen.onNodeHover?.[0] as (node: DrawnNode) => void;
    hover(drawnOf("b.md"));
    expect(strokesOf(drawnOf("b.md"))).toEqual([{ radius: 7.5, width: 1.5, style: "#123456" }]);
  });

  it("L9 a radial drawing draws its links 1 px wide", () => {
    drawGraph(document.createElement("div"), handlers, { radial: true });
    const linkWidth = graphs.at(-1)?.seen.linkWidth?.[0] as (link: unknown) => number;

    expect(linkWidth(link("a.md", "b.md"))).toBe(1);
  });

  it("A3 a radial drawing fills a note with its first tag's colour", () => {
    const slots = tagSlots("00");
    document.documentElement.style.setProperty("--tg-none", "#ff00ff");
    const canvas = drawGraph(document.createElement("div"), handlers, { radial: true });
    canvas.update([graphNote("a.md", ["Rust"], null)], [], "a.md");

    expect(slots).toContain(paintNode(drawnOf("a.md"))[0]);
  });

  it("A4 a radial drawing reports the hovered note and its place on screen", () => {
    const onHover = vi.fn();
    const canvas = drawGraph(
      document.createElement("div"),
      { ...handlers, onHover },
      { radial: true },
    );
    canvas.update([graphNote("a.md")], [], "a.md");
    const hover = graphs.at(-1)?.seen.onNodeHover?.[0] as (node: DrawnNode | null) => void;
    const hovered = { path: "a.md", x: 5, y: 6 } as DrawnNode;

    hover(hovered);
    expect(onHover).toHaveBeenLastCalledWith({ node: hovered, x: 15, y: 26 });
    hover(null);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it("A4 a radial drawing writes no names on the canvas", () => {
    const canvas = drawGraph(document.createElement("div"), handlers, { radial: true });
    canvas.update([graphNote("a.md")], [], "a.md");

    expect(inkOf(drawnOf("a.md"))).toEqual([]);
  });

  it("I6 a theme or palette switch makes a radial drawing read the tag colours again", () => {
    document.documentElement.style.setProperty("--tg-none", "#ff00ff");
    const before = tagSlots("10");
    const canvas = drawGraph(document.createElement("div"), handlers, { radial: true });
    canvas.update([graphNote("a.md", ["Rust"], null)], [], "a.md");
    const node = drawnOf("a.md");
    expect(before).toContain(paintNode(node)[0]);

    const after = tagSlots("ff");
    listeners[0]?.();

    expect(after).toContain(paintNode(node)[0]);
  });
});
