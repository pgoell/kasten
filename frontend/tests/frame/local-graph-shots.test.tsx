/**
 * Pictures of the local graph (#781), to look at by eye: the right margin at desktop
 * width, the 540 px side sheet in a split, the bottom sheet on a phone, and the
 * margin in each of the four accent palettes.
 *
 * The note has eight links with a tag each, three backlinks, two unlinked mentions
 * and one unwritten link. Mounted through the reader fixture's `mount`. Pictures
 * land in node_modules/.cache/kasten-shots with VITE_KASTEN_SHOTS=1.
 */

import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { waitFor } from "@testing-library/react";
import { commands, page, userEvent } from "vitest/browser";
import { fetchGraph } from "@/lib/graph-api";
import {
  closeTree,
  DESKTOP,
  leader,
  type Mounted,
  mount,
  need,
  nextFrame,
  PATIENCE,
  picture,
  type Theme,
  TOUCH,
  unmount,
  visibleEditor,
} from "./reader-fixture";

const HUB = "Hub.md";
const PALETTE_KEY = "kasten.palette";
const THEMES: Theme[] = ["light", "dark"];
const PALETTES = ["poel", "russet", "peach", "pansy"];

/** The eight notes the hub links to, each with its own tag. */
const LINKED = [
  ["Alpha", "design"],
  ["Beta", "reading"],
  ["Gamma", "tokens"],
  ["Delta", "project"],
  ["Epsilon", "people"],
  ["Zeta", "ideas"],
  ["Eta", "log"],
  ["Theta", "travel"],
] as const;

/** The three notes that link to the hub. */
const BACKLINKS = ["Inbox One", "Inbox Two", "Inbox Three"];

const HUB_TEXT = [
  "# Hub",
  "",
  "A paragraph of the hub, which links out to the notes around it, with words enough to wrap across the reading measure.",
  "",
  ...LINKED.map(([name]) => `- [[${name}]]`),
  "- [[Ghost]]",
  "",
].join("\n");

const NOTES: Record<string, string> = {
  [HUB]: HUB_TEXT,
  ...Object.fromEntries(LINKED.map(([name]) => [`${name}.md`, `# ${name}\n`])),
  ...Object.fromEntries(BACKLINKS.map((name) => [`${name}.md`, `# ${name}\n\n[[Hub]]\n`])),
};

// The graph the margin draws: the hub in the middle, the links, the backlinks and the
// unwritten `Ghost`. Read by the mocks below only when they are called, not at load.
const GRAPH = {
  nodes: [
    { path: HUB, name: "Hub", type: "Concept", tags: ["reading"], missing: false },
    ...LINKED.map(([name, tag]) => ({
      path: `${name}.md`,
      name,
      type: "Concept",
      tags: [tag],
      missing: false,
    })),
    ...BACKLINKS.map((name) => ({
      path: `${name}.md`,
      name,
      type: null,
      tags: [],
      missing: false,
    })),
    { path: "Ghost.md", name: "Ghost", type: null, tags: [], missing: true },
  ],
  edges: [
    ...LINKED.map(([name]) => ({ source: HUB, target: `${name}.md`, relation: null, line: 5 })),
    { source: HUB, target: "Ghost.md", relation: null, line: 15 },
    ...BACKLINKS.map((name) => ({ source: `${name}.md`, target: HUB, relation: null, line: 3 })),
  ],
  columns: [],
  rows: [],
  truncated: false,
};

/** Alpha and Beta each link to two notes of their own: the second ring of Two steps. */
const SECOND_STEP = [
  ["Alpha one", "Alpha", "design"],
  ["Alpha two", "Alpha", "people"],
  ["Beta one", "Beta", "reading"],
  ["Beta two", "Beta", "log"],
] as const;

/** The same drawing one step further out, which Two steps asks for. */
const TWO_STEPS = {
  ...GRAPH,
  nodes: [
    ...GRAPH.nodes,
    ...SECOND_STEP.map(([name, , tag]) => ({
      path: `${name}.md`,
      name,
      type: "Concept",
      tags: [tag],
      missing: false,
    })),
  ],
  edges: [
    ...GRAPH.edges,
    ...SECOND_STEP.map(([name, from]) => ({
      source: `${from}.md`,
      target: `${name}.md`,
      relation: null,
      line: 4,
    })),
  ],
};

/** Two unlinked mentions of the hub, in two other notes. */
const MENTIONS = [
  { path: "Inbox One.md", line: 4, text: "about the hub", start: 6, end: 9, name: "Hub" },
  { path: "Alpha.md", line: 7, text: "the hub again", start: 4, end: 7, name: "Hub" },
];

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: async () => Object.keys(NOTES),
    fetchNote: async (path: string) => {
      const text = NOTES[path];
      if (text === undefined) throw new real.NoteMissing(path);
      return text;
    },
    saveNote: async (path: string, content: string) => ({ path, content }),
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTodos: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
    fetchMentions: async () => MENTIONS,
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(async (ask: { depth?: number }) => (ask.depth === 2 ? TWO_STEPS : GRAPH)),
}));

/** A stream that never says anything, so the route opens no connection. */
class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

/** The hub mounted at one size and theme, with its text in the editor. */
async function mountHub(
  size: typeof DESKTOP | typeof TOUCH,
  theme: Theme,
  storage: Record<string, string> = {},
): Promise<Mounted> {
  const mounted = await mount(
    size,
    theme,
    `/?note=${encodeURIComponent(HUB)}`,
    "[data-reader-grid]",
    storage,
  );
  await waitFor(
    () => expect(visibleEditor(mounted.host).textContent).toContain("paragraph"),
    PATIENCE,
  );
  return mounted;
}

/** The sheet over the window or the note, when one is on screen. */
const sheet = () =>
  document.querySelector<HTMLElement>("[role='dialog'][aria-label='Local graph']");

/** Waits for the margin's canvas to exist and two frames to paint it. */
async function drawn(host: HTMLElement) {
  await waitFor(
    () => expect(host.querySelector("[data-margin='links'] canvas")).not.toBeNull(),
    PATIENCE,
  );
  await nextFrame();
  await nextFrame();
}

/** Hovers the middle of the margin's graph, where the hub is drawn, so its title shows. */
async function hoverHub(host: HTMLElement) {
  const canvas = need(
    host.querySelector<HTMLElement>("[data-margin='links'] canvas"),
    "margin canvas",
  );
  await userEvent.hover(canvas);
  await waitFor(
    () => expect(host.querySelector("[role='tooltip']")?.textContent).toBe("Hub"),
    PATIENCE,
  );
}

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-palette");
  await commands.emulateMedia({});
  await page.viewport(1280, 900);
});

it("graph-margin-desktop-1440 in light and dark", async () => {
  for (const theme of THEMES) {
    const mounted = await mountHub(DESKTOP, theme);
    try {
      await closeTree(mounted.host);
      await drawn(mounted.host);
      await hoverHub(mounted.host);

      await picture(mounted.host, `graph-margin-desktop-1440-${theme}`, DESKTOP);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("graph-sheet-split-1440 in light and dark", async () => {
  for (const theme of THEMES) {
    const mounted = await mountHub(DESKTOP, theme);
    try {
      const { host } = mounted;
      await closeTree(host);
      // A split leaves the new pane empty, so the hub stays in the left pane. Two panes at
      // 1440 are each narrower than 1320, so the side sheet is what `Space g l` opens.
      leader(host, [" ", "%"]);
      await waitFor(
        () => expect(host.querySelectorAll(".cm-content").length).toBeGreaterThan(1),
        PATIENCE,
      );
      await userEvent.click(
        need(host.querySelectorAll<HTMLElement>(".cm-content")[0], "hub editor"),
      );
      await nextFrame();
      leader(host, [" ", "g", "l"]);

      await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
      const panel = need(sheet(), "side sheet");
      await expect.poll(() => getComputedStyle(panel).transform, PATIENCE).toBe("none");
      await waitFor(() => expect(panel.querySelector("canvas")).not.toBeNull(), PATIENCE);
      await nextFrame();
      await nextFrame();

      await picture(host, `graph-sheet-split-1440-${theme}`, DESKTOP);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("graph-sheet-touch-390 in light and dark", async () => {
  for (const theme of THEMES) {
    const mounted = await mountHub(TOUCH, theme);
    try {
      const { host } = mounted;
      visibleEditor(host).focus();
      need(host.querySelector<HTMLElement>("[data-head='graph']"), "graph button").click();

      await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
      const panel = need(sheet(), "bottom sheet");
      // At rest the bottom sheet's foot is the screen's foot.
      await expect.poll(() => Math.round(panel.getBoundingClientRect().bottom), PATIENCE).toBe(844);
      await waitFor(() => expect(panel.querySelector("canvas")).not.toBeNull(), PATIENCE);
      await nextFrame();
      await nextFrame();

      await picture(host, `graph-sheet-touch-390-${theme}`, TOUCH);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("graph-margin-palettes-1440 one picture per palette, in light", async () => {
  for (const palette of PALETTES) {
    document.documentElement.dataset.palette = palette;
    const mounted = await mountHub(DESKTOP, "light", { [PALETTE_KEY]: palette });
    try {
      await closeTree(mounted.host);
      await drawn(mounted.host);

      await picture(mounted.host, `graph-margin-palettes-1440-${palette}-light`, DESKTOP);
    } finally {
      await unmount(mounted);
      document.documentElement.removeAttribute("data-palette");
    }
  }
}, 120_000);

it("graph-margin-two-steps-1440 in light", async () => {
  const mounted = await mountHub(DESKTOP, "light");
  try {
    const { host } = mounted;
    await closeTree(host);
    await drawn(host);

    // Two steps is the margin's second depth button: asked for, the drawing grows a ring.
    const twoSteps = need(
      [...host.querySelectorAll<HTMLElement>("[data-margin='links'] button")].find(
        (each) => each.textContent === "Two steps",
      ),
      "Two steps button",
    );
    await userEvent.click(twoSteps);
    await waitFor(
      () => expect(vi.mocked(fetchGraph).mock.calls.some(([ask]) => ask.depth === 2)).toBe(true),
      PATIENCE,
    );
    await nextFrame();
    await nextFrame();

    await picture(host, "graph-margin-two-steps-1440-light", DESKTOP);
  } finally {
    await unmount(mounted);
  }
}, 120_000);
