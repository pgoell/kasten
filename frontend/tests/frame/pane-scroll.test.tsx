/**
 * A13: each pane of a split scrolls on its own, and keeps its scroll when the
 * focus moves, when the pane is zoomed and when the zoom is put back.
 *
 * The split is seeded in storage the way a reload finds it, with a long note in
 * each pane, rather than made with `Space %`: a split makes an empty pane, and
 * the note for it would need a second open. `Space %` itself is proved by the
 * route tests named in the checklist.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { fetchNote, NoteMissing } from "@/lib/api";
import { startPress } from "@/lib/press";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import {
  DESKTOP,
  type Mounted,
  need,
  PATIENCE,
  registerReaderFixture,
  unmount,
  visibleEditor,
} from "./reader-fixture";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: async (path: string, content: string) => ({ path, content }),
    searchNotes: vi.fn(),
    fetchTodos: vi.fn(),
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerReaderFixture();

// The keys the fixture's helpers use, which the fixture does not export.
const VIM_KEY = "kasten.vim";
const WORKSPACE_KEY = "kasten.workspace.1";

/** Two hundred lines a note, which scrolls well past the 600 px the tests use. */
function longNote(name: string): string {
  return Array.from(
    { length: 200 },
    (_, index) => `${name} line ${index + 1}, a line of text.`,
  ).join("\n");
}

const LONG: Record<string, string> = {
  "Long A.md": longNote("Long A"),
  "Long B.md": longNote("Long B"),
};

// One tab, split side by side, a long note in each pane, the first one focused.
const SPLIT = {
  layout: {
    tabs: [
      {
        id: "t1",
        root: {
          dir: "row",
          id: "s1",
          children: [
            { id: "p1", path: "Long A.md" },
            { id: "p2", path: "Long B.md" },
          ],
        },
        focus: "p1",
      },
    ],
    active: 0,
  },
  treeOpen: false,
};

beforeEach(() => {
  vi.mocked(fetchNote).mockImplementation(async (path: string) => {
    const text = LONG[path];
    if (text === undefined) throw new NoteMissing(path);
    return text;
  });
});

/** The route at `/`, restored from the split above, with both panes on screen. */
async function mountSplit(): Promise<Mounted> {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  stubMatchMedia({ [NARROW]: false, [COARSE]: false });
  localStorage.clear();
  localStorage.setItem(VIM_KEY, "on");
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(SPLIT));

  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await act(async () => {
    await router.load();
  });
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
  await waitFor(
    () => expect(visibleEditor(host).textContent).toContain("Long A line 1,"),
    PATIENCE,
  );
  await waitFor(() => expect(host.textContent).toContain("Long B line 1,"), PATIENCE);
  return { host, root, stop: startPress() };
}

/** The editor text of the pane holding the note called `name`. */
function contentOf(host: HTMLElement, name: string): HTMLElement {
  return need(
    [...host.querySelectorAll<HTMLElement>(".cm-content")].find((one) =>
      one.textContent?.includes(`${name} line 1,`),
    ),
    `editor of ${name}`,
  );
}

/** The scroller of the pane holding the note called `name`. */
function scrollerOf(host: HTMLElement, name: string): HTMLElement {
  return need(contentOf(host, name).closest<HTMLElement>(".cm-scroller"), `scroller of ${name}`);
}

/**
 * A leader sequence pressed on the editor that has the browser's focus, which
 * is the pane the focus is in. `leader` from the fixture focuses the first
 * editor on screen, and that is pane A whichever pane has the focus.
 */
function pressLeader(keys: string[]) {
  const target = document.activeElement as HTMLElement;
  for (const key of keys) {
    fireEvent.keyDown(target, { key });
    fireEvent.keyUp(target, { key });
  }
}

/** Both panes scrolled to their own places: A to 600, B to 400. */
function scrollBoth(host: HTMLElement) {
  scrollerOf(host, "Long A").scrollTop = 600;
  scrollerOf(host, "Long B").scrollTop = 400;
  expect(scrollerOf(host, "Long A").scrollTop).toBe(600);
  expect(scrollerOf(host, "Long B").scrollTop).toBe(400);
}

it("A13 each pane keeps its own scroll when the focus moves between them", async () => {
  const mounted = await mountSplit();
  try {
    const { host } = mounted;
    scrollBoth(host);
    contentOf(host, "Long A").focus();

    pressLeader([" ", "o"]);
    pressLeader([" ", "o"]);

    expect(scrollerOf(host, "Long A").scrollTop).toBe(600);
    expect(scrollerOf(host, "Long B").scrollTop).toBe(400);
  } finally {
    await unmount(mounted);
  }
});

it("A13 zooming a pane in and out keeps the other pane's scroll", async () => {
  const mounted = await mountSplit();
  try {
    const { host } = mounted;
    scrollBoth(host);
    contentOf(host, "Long A").focus();

    pressLeader([" ", "z"]);
    pressLeader([" ", "z"]);

    expect(scrollerOf(host, "Long A").scrollTop).toBe(600);
    expect(scrollerOf(host, "Long B").scrollTop).toBe(400);
  } finally {
    await unmount(mounted);
  }
});

it("A13 a move out of a zoom keeps the other pane's scroll", async () => {
  const mounted = await mountSplit();
  try {
    const { host } = mounted;
    scrollBoth(host);
    contentOf(host, "Long A").focus();

    pressLeader([" ", "z"]);
    pressLeader([" ", "o"]);

    expect(scrollerOf(host, "Long B").scrollTop).toBe(400);
    expect(scrollerOf(host, "Long A").scrollTop).toBe(600);
  } finally {
    await unmount(mounted);
  }
});
