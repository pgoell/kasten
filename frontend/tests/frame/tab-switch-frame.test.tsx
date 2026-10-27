/**
 * A16: a tab switch paints the other tab's note in the first frame.
 *
 * Two tabs, each with a note, seeded in storage the way a reload finds them.
 * Only the active tab is drawn, so a switch mounts the other tab's editor. The
 * second tab is visited once before the measured switch, so its note is in the
 * query cache: the editor then mounts holding its text in the same render, and
 * the only thing left to wait for is its view, which is built after the commit.
 */

import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { waitFor, within } from "@testing-library/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { page, userEvent } from "vitest/browser";
import { startPress } from "@/lib/press";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import {
  DESKTOP,
  leader,
  type Mounted,
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

// The first tab holds one note, the second tab the other: `Design Notes.md` and
// `Redesign.md` are both in the fixture's vault.
const TWO_TABS = {
  layout: {
    tabs: [
      { id: "t1", root: { id: "p1", path: "Design Notes.md" }, focus: "p1" },
      { id: "t2", root: { id: "p2", path: "Redesign.md" }, focus: "p2" },
    ],
    active: 0,
  },
  treeOpen: false,
};

/** The route at `/`, restored from the two tabs above, with the first tab on screen. */
async function mountTwoTabs(workspace: typeof TWO_TABS = TWO_TABS): Promise<Mounted> {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  stubMatchMedia({ [NARROW]: false, [COARSE]: false });
  localStorage.clear();
  localStorage.setItem(VIM_KEY, "on");
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));

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
  await waitFor(() => expect(visibleEditor(host).textContent).toContain("Design Notes"), PATIENCE);
  return { host, root, stop: startPress() };
}

/**
 * The text of the editor on screen, read in the first animation frame after
 * the call. Registered synchronously, so it runs before the next paint, and an
 * empty string while no editor is drawn at all.
 */
function firstFrameText(host: HTMLElement): Promise<string> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => {
      const shown = [...host.querySelectorAll<HTMLElement>(".cm-content")].find(
        (one) => one.offsetParent !== null,
      );
      resolve(shown?.textContent ?? "");
    }),
  );
}

it("A16 a click on a tab paints the other tab's note in the first frame", async () => {
  const mounted = await mountTwoTabs();
  try {
    const { host } = mounted;
    // Warm the second note's cache by visiting it once, then come back.
    within(host)
      .getByRole("tab", { name: /Redesign/ })
      .click();
    await waitFor(() => expect(visibleEditor(host).textContent).toContain("Redesign"), PATIENCE);
    within(host)
      .getByRole("tab", { name: /Design Notes/ })
      .click();
    await waitFor(
      () => expect(visibleEditor(host).textContent).toContain("Design Notes"),
      PATIENCE,
    );

    // The measured switch: the frame is requested in the same task as the click.
    within(host)
      .getByRole("tab", { name: /Redesign/ })
      .click();
    const first = firstFrameText(host);

    expect(await first).toContain("Redesign");
  } finally {
    await unmount(mounted);
  }
});

it("A16 Space 2 paints the second tab's note in the first frame", async () => {
  const mounted = await mountTwoTabs();
  try {
    const { host } = mounted;
    leader(host, [" ", "2"]);
    await waitFor(() => expect(visibleEditor(host).textContent).toContain("Redesign"), PATIENCE);
    leader(host, [" ", "1"]);
    await waitFor(
      () => expect(visibleEditor(host).textContent).toContain("Design Notes"),
      PATIENCE,
    );

    // The measured switch: the frame is requested in the same task as the key.
    leader(host, [" ", "2"]);
    const first = firstFrameText(host);

    expect(await first).toContain("Redesign");
  } finally {
    await unmount(mounted);
  }
});

it("#983 after a tab switch the new tab's editor holds the focus and the old one takes no keys", async () => {
  const mounted = await mountTwoTabs();
  try {
    const { host } = mounted;
    leader(host, [" ", "2"]);
    await waitFor(() => expect(visibleEditor(host).textContent).toContain("Redesign"), PATIENCE);

    // Normal mode first, so `i` opens the insert and the word lands in it.
    await userEvent.keyboard("i");
    await userEvent.keyboard("zebra");

    await waitFor(() => expect(visibleEditor(host).textContent).toContain("zebra"), PATIENCE);
    // Whatever is still on the page of the old tab is not written to.
    for (const each of host.querySelectorAll<HTMLElement>(".cm-content")) {
      if (each !== visibleEditor(host)) expect(each.textContent).not.toContain("zebra");
    }
  } finally {
    await unmount(mounted);
  }
});

it("#983 the same note in two tabs opens in the second where the first left its cursor", async () => {
  const mounted = await mountTwoTabs({
    layout: {
      tabs: [
        { id: "t1", root: { id: "p1", path: "Design Notes.md" }, focus: "p1" },
        { id: "t2", root: { id: "p2", path: "Design Notes.md" }, focus: "p2" },
      ],
      active: 0,
    },
    treeOpen: false,
  });
  try {
    const { host } = mounted;
    const first = visibleEditor(host);
    EditorView.findFromDOM(first)?.dispatch({ selection: { anchor: 5 } });

    leader(host, [" ", "2"]);
    await waitFor(() => expect(visibleEditor(host)).not.toBe(first), PATIENCE);

    const view = EditorView.findFromDOM(visibleEditor(host));
    expect(view?.state.selection.main.head).toBe(5);
  } finally {
    await unmount(mounted);
  }
});
