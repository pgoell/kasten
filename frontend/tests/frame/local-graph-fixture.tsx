/**
 * The local graph's frame tests share this rig: a small vault with Lesson.md open,
 * the route mounted over a router, and the `Space g l` press. The `vi.mock` calls stay
 * in each test file, since vitest hoists them there and they return `vi.fn()`s here;
 * `registerLessonFixture` gives each one its answer before every test.
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
import { fetchFiles, fetchMentions, fetchNote, NoteMissing } from "@/lib/api";
import { fetchGraph } from "@/lib/graph-api";
import { routeTree } from "@/routeTree.gen";
import { need } from "./reader-fixture";
import "@/styles/app.css";

const VIM_KEY = "kasten.vim";
const FILES = ["Lesson.md", "Design Notes.md"];
const LESSON = ["# Lesson", "", "A paragraph of the lesson.", "", "- [ ] write the tests"].join(
  "\n",
);

/** The note, three notes it links to (two with tags), one backlink and one unwritten link. */
const GRAPH = {
  nodes: [
    { path: "Lesson.md", name: "Lesson", type: "Concept", tags: ["reading"], missing: false },
    {
      path: "Design Notes.md",
      name: "Design Notes",
      type: "Concept",
      tags: ["design"],
      missing: false,
    },
    { path: "Tokens.md", name: "Tokens", type: "Reference", tags: ["tokens"], missing: false },
    { path: "Redesign.md", name: "Redesign", type: "Project", tags: ["design"], missing: false },
    { path: "Ghost.md", name: "Ghost", type: null, tags: [], missing: true },
    { path: "Today.md", name: "Today", type: null, tags: [], missing: false },
  ],
  edges: [
    { source: "Lesson.md", target: "Design Notes.md", relation: null, line: 5 },
    { source: "Lesson.md", target: "Tokens.md", relation: null, line: 6 },
    { source: "Lesson.md", target: "Redesign.md", relation: null, line: 7 },
    { source: "Lesson.md", target: "Ghost.md", relation: null, line: 8 },
    { source: "Today.md", target: "Lesson.md", relation: null, line: 3 },
  ],
  columns: [],
  rows: [],
  truncated: false,
};

/** One unlinked mention of the note, in another note. */
const MENTIONS = [
  { path: "Design Notes.md", line: 3, text: "about lesson", start: 6, end: 12, name: "Lesson" },
];

/** A stream that never says anything, so the route opens no connection. */
class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

/** The hooks every local graph test shares: the answers, and the put-back after each. */
export function registerLessonFixture() {
  beforeEach(() => {
    vi.stubGlobal("EventSource", SilentEventSource);
    vi.mocked(fetchFiles).mockImplementation(async () => FILES);
    vi.mocked(fetchNote).mockImplementation(async (path: string) => {
      if (path === "Lesson.md") return LESSON;
      if (path === "Design Notes.md") return "# Design Notes\n";
      throw new NoteMissing(path);
    });
    vi.mocked(fetchGraph).mockImplementation(async () => GRAPH);
    vi.mocked(fetchMentions).mockImplementation(async () => MENTIONS);
    vi.mocked(fetchGraph).mockClear();
    vi.mocked(fetchMentions).mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });
}

/** Mounts the route on Lesson.md with vim as asked, and waits for its text. */
export async function mountLesson(host: HTMLElement, vim: "on" | "off" = "on") {
  localStorage.setItem(VIM_KEY, vim);
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
export function pressSpaceGL(host: HTMLElement) {
  const editor = host.querySelector(".cm-content") as HTMLElement;
  editor.focus();
  for (const key of [" ", "g", "l"]) {
    fireEvent.keyDown(editor, { key });
    fireEvent.keyUp(editor, { key });
  }
}

/** The local graph's dialog, when one is on screen. */
export const sheet = () =>
  document.querySelector<HTMLElement>("[role='dialog'][aria-label='Local graph']");

/** The Graph button in the note's head, which the margin's width hides. */
export const graphButton = (host: HTMLElement) =>
  need(host.querySelector<HTMLElement>("[data-head='graph']"), "graph button");

/** The reader of the pane on screen, which the side sheet sits in. */
export const readerOf = (host: HTMLElement) =>
  need(host.querySelector<HTMLElement>("[data-reader]"), "reader");
