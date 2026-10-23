/**
 * The canvas in a cluster mode: the dots and rings, the areas and names, the
 * forces it swaps in and the reheat of a mode switch. `force-graph` is replaced
 * and never called, as in graph-canvas.test.ts. None of this exists on main.
 */

import type { DrawnNode, GraphNode } from "@/lib/graph";
import { tagVariable } from "@/lib/graph";
import { drawGraph, type GraphCanvasHandlers } from "@/lib/graph-canvas";
import { CHARGE, CHARGE_REACH } from "@/lib/graph-clusters";

type Stub = { [method: string]: (...args: unknown[]) => unknown };
interface Fake {
  seen: Record<string, unknown[]>;
  forces: Map<string, Stub>;
}

// Each setter is kept by name, with the arguments of its last call, and every
// call answers the graph, as the library's setters do. The d3 forces are kept by
// name too, so a test reads which ones the canvas set and with what.
const { graphs, listeners } = vi.hoisted(() => ({
  graphs: [] as Fake[],
  listeners: [] as Array<() => void>,
}));
vi.mock("force-graph", () => {
  // A force as force-graph holds it: each call with an argument stores it, and a
  // call with none reads it back, as d3's strength and distanceMax do.
  const stub = (initial: Record<string, unknown>): Stub => {
    const value = { ...initial };
    const force: Stub = new Proxy(
      {},
      {
        get:
          (_, method: string) =>
          (...args: unknown[]) => {
            if (args.length === 0) return value[method];
            value[method] = args[0];
            return force;
          },
      },
    );
    return force;
  };
  return {
    default: function ForceGraph() {
      const seen: Record<string, unknown[]> = {};
      const forces = new Map<string, Stub>([
        ["link", stub({ strength: "default link" })],
        ["charge", stub({ strength: "default charge", distanceMax: Number.POSITIVE_INFINITY })],
        ["center", stub({})],
      ]);
      const graph = new Proxy(
        {},
        {
          get(_, name: string) {
            if (name === "seen") return seen;
            if (name === "forces") return forces;
            if (name === "graph2ScreenCoords")
              return (x: number, y: number) => ({ x: x + 10, y: y + 20 });
            return (...args: unknown[]) => {
              seen[name] = args;
              if (name === "d3Force") {
                const [forceName, force] = args as [string, Stub | null | undefined];
                if (args.length === 1) return forces.get(forceName);
                if (force === null) forces.delete(forceName);
                else forces.set(forceName, force as Stub);
              }
              return graph;
            };
          },
        },
      );
      graphs.push({ seen, forces } as unknown as Fake);
      return graph;
    },
  };
});
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

beforeEach(() => {
  graphs.length = 0;
  listeners.length = 0;
});

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

/** A note as the margin hands it over: a graph note, with no place yet. */
function graphNote(path: string, tags: string[] = [], type: string | null = "Concept"): GraphNode {
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

/** Each tag slot set to a colour of its own, so a fill can be matched to its slot. */
function tagSlots(shade: string): void {
  for (let slot = 1; slot <= 10; slot++) {
    const colour = `#${shade}${slot.toString(16).padStart(2, "0")}00`;
    document.documentElement.style.setProperty(`--tg-${slot}`, colour);
  }
}

/** The force the canvas holds under a name, read through its getters. */
function forceOf(name: string): {
  strength(): unknown;
  distanceMax(): unknown;
} {
  return graphs.at(-1)?.forces.get(name) as { strength(): unknown; distanceMax(): unknown };
}

/** The colour a theme variable was set to, as the canvas will read it. */
function themeValue(variable: string): string {
  return document.documentElement.style.getPropertyValue(variable).trim();
}

/** What a note's canvas painted: each fill's colour, and each stroke's radius, width and colour. */
function paintOf(node: DrawnNode): {
  fills: string[];
  strokes: Array<{ radius: number; width: number; style: string }>;
} {
  const fills: string[] = [];
  const strokes: Array<{ radius: number; width: number; style: string }> = [];
  let radius = 0;
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    beginPath() {},
    arc: (_x: number, _y: number, r: number) => {
      radius = r;
    },
    fill: () => fills.push(ctx.fillStyle),
    stroke: () => strokes.push({ radius, width: ctx.lineWidth, style: ctx.strokeStyle }),
    fillText() {},
    strokeText() {},
  };
  const paint = graphs.at(-1)?.seen.nodeCanvasObject?.[0] as (
    node: DrawnNode,
    ctx: unknown,
    scale: number,
  ) => void;
  paint(node, ctx, 1);
  return { fills, strokes };
}

/** A mark the frame painted: a fill with its alpha and colour, or a label with its text and face. */
interface Mark {
  op: "fill" | "fillText" | "strokeText";
  style: string;
  alpha: number;
  text?: string;
  font?: string;
  y?: number;
}

/**
 * Every mark one frame hook draws, in the order it draws them. The areas are
 * painted before the notes, so their discs come from the pre hook and the names
 * from the post hook; `hook` picks which.
 */
function frameMarks(hook: "onRenderFramePre" | "onRenderFramePost" = "onRenderFramePre"): Mark[] {
  const marks: Mark[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    lineWidth: 1,
    lineJoin: "",
    beginPath() {},
    arc() {},
    measureText: (text: string) => ({ width: text.length * 6 }),
    fill: () => marks.push({ op: "fill", style: ctx.fillStyle, alpha: ctx.globalAlpha }),
    fillText: (text: string, _x: number, y: number) =>
      marks.push({
        op: "fillText",
        text,
        style: ctx.fillStyle,
        alpha: ctx.globalAlpha,
        font: ctx.font,
        y,
      }),
    strokeText: (text: string, _x: number, y: number) =>
      marks.push({
        op: "strokeText",
        text,
        style: ctx.strokeStyle,
        alpha: ctx.globalAlpha,
        font: ctx.font,
        y,
      }),
  };
  const frame = graphs.at(-1)?.seen[hook]?.[0] as (ctx: unknown, scale: number) => void;
  frame(ctx, 1);
  return marks;
}

describe("drawGraph cluster mode", () => {
  it("A3 in cluster mode a dot takes its first tag's colour and a ring per further tag", () => {
    tagSlots("20");
    const canvas = drawGraph(document.createElement("div"), handlers);
    canvas.cluster("tags");
    canvas.update([graphNote("a.md", ["#Rust", "#ai", "#ml"], null)], [], undefined);

    // A dot of degree 0 is 3 px, so the rings sit 2 px and 4.5 px out of it.
    expect(paintOf(drawnOf("a.md"))).toEqual({
      fills: [themeValue(tagVariable("#Rust"))],
      strokes: [
        { radius: 5, width: 1.25, style: themeValue(tagVariable("#ai")) },
        { radius: 7.5, width: 1.25, style: themeValue(tagVariable("#ml")) },
      ],
    });
  });

  it("D5 a tag written twice in two cases gets no second ring", () => {
    tagSlots("20");
    const canvas = drawGraph(document.createElement("div"), handlers);
    canvas.cluster("tags");
    canvas.update([graphNote("a.md", ["Rust", "rust", "ai"], null)], [], undefined);

    // Only "ai" is a further tag: "rust" is the first tag again, in another case.
    expect(paintOf(drawnOf("a.md")).strokes).toEqual([
      { radius: 5, width: 1.25, style: themeValue(tagVariable("ai")) },
    ]);
  });

  it("A3 a note with no tag is filled with --tg-none in cluster mode", () => {
    document.documentElement.style.setProperty("--tg-none", "#ff00ff");
    document.documentElement.style.setProperty("--tg-4", "#9c5a8d");
    const canvas = drawGraph(document.createElement("div"), handlers);
    canvas.cluster("folders");
    canvas.update([graphNote("Loose.md", [], "Concept")], [], undefined);

    expect(paintOf(drawnOf("Loose.md")).fills).toEqual(["#ff00ff"]);
  });

  it("A1 Folders mode paints an area per folder at the --k-area strength in the accent, named in italic serif", () => {
    document.documentElement.style.setProperty("--k-area", "0.08");
    document.documentElement.style.setProperty("--k-accent", "#123456");
    document.documentElement.style.setProperty("--k-serif", "Test Serif");
    document.documentElement.style.setProperty("--k-muted", "#777777");
    document.documentElement.style.setProperty("--k-bg", "#ffffff");
    const canvas = drawGraph(document.createElement("div"), handlers);
    canvas.cluster("folders");
    canvas.update(
      [graphNote("03 Areas/a.md"), graphNote("03 Areas/b.md"), graphNote("Loose.md")],
      [link("03 Areas/a.md", "03 Areas/b.md")],
      undefined,
    );

    const marks = [...frameMarks(), ...frameMarks("onRenderFramePost")];
    expect(marks.map(({ y: _y, ...mark }) => mark)).toEqual([
      { op: "fill", style: "#123456", alpha: 0.08 },
      {
        op: "strokeText",
        text: "03 Areas",
        style: "#ffffff",
        alpha: 1,
        font: "italic 12px Test Serif",
      },
      {
        op: "fillText",
        text: "03 Areas",
        style: "#777777",
        alpha: 1,
        font: "italic 12px Test Serif",
      },
    ]);
  });

  it("A2 Tags mode paints an area per tag in its tag colour", () => {
    tagSlots("30");
    document.documentElement.style.setProperty("--k-area", "0.08");
    const canvas = drawGraph(document.createElement("div"), handlers);
    canvas.cluster("tags");
    canvas.update([graphNote("a.md", ["#ai"]), graphNote("b.md", ["#ai", "#ml"])], [], undefined);

    // The bigger tag's area comes first, each in its own slot's colour.
    expect(frameMarks().filter((mark) => mark.op === "fill")).toEqual([
      { op: "fill", style: themeValue(tagVariable("#ai")), alpha: 0.08 },
      { op: "fill", style: themeValue(tagVariable("#ml")), alpha: 0.08 },
    ]);
  });

  it("A7 cluster mode runs force-graph's own simulation with the FR forces, no wall-clock cooldown and no warmup", () => {
    const canvas = drawGraph(document.createElement("div"), handlers);
    canvas.cluster("folders");
    canvas.update(
      [graphNote("03 Areas/a.md"), graphNote("03 Areas/b.md")],
      [link("03 Areas/a.md", "03 Areas/b.md")],
      undefined,
    );
    const seen = graphs.at(-1)?.seen;
    const forces = graphs.at(-1)?.forces;

    expect({
      cooldownTicks: seen?.cooldownTicks,
      cooldownTime: seen?.cooldownTime,
      warmupTicks: seen?.warmupTicks,
      forces: [...(forces?.keys() ?? [])].sort(),
      link: forceOf("link").strength(),
      charge: [forceOf("charge").strength(), forceOf("charge").distanceMax()],
    }).toEqual({
      cooldownTicks: [300],
      cooldownTime: [Number.POSITIVE_INFINITY],
      warmupTicks: [0],
      forces: ["anchor", "attract", "charge", "gravity", "link"],
      link: 0,
      charge: [CHARGE, CHARGE_REACH],
    });
  });

  it("A7 a cluster drawing fits once after the first answer settles, even when the mode came before the answer", () => {
    const canvas = drawGraph(document.createElement("div"), handlers);
    canvas.cluster("folders");
    const seen = graphs.at(-1)?.seen;
    const settle = seen?.onEngineStop?.[0] as () => void;
    // The engine settles on the empty drawing the mode came with, before any answer.
    settle();
    delete seen?.zoomToFit;

    canvas.update([graphNote("03 Areas/a.md"), graphNote("03 Areas/b.md")], [], undefined);
    settle();
    expect(seen?.zoomToFit).toEqual([400, 40]);
    // A later settle, as a narrowing filter causes, leaves the user's zoom alone.
    delete seen?.zoomToFit;
    settle();
    expect(seen?.zoomToFit).toBeUndefined();
  });

  it("A7 onSettle hands the settled notes over when the engine stops", () => {
    const onSettle = vi.fn();
    const canvas = drawGraph(document.createElement("div"), { ...handlers, onSettle });
    canvas.update([graphNote("a.md"), graphNote("b.md")], [link("a.md", "b.md")], undefined);
    const settle = graphs.at(-1)?.seen.onEngineStop?.[0] as () => void;

    settle();

    expect(onSettle.mock.lastCall?.[0].map((node: DrawnNode) => node.path)).toEqual([
      "a.md",
      "b.md",
    ]);
  });

  it("L1 the area names are painted after the notes", () => {
    document.documentElement.style.setProperty("--k-area", "0.08");
    const canvas = drawGraph(document.createElement("div"), handlers);
    canvas.cluster("folders");
    canvas.update([graphNote("03 Areas/a.md"), graphNote("03 Areas/b.md")], [], undefined);

    // Before the notes only the disc is drawn; the name comes from the post hook.
    expect(frameMarks().map((mark) => mark.op)).toEqual(["fill"]);
    expect(frameMarks("onRenderFramePost").map((mark) => mark.op)).toEqual([
      "strokeText",
      "fillText",
    ]);
  });

  it("L2 two areas with one centre print their names on separate lines", () => {
    const canvas = drawGraph(document.createElement("div"), handlers);
    canvas.cluster("tags");
    // One note with two tags: both areas have its one place as their middle.
    canvas.update([graphNote("a.md", ["#ai", "#ml"], null)], [], undefined);

    const names = frameMarks("onRenderFramePost").filter((mark) => mark.op === "fillText");
    expect(names.map((mark) => mark.text)).toEqual(["#ai", "#ml"]);
    expect(Math.abs((names[0]?.y ?? 0) - (names[1]?.y ?? 0))).toBeCloseTo(14);
  });

  it("I5 a theme switch makes the cluster areas, rings and --k-area read again", () => {
    document.documentElement.style.setProperty("--k-area", "0.08");
    document.documentElement.style.setProperty("--k-accent", "#123456");
    document.documentElement.style.setProperty("--k-bg", "#ffffff");
    tagSlots("20");
    const canvas = drawGraph(document.createElement("div"), handlers);
    canvas.cluster("tags");
    canvas.update([graphNote("a.md", ["#ai", "#ml"], null)], [], undefined);
    // Read once before the switch, so a cache left in place would show.
    frameMarks();
    paintOf(drawnOf("a.md"));

    document.documentElement.style.setProperty("--k-area", "0.11");
    document.documentElement.style.setProperty(tagVariable("#ml"), "#abcdef");
    listeners[0]?.();

    expect({
      areas: frameMarks()
        .filter((mark) => mark.op === "fill")
        .map((mark) => mark.alpha),
      ring: paintOf(drawnOf("a.md")).strokes.map((stroke) => stroke.style),
    }).toEqual({ areas: [0.11, 0.11], ring: ["#abcdef"] });
  });

  it("I7 a mode switch reheats the same canvas and makes no second ForceGraph", () => {
    const canvas = drawGraph(document.createElement("div"), handlers);
    canvas.update([graphNote("a.md", ["#ai"])], [], undefined);
    canvas.cluster("folders");
    const seen = graphs.at(-1)?.seen;
    delete seen?.d3ReheatSimulation;

    canvas.cluster("tags");

    expect({ canvases: graphs.length, reheated: seen?.d3ReheatSimulation }).toEqual({
      canvases: 1,
      reheated: [],
    });
  });

  it("I1 cluster(null) keeps the type colours and the default forces", () => {
    tagSlots("40");
    document.documentElement.style.setProperty("--tg-4", "#9c5a8d");
    const canvas = drawGraph(document.createElement("div"), handlers);
    const forces = graphs.at(-1)?.forces;
    const centre = forces?.get("center");
    canvas.cluster("folders");
    canvas.update([graphNote("03 Areas/a.md", ["#ai", "#ml"], "Concept")], [], undefined);
    canvas.cluster(null);
    canvas.update([graphNote("03 Areas/a.md", ["#ai", "#ml"], "Concept")], [], undefined);

    expect({
      fill: paintOf(drawnOf("03 Areas/a.md")),
      centre: forces?.get("center") === centre,
      clusterForces: ["attract", "anchor", "gravity"].filter((name) => forces?.has(name)),
      link: forceOf("link").strength(),
      charge: [forceOf("charge").strength(), forceOf("charge").distanceMax()],
      cooldownTicks: graphs.at(-1)?.seen.cooldownTicks,
      cooldownTime: graphs.at(-1)?.seen.cooldownTime,
    }).toEqual({
      fill: { fills: ["#9c5a8d"], strokes: [] },
      centre: true,
      clusterForces: [],
      link: "default link",
      charge: ["default charge", Number.POSITIVE_INFINITY],
      cooldownTicks: [200],
      cooldownTime: [15000],
    });
  });
});
