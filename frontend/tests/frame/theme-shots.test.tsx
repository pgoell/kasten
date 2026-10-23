/**
 * Pictures of the home route in the light and the dark theme, at desktop,
 * phone and touch phone width (#777), to look at by eye.
 *
 * The route is mounted over a router the way `log-pane.test.tsx` mounts it,
 * with the api answered from a small vault here. Pictures land in
 * node_modules/.cache/kasten-shots with VITE_KASTEN_SHOTS=1.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { shot } from "./shots";
import "@/styles/app.css";

const VIM_KEY = "kasten.vim";

// The mocks read these lazily, inside their functions, because `vi.mock` is
// hoisted above the constants and a factory that reads one at load meets its
// temporal dead zone.
const FILES = ["Lesson.md", "Design Notes.md", "Inbox/Ideas.md"];

/**
 * The note the pictures open. Every piece the live preview draws is in it:
 * the heading, the marks, a wikilink, a tag, code, a highlight, a callout, a
 * fenced block and a task list. The paragraph sits on line 3, where the
 * editor's cursor is put.
 */
const LESSON = [
  "# Lesson",
  "",
  "A paragraph with **bold**, *italic*, a [[Design Notes]] link, a #tag, `inline code` and ==a highlight==.",
  "",
  "> [!note] Remember",
  "> The callout body.",
  "",
  "```ts",
  "const answer = 42;",
  "```",
  "",
  "- [ ] write the tests",
  "- [x] ship the tokens",
].join("\n");

// Six notes, one of each type the graph colours and one untyped, with five
// links between them, so the pane's count reads "6 notes, 5 links".
const GRAPH = {
  nodes: [
    {
      path: "Spaced repetition.md",
      name: "Spaced repetition",
      type: "Concept",
      tags: [],
      missing: false,
    },
    {
      path: "Ebbinghaus 1885.md",
      name: "Ebbinghaus 1885",
      type: "Source",
      tags: [],
      missing: false,
    },
    {
      path: "Hermann Ebbinghaus.md",
      name: "Hermann Ebbinghaus",
      type: "Person",
      tags: [],
      missing: false,
    },
    { path: "Make It Stick.md", name: "Make It Stick", type: "Book", tags: [], missing: false },
    { path: "SM-2.md", name: "SM-2", type: "Reference", tags: [], missing: false },
    { path: "Scratch.md", name: "Scratch", type: null, tags: [], missing: false },
  ],
  edges: [
    { source: "Spaced repetition.md", target: "Ebbinghaus 1885.md", relation: null, line: 3 },
    { source: "Ebbinghaus 1885.md", target: "Hermann Ebbinghaus.md", relation: "by", line: 4 },
    { source: "Make It Stick.md", target: "Spaced repetition.md", relation: null, line: 5 },
    { source: "SM-2.md", target: "Spaced repetition.md", relation: "implements", line: 6 },
    { source: "Scratch.md", target: "SM-2.md", relation: null, line: 7 },
  ],
  columns: [],
  rows: [],
  truncated: false,
};

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: async () => FILES,
    fetchNote: async (path: string) => {
      if (path === "Lesson.md") return LESSON;
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
  fetchGraph: async () => GRAPH,
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
  { name: "phone", width: 414, height: 896, coarse: false },
  { name: "touch-phone", width: 390, height: 844, coarse: true },
];

type Size = (typeof SIZES)[number];

/** Waits for a screen to be drawn at a size, before its picture is taken. */
type Ready = (host: Element, size: Size) => Promise<void>;

/** The width of every picture, in the order they are taken: light first, then dark. */
const EXPECTED = [1440, 414, 390, 1440, 414, 390];

/** Ten seconds, well past the one-second default, for a route that has to load its chunks. */
const PATIENCE = { timeout: 10_000 };

/** Whether the editor holds the note's text yet. */
async function editorShown(host: Element): Promise<void> {
  await waitFor(
    () => expect(host.querySelector(".cm-content")?.textContent).toContain("paragraph"),
    PATIENCE,
  );
}

/**
 * Whether the graph canvas has drawn anything past its one background fill.
 *
 * Read off the pixels, so the wait ends when the simulation has put nodes on
 * the page and not at a fixed time.
 */
function paints(host: Element): boolean {
  const canvas = host.querySelector("canvas");
  const context = canvas?.getContext("2d");
  if (!canvas || !context || canvas.width === 0) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 4; i < data.length; i += 4) {
    if (
      data[i] !== data[0] ||
      data[i + 1] !== data[1] ||
      data[i + 2] !== data[2] ||
      data[i + 3] !== data[3]
    ) {
      return true;
    }
  }
  return false;
}

/** Mount the route at `entry` in one size and theme, picture it, and take it down. */
async function draw(
  name: string,
  size: (typeof SIZES)[number],
  entry: string,
  vim: string | null,
  ready: Ready,
): Promise<number> {
  await page.viewport(size.width, size.height);
  stubMatchMedia({ [NARROW]: size.width < 768, [COARSE]: size.coarse });
  // Each picture is a device of its own, or the layout the last one left
  // would be the layout this one starts on.
  localStorage.clear();
  if (vim !== null) localStorage.setItem(VIM_KEY, vim);

  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [entry] }),
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
    await ready(host, size);
    return await shot(host, name);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

/** One picture per theme and size, each answering its width. */
async function pictures(
  screen: string,
  entry: string,
  vim: string | null,
  ready: Ready,
): Promise<number[]> {
  const widths: number[] = [];
  for (const theme of THEMES) {
    document.documentElement.dataset.theme = theme;
    for (const size of SIZES) {
      widths.push(await draw(`${screen}-${size.name}-${theme}`, size, entry, vim, ready));
    }
  }
  return widths;
}

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
});

afterEach(async () => {
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
  vi.unstubAllGlobals();
  await page.viewport(1280, 900);
});

it("pictures the home screen in light and dark", async () => {
  const widths = await pictures("home", "/", null, async (host, size) => {
    // Below 768px the tree is a drawer that starts shut, so there is no file
    // list to wait for. The status bar marks the route as drawn either way.
    await waitFor(() => {
      expect(host.querySelector("[data-testid='version']")).not.toBeNull();
      if (size.width >= 768) expect(host.textContent).toContain("Lesson");
    }, PATIENCE);
  });
  expect(widths).toEqual(EXPECTED);
}, 120_000);

it("pictures a note in light and dark", async () => {
  const widths = await pictures("note", "/?note=Lesson.md", "off", editorShown);
  expect(widths).toEqual(EXPECTED);
}, 120_000);

it("pictures the editor in light and dark", async () => {
  const widths = await pictures("editor", "/?note=Lesson.md&line=3", "on", async (host) => {
    await editorShown(host);
    // Vim's visual mode over the first words of the paragraph, so the picture
    // shows a selection as well as the cursor.
    const editor = host.querySelector(".cm-content") as HTMLElement;
    editor.focus();
    for (const key of ["v", "e", "e"]) fireEvent.keyDown(editor, { key });
  });
  expect(widths).toEqual(EXPECTED);
}, 120_000);

it("pictures the graph in light and dark", async () => {
  const widths = await pictures("graph", "/?note=Lesson.md", "on", async (host) => {
    await editorShown(host);
    // The leader sequence `gg`, which opens the graph of the whole vault in
    // the focused pane, pressed on the editor as a reader presses it.
    const editor = host.querySelector(".cm-content") as HTMLElement;
    editor.focus();
    for (const key of [" ", "g", "g"]) {
      fireEvent.keyDown(editor, { key });
      fireEvent.keyUp(editor, { key });
    }
    await waitFor(() => expect(host.textContent).toContain("6 notes, 5 links"), PATIENCE);
    await waitFor(() => expect(paints(host)).toBe(true), PATIENCE);
  });
  expect(widths).toEqual(EXPECTED);
}, 120_000);
