/**
 * `Space g l` on a note opens its local graph. On a phone the graph is a sheet
 * over the window (#798, S11); on a desktop it is a pane beside the note (I7).
 *
 * The route is mounted over a router the way `theme-shots.test.tsx` mounts it,
 * with the api answered from a small vault here.
 */

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
import "@/styles/app.css";

const VIM_KEY = "kasten.vim";
const FILES = ["Lesson.md", "Design Notes.md"];
const LESSON = ["# Lesson", "", "A paragraph of the lesson.", "", "- [ ] write the tests"].join(
  "\n",
);

const EMPTY_GRAPH = { nodes: [], edges: [], columns: [], rows: [], truncated: false };

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
  fetchGraph: async () => EMPTY_GRAPH,
}));

/** A stream that never says anything, so the route opens no connection. */
class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

/** Mounts the route on Lesson.md with vim on, and waits for its text. */
async function mountLesson(host: HTMLElement) {
  localStorage.setItem(VIM_KEY, "on");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/?note=Lesson.md"] }),
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
    () => expect(host.querySelector(".cm-content")?.textContent).toContain("paragraph"),
    { timeout: 10_000 },
  );
  return root;
}

/** The leader sequence `Space g l`, pressed on the editor as a reader presses it. */
function pressSpaceGL(host: HTMLElement) {
  const editor = host.querySelector(".cm-content") as HTMLElement;
  editor.focus();
  for (const key of [" ", "g", "l"]) {
    fireEvent.keyDown(editor, { key });
    fireEvent.keyUp(editor, { key });
  }
}

const sheet = () => document.querySelector("[role='dialog'][aria-label='Local graph']");

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("on a phone, Space g l opens the local graph as a sheet and no pane", async () => {
  await page.viewport(390, 844);
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    const tabsBefore = host.querySelectorAll("[role='tab']").length;

    pressSpaceGL(host);

    await waitFor(() => expect(sheet()).not.toBeNull(), { timeout: 5000 });
    expect(host.querySelectorAll("[role='tab']").length).toBe(tabsBefore);
    expect(host.textContent).not.toContain("graph of Lesson");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("on a desktop, Space g l opens the graph as a pane beside the note and no sheet", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    pressSpaceGL(host);

    // The graph lands in a second pane beside the note, which is the desktop's answer.
    await waitFor(() => expect(host.querySelectorAll("[data-pane]").length).toBe(2), {
      timeout: 5000,
    });
    expect(host.textContent).toContain("Lesson depth 1");
    expect(sheet()).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
