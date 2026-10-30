/**
 * Pictures of the notes like this one (#954), to look at by eye: the right margin at
 * desktop width, and the bottom sheet at a phone's 414 px, in light and dark. The
 * hub has three notes like it, one with a heading and two without.
 *
 * Mounted through the reader fixture's `mount`. Pictures land in
 * node_modules/.cache/kasten-shots with VITE_KASTEN_SHOTS=1.
 */

import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { waitFor } from "@testing-library/react";
import { commands, page } from "vitest/browser";
import {
  closeTree,
  DESKTOP,
  type Mounted,
  mount,
  need,
  nextFrame,
  PATIENCE,
  picture,
  type Size,
  type Theme,
  TOUCH,
  unmount,
  visibleEditor,
} from "./reader-fixture";

const HUB = "Hub.md";
const THEMES: Theme[] = ["light", "dark"];
const PHONE: Size = { ...TOUCH, name: "phone-414", width: 414, height: 896 };

const HUB_TEXT = [
  "# Hub",
  "",
  "A paragraph of the hub, with words enough to wrap across the reading measure.",
  "",
  "- [[Alpha]]",
  "- [[Beta]]",
  "",
].join("\n");

const NOTES: Record<string, string> = {
  [HUB]: HUB_TEXT,
  "Alpha.md": "# Alpha\n",
  "Beta.md": "# Beta\n",
};

const GRAPH = {
  nodes: [
    { path: HUB, name: "Hub", type: "Concept", tags: [], missing: false },
    { path: "Alpha.md", name: "Alpha", type: "Concept", tags: ["design"], missing: false },
    { path: "Beta.md", name: "Beta", type: "Concept", tags: ["reading"], missing: false },
  ],
  edges: [
    { source: HUB, target: "Alpha.md", relation: null, line: 5 },
    { source: HUB, target: "Beta.md", relation: null, line: 6 },
  ],
  columns: [],
  rows: [],
  truncated: false,
};

/** The three notes like the hub: one with a heading path, two without. */
const SIMILAR = {
  hits: [
    { path: "Inbox One.md", heading: "Reading > Spring", text: "Inbox one", score: 0.92 },
    { path: "Quotes.md", heading: "", text: "Quotes", score: 0.7 },
    { path: "Garden.md", heading: "Plans", text: "Garden", score: 0.55 },
  ],
  read: true,
  indexed: 4,
  notes: 4,
};

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
    fetchMentions: async () => [],
    fetchSimilar: async () => SIMILAR,
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: async () => GRAPH,
}));

/** A stream that never says anything, so the route opens no connection. */
class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

/** The hub mounted at one size and theme, with its text in the editor. */
async function mountHub(size: Size, theme: Theme): Promise<Mounted> {
  const mounted = await mount(
    size,
    theme,
    `/?note=${encodeURIComponent(HUB)}`,
    "[data-reader-grid]",
  );
  await waitFor(
    () => expect(visibleEditor(mounted.host).textContent).toContain("paragraph"),
    PATIENCE,
  );
  return mounted;
}

/** The sheet over the window, when one is on screen. */
const sheet = () =>
  document.querySelector<HTMLElement>("[role='dialog'][aria-label='Local graph']");

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  await commands.emulateMedia({});
  await page.viewport(1280, 900);
});

it("similar-margin-desktop-1440 in light and dark", async () => {
  for (const theme of THEMES) {
    const mounted = await mountHub(DESKTOP, theme);
    try {
      const { host } = mounted;
      await closeTree(host);
      await waitFor(() => expect(host.textContent).toContain("Notes like this one 3"), PATIENCE);
      await nextFrame();
      await nextFrame();

      await picture(host, `similar-margin-desktop-1440-${theme}`, DESKTOP);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("similar-sheet-phone-414 in light and dark", async () => {
  for (const theme of THEMES) {
    const mounted = await mountHub(PHONE, theme);
    try {
      const { host } = mounted;
      visibleEditor(host).focus();
      need(host.querySelector<HTMLElement>("[data-head='graph']"), "graph button").click();

      await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
      const panel = need(sheet(), "bottom sheet");
      await expect.poll(() => Math.round(panel.getBoundingClientRect().bottom), PATIENCE).toBe(896);
      await waitFor(() => expect(panel.textContent).toContain("Notes like this one 3"), PATIENCE);
      await nextFrame();
      await nextFrame();

      await picture(host, `similar-sheet-phone-414-${theme}`, PHONE);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);
