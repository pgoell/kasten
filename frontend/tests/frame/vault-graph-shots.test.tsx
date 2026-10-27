/**
 * Pictures of the vault graph, to look at by eye (A10): the dev vault in Folders and
 * in Tags at 1440 by 900, at 390 by 844 with touch; the synthetic vault in Tags in
 * each of the four palettes, and in Folders with one note under the pointer so the
 * card shows. Each picture waits for its drawing to hold still.
 *
 * Pictures land in node_modules/.cache/kasten-shots with VITE_KASTEN_SHOTS=1.
 */

import type { Graph } from "@/lib/graph/graph-api";
import { drawGraph } from "@/lib/graph/graph-canvas";
import { DESKTOP, picture, type Theme, TOUCH } from "./reader-fixture";
import {
  boxOf,
  DEV_ANSWER,
  frame,
  type Mode,
  mountPane,
  registerVaultFixture,
  SYNTHETIC,
  serveGraph,
  setUp,
  unmountPane,
  untilCanvas,
  untilCounted,
  untilStill,
} from "./vault-graph-fixture";

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerVaultFixture();

const PALETTE_KEY = "kasten.palette";
const THEMES: Theme[] = ["light", "dark"];
const PALETTES = ["poel", "russet", "peach", "pansy"];

/**
 * Where each note of the answer settles in a box of this size. A pane makes the same
 * drawing, and the layout is the same on every canvas, so these are where its notes are.
 */
function settledPlaces(
  answer: Graph,
  width: number,
  height: number,
): Promise<Array<{ x: number; y: number }>> {
  const element = boxOf(width, height);
  return new Promise((resolve) => {
    const made = drawGraph(element, {
      onOpen: () => {},
      onBlank: () => {},
      coarse: () => false,
      onSettle: (nodes) => {
        resolve(nodes.map((node) => ({ x: node.x ?? 0, y: node.y ?? 0 })));
        made.destroy();
        element.remove();
      },
    });
    made.update(structuredClone(answer.nodes), structuredClone(answer.edges));
    made.cluster?.("folders");
  });
}

/**
 * Points the mouse at a note of the drawing, the nearest to the middle first, until
 * the panel's card names one. A note is found where force-graph draws it: its graph
 * place times the canvas's zoom, which the canvas keeps on itself as `__zoom`.
 */
async function hoverANote(host: HTMLElement, answer: Graph): Promise<void> {
  const canvas = await untilCanvas(host);
  const box = canvas.getBoundingClientRect();
  const {
    k,
    x: tx,
    y: ty,
  } = (canvas as unknown as { __zoom: { k: number; x: number; y: number } }).__zoom;
  const places = await settledPlaces(answer, box.width, box.height);
  const middle = { x: box.width / 2, y: box.height / 2 };
  const onScreen = places
    .map((place) => ({ x: place.x * k + tx, y: place.y * k + ty }))
    .filter(
      (point) => point.x >= 0 && point.x <= box.width && point.y >= 0 && point.y <= box.height,
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - middle.x, a.y - middle.y) - Math.hypot(b.x - middle.x, b.y - middle.y),
    );

  for (const point of onScreen.slice(0, 5)) {
    // force-graph reads where a `pointermove` is, from its page position.
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: box.left + point.x,
        clientY: box.top + point.y,
        pointerType: "mouse",
        bubbles: true,
      }),
    );
    // The hit test reads a shadow canvas that refreshes about every 800 ms, so a note
    // is given two seconds of frames to come under the pointer.
    for (let i = 0; i < 120; i++) {
      await frame();
      if (host.querySelector("aside")?.textContent?.includes("links in the drawing")) return;
    }
  }
  throw new Error("no note lies under the pointer");
}

/** One picture of the vault graph, once its drawing has held still. */
async function shoot(
  answer: Graph,
  name: string,
  size: typeof DESKTOP | typeof TOUCH,
  theme: Theme,
  mode: Mode,
  options: { palette?: string; hover?: boolean } = {},
): Promise<void> {
  await setUp(size, theme, mode);
  if (options.palette) {
    document.documentElement.dataset.palette = options.palette;
    localStorage.setItem(PALETTE_KEY, options.palette);
  }
  serveGraph(answer);
  const host = boxOf(size.width, size.height);
  await mountPane(host);
  await untilCounted(host);
  await untilStill(host);
  if (options.hover) await hoverANote(host, answer);
  await picture(host, name, size);
  await unmountPane(host);
}

it("vault-graph-folders-1440 in light and dark", async () => {
  for (const theme of THEMES) {
    await shoot(DEV_ANSWER, `vault-graph-folders-1440-${theme}`, DESKTOP, theme, "folders");
  }
}, 300_000);

it("vault-graph-tags-1440 in light and dark", async () => {
  for (const theme of THEMES) {
    await shoot(DEV_ANSWER, `vault-graph-tags-1440-${theme}`, DESKTOP, theme, "tags");
  }
}, 300_000);

it("vault-graph-touch-390 in light and dark", async () => {
  for (const theme of THEMES) {
    await shoot(DEV_ANSWER, `vault-graph-touch-390-${theme}`, TOUCH, theme, "folders");
  }
}, 300_000);

it("vault-graph-synthetic-tags-palettes-1440", async () => {
  for (const palette of PALETTES) {
    for (const theme of THEMES) {
      await shoot(
        SYNTHETIC,
        `vault-graph-synthetic-tags-palettes-1440-${palette}-${theme}`,
        DESKTOP,
        theme,
        "tags",
        { palette },
      );
    }
  }
}, 300_000);

it("vault-graph-synthetic-folders-1440 in light and dark", async () => {
  for (const theme of THEMES) {
    await shoot(
      SYNTHETIC,
      `vault-graph-synthetic-folders-1440-${theme}`,
      DESKTOP,
      theme,
      "folders",
      { hover: true },
    );
  }
}, 300_000);
