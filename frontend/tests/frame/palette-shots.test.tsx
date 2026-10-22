/**
 * Pictures of a note in each accent palette (#778), in the light and the dark
 * theme, at desktop and touch phone width, to look at by eye.
 *
 * The note is mounted over a router the way `theme-shots.test.tsx` mounts it,
 * with the api answered from a small vault here. Pictures land in
 * node_modules/.cache/kasten-shots with VITE_KASTEN_SHOTS=1.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { waitFor } from "@testing-library/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { shot } from "./shots";
import "@/styles/app.css";

const VIM_KEY = "kasten.vim";
const PALETTE_KEY = "kasten.palette";

const PALETTES = ["poel", "russet", "peach", "pansy"];

// The mocks read these lazily, inside their functions, because `vi.mock` is
// hoisted above the constants and a factory that reads one at load meets its
// temporal dead zone.
const FILES = ["Palettes.md", "Design Notes.md"];

/**
 * The note the pictures open. It holds every mark a palette colours: links, a
 * tag, a highlight, callouts, and a todo in each status. The overdue line's
 * date is the form `DUE` in todo-fields.ts reads.
 */
const NOTE = [
  "# Palettes",
  "",
  "A [[Design Notes]] link, a [web link](https://example.com), a #reading tag and ==a highlight== in a sentence.",
  "",
  "> [!note] Note",
  "> A callout with a [[Design Notes]] link.",
  "",
  "> [!warning] Warning",
  "> A warning callout.",
  "",
  "> [!example] Example",
  "> An example callout.",
  "",
  "- [ ] open",
  "- [/] doing",
  "- [b] blocked",
  "- [w] waiting",
  "- [r] in review",
  "- [x] done",
  "- [-] dropped",
  "- [ ] overdue 📅 2020-01-02",
].join("\n");

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: async () => FILES,
    fetchNote: async (path: string) => {
      if (path === "Palettes.md") return NOTE;
      if (path === "Design Notes.md") return "# Design Notes\n";
      throw new real.NoteMissing(path);
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
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: async () => ({ nodes: [], edges: [], columns: [], rows: [], truncated: false }),
}));

/** A stream that never says anything, so the route opens no connection. */
class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

const THEMES = ["light", "dark"] as const;

/**
 * A touch phone is a finger's pointer, which the route reads as coarse.
 *
 * The desktop is 1440 wide, the frame window `vite.config.ts` opens.
 */
const SIZES = [
  { name: "desktop", width: 1440, height: 900, coarse: false },
  { name: "touch-phone", width: 390, height: 844, coarse: true },
];

type Size = (typeof SIZES)[number];

/** The width of every picture, in the order they are taken: light first, then dark. */
const EXPECTED = [1440, 390, 1440, 390];

/** Ten seconds, well past the one-second default, for a route that has to load its chunks. */
const PATIENCE = { timeout: 10_000 };

/** Mount the note at one size in the current palette and theme, picture it, and take it down. */
async function draw(name: string, size: Size, palette: string): Promise<number> {
  await page.viewport(size.width, size.height);
  stubMatchMedia({ [NARROW]: size.width < 768, [COARSE]: size.coarse });
  // Each picture is a device of its own, or the layout the last one left
  // would be the layout this one starts on. The palette is stored the way
  // the app stores a pick, so the route starts on it.
  localStorage.clear();
  localStorage.setItem(VIM_KEY, "off");
  localStorage.setItem(PALETTE_KEY, palette);

  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/?note=Palettes.md"] }),
  });
  await act(async () => {
    await router.load();
  });
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );
    });
    // The editor holds the note's text once the last word of the sentence is in it.
    await waitFor(
      () => expect(host.querySelector(".cm-content")?.textContent).toContain("highlight"),
      PATIENCE,
    );
    // Each face is read in once it loads, so a picture never shows the fallback.
    await document.fonts.ready;
    return await shot(host, name);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

/** Four pictures of one palette: each theme at each size, each answering its width. */
async function pictures(palette: string): Promise<number[]> {
  const widths: number[] = [];
  for (const theme of THEMES) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.palette = palette;
    for (const size of SIZES) {
      widths.push(await draw(`palette-${palette}-${size.name}-${theme}`, size, palette));
    }
  }
  return widths;
}

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
});

afterEach(async () => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-palette");
  localStorage.clear();
  vi.unstubAllGlobals();
  await page.viewport(1280, 900);
});

for (const palette of PALETTES) {
  it(`pictures a note in the ${palette} palette`, async () => {
    const widths = await pictures(palette);
    expect(widths).toEqual(EXPECTED);
  }, 120_000);
}
