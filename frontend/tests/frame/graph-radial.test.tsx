/**
 * The radial margin graph is drawn at a fixed zoom of 1, so its rings sit at
 * the box's own size in a real canvas. The library re-zooms a fresh drawing to
 * fit its node count, after the update, and that re-zoom must not win.
 *
 * Read back from the canvas d3 keeps its zoom on: `k` is the scale and `x`, `y`
 * the screen place of the drawing's origin, which must be the middle of the box.
 */

import type { GraphEdge, GraphNode } from "@/lib/graph/graph";
import { drawGraph, type GraphCanvas, type GraphCanvasHandlers } from "@/lib/graph/graph-canvas";

const handlers: GraphCanvasHandlers = {
  onOpen: () => {},
  onBlank: () => {},
  coarse: () => false,
};

/** A centre and twelve notes linked straight to it: thirteen notes, all on ring 1. */
const nodes: GraphNode[] = [
  { path: "a.md", name: "a", type: "Concept", tags: ["Rust"], missing: false },
  ...Array.from({ length: 12 }, (_, i) => ({
    path: `n${i}.md`,
    name: `n${i}`,
    type: "Concept",
    tags: ["Rust"],
    missing: false,
  })),
];
const edges: GraphEdge[] = Array.from({ length: 12 }, (_, i) => ({
  source: "a.md",
  target: `n${i}.md`,
  relation: null,
  line: 1,
}));

const mounted: Array<{ canvas: GraphCanvas; element: HTMLElement }> = [];

function box(width: number, height: number): HTMLDivElement {
  const element = document.createElement("div");
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  document.body.append(element);
  return element;
}

function radialIn(element: HTMLElement): GraphCanvas {
  const canvas = drawGraph(element, handlers, { radial: true });
  mounted.push({ canvas, element });
  return canvas;
}

/** Two animation frames: the library's debounced update has run, and so has its re-zoom. */
function twoFrames(): Promise<void> {
  return new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  });
}

/** The canvas d3 keeps the zoom on: the one that is painted. */
function paintedCanvas(element: HTMLElement): HTMLCanvasElement {
  const found = [...element.querySelectorAll("canvas")].find((canvas) => "__zoom" in canvas);
  if (found === undefined) throw new Error("no painted canvas in the box");
  return found;
}

function zoomOf(canvas: HTMLCanvasElement): { k: number; x: number; y: number } {
  return (canvas as unknown as { __zoom: { k: number; x: number; y: number } }).__zoom;
}

/**
 * The rings sit inside the box: the zoom is 1, so a ring at the layout's unit
 * is that many CSS px from the middle, which is the middle of the box.
 */
function expectRingsInside(element: HTMLElement, width: number, height: number): void {
  const transform = zoomOf(paintedCanvas(element));
  expect(transform.k).toBeCloseTo(1, 6);
  expect(Math.abs(transform.x - width / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(transform.y - height / 2)).toBeLessThanOrEqual(1);
}

afterEach(() => {
  for (const { canvas, element } of mounted.splice(0)) {
    canvas.destroy();
    element.remove();
  }
  document.documentElement.removeAttribute("style");
});

describe("drawGraph radial in a real canvas", () => {
  it("A1 a radial drawing keeps its rings inside a 540 by 320 box", async () => {
    const element = box(540, 320);
    const canvas = radialIn(element);
    canvas.resize(540, 320);
    canvas.update(nodes, edges, "a.md");

    await twoFrames();
    expectRingsInside(element, 540, 320);
  });

  it("A1 a radial drawing keeps its rings inside a 390 by 320 box", async () => {
    const element = box(390, 320);
    const canvas = radialIn(element);
    canvas.resize(390, 320);
    canvas.update(nodes, edges, "a.md");

    await twoFrames();
    expectRingsInside(element, 390, 320);
  });

  it("A1 a radial drawing resized after its first answer keeps its rings inside the box", async () => {
    const element = box(0, 0);
    const canvas = radialIn(element);
    canvas.update(nodes, edges, "a.md");
    element.style.width = "540px";
    element.style.height = "320px";
    canvas.resize(540, 320);

    await twoFrames();
    expectRingsInside(element, 540, 320);
  });

  it("A3 a radial drawing paints no background of its own", async () => {
    document.documentElement.style.setProperty("--k-bg", "#1d2026");
    const element = box(540, 320);
    const canvas = radialIn(element);
    canvas.resize(540, 320);
    canvas.update(nodes, edges, "a.md");

    await twoFrames();
    // force-graph sets the background as the canvas's CSS background, so the
    // page shows through it only when that is transparent.
    expect(getComputedStyle(paintedCanvas(element)).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });
});
