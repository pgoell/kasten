/**
 * The reader and Today frame tests' rig: the vault they open, the mounts at
 * each size, the leader and the editor helpers, and the picture helper.
 *
 * The `vi.mock` calls stay in each test file, because vitest hoists them there.
 * They make the api functions `vi.fn()`s, and `registerReaderFixture` gives
 * each one its answer here, before every test.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { fetchFiles, fetchNote, fetchTodos, NoteMissing, searchNotes } from "@/lib/api";
import { fetchGraph } from "@/lib/graph-api";
import { startPress } from "@/lib/press";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { shot } from "./shots";
import "@/styles/app.css";

const VIM_KEY = "kasten.vim";
export const READER = "02 Projects/Kasten/Reader.md";

/** The note's lines, in order, so the graph's line numbers are read off the text itself. */
const READER_LINES = [
  "---",
  "id: reader-note",
  "created: 2026-10-01T09:00:00+00:00",
  "modified: 2026-10-21T10:00:00+00:00",
  "type: Concept",
  "tags: [design, reading]",
  "---",
  "# Reader",
  "",
  "about:: [[Design Notes]]",
  "part-of:: [[Redesign]]",
  "",
  "A paragraph that opens the note, with a [[Design Notes]] link, some **bold** words and enough text to wrap across the reading measure.",
  "",
  "## First section",
  "",
  ...paragraphs("First"),
  "## Second section",
  "",
  ...paragraphs("Second"),
  "## Third section",
  "",
  "### Detail under the third",
  "",
  ...paragraphs("Third"),
];

/** Twelve paragraphs under a heading, so the note is long enough to scroll. */
function paragraphs(name: string): string[] {
  return Array.from({ length: 12 }, (_, index) => [
    `${name} paragraph ${index + 1}, with words enough to wrap across the measure and back.`,
    "",
  ]).flat();
}

const READER_TEXT = READER_LINES.join("\n");
const lineWith = (part: string) => READER_LINES.findIndex((line) => line.includes(part)) + 1;

const NOTES: Record<string, string> = {
  [READER]: READER_TEXT,
  "Design Notes.md": "# Design Notes\n",
  "Redesign.md": "# Redesign\n",
  "Today.md": "# Today\n",
  "Tokens.md": "# Tokens\n",
};

// The note links out to two notes and is linked from two.
const GRAPH = {
  nodes: [
    { path: READER, name: "Reader", type: "Concept", tags: [], missing: false },
    { path: "Design Notes.md", name: "Design Notes", type: "Concept", tags: [], missing: false },
    { path: "Redesign.md", name: "Redesign", type: "Project", tags: [], missing: false },
    { path: "Today.md", name: "Today", type: null, tags: [], missing: false },
    { path: "Tokens.md", name: "Tokens", type: "Reference", tags: [], missing: false },
  ],
  edges: [
    {
      source: READER,
      target: "Design Notes.md",
      relation: "about",
      line: lineWith("about::"),
    },
    { source: READER, target: "Redesign.md", relation: "part-of", line: lineWith("part-of::") },
    {
      source: READER,
      target: "Design Notes.md",
      relation: null,
      line: lineWith("[[Design Notes]] link"),
    },
    { source: "Today.md", target: READER, relation: null, line: 3 },
    { source: "Tokens.md", target: READER, relation: "about", line: 4 },
  ],
  columns: [],
  rows: [],
  truncated: false,
};

// Two todos due today and one waiting, in the form `todo.ts` reads.
const TODOS = [
  { path: "Today.md", line: 3, text: "- [ ] write the outline 📅 2026-10-22", project: null },
  { path: "Today.md", line: 4, text: "- [ ] check the margins 📅 2026-10-22", project: null },
  { path: "Today.md", line: 5, text: "- [w] wait for the review", project: null },
];

// The three notes whose `modified:` stamp is this month, for the Today screen's recent column.
const MODIFIED = [
  { path: READER, line: 4, text: "modified: 2026-10-21T10:00:00+00:00" },
  { path: "Design Notes.md", line: 3, text: "modified: 2026-10-20T08:00:00+00:00" },
  { path: "Redesign.md", line: 3, text: "modified: 2026-10-19T08:00:00+00:00" },
];

/** A stream that never says anything, so the route opens no connection. */
class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

export const DESKTOP = { name: "desktop-1440", width: 1440, height: 900, coarse: false };
export const TOUCH = { name: "touch-390", width: 390, height: 844, coarse: true };
export type Size = typeof DESKTOP;
export type Theme = "light" | "dark";

export const PATIENCE = { timeout: 10_000 };

export interface Mounted {
  host: HTMLElement;
  root: Root;
  stop: () => void;
}

/** Whether this test changed the emulated media, so the afterEach knows to put it back. */
let emulated = false;

/**
 * Mounts the route at one size, in one theme, with vim on, and waits for the
 * `ready` selector. The note is opened by `?note=` and the empty pane by `/`.
 */
export async function mount(
  size: Size,
  theme: Theme,
  route: string,
  ready: string,
  storage: Record<string, string> = {},
): Promise<Mounted> {
  await page.viewport(size.width, size.height);
  await commands.emulateMedia({
    touch: size.coarse,
    reducedMotion: "no-preference",
    contrast: "no-preference",
    reducedTransparency: "no-preference",
  });
  emulated = true;
  // The stub answers every query it is not given with no, so the app reads the
  // width and the pointer through this stub, not the browser's own answer.
  stubMatchMedia({
    [NARROW]: size.width < 768,
    [COARSE]: size.coarse,
  });
  localStorage.clear();
  localStorage.setItem(VIM_KEY, "on");
  // A saved workspace for the route to restore, read when the route first renders.
  for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
  document.documentElement.dataset.theme = theme;

  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [route] }),
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
  await waitFor(() => expect(host.querySelector(ready)).not.toBeNull(), PATIENCE);
  return { host, root, stop: startPress() };
}

/** The reader on Reader.md, with its text in the editor. */
export async function mountNote(size: Size, theme: Theme): Promise<Mounted> {
  const mounted = await mount(
    size,
    theme,
    `/?note=${encodeURIComponent(READER)}`,
    "[data-reader-grid]",
  );
  await waitFor(
    () => expect(visibleEditor(mounted.host).textContent).toContain("paragraph"),
    PATIENCE,
  );
  return mounted;
}

/** The empty pane, which shows Today above its editor. */
export function mountToday(size: Size, theme: Theme): Promise<Mounted> {
  return mount(size, theme, "/", "section[data-today]");
}

export async function unmount({ host, root, stop }: Mounted) {
  stop();
  await act(async () => root.unmount());
  host.remove();
}

/** The hooks every reader and Today test shares: the answers, and the put-back after each. */
export function registerReaderFixture() {
  beforeEach(() => {
    vi.stubGlobal("EventSource", SilentEventSource);
    vi.mocked(fetchFiles).mockImplementation(async () => Object.keys(NOTES));
    vi.mocked(fetchNote).mockImplementation(async (path: string) => {
      const text = NOTES[path];
      if (text === undefined) throw new NoteMissing(path);
      return text;
    });
    vi.mocked(searchNotes).mockImplementation(async (query: string) =>
      query.startsWith("modified: ") ? MODIFIED.filter((hit) => hit.text.startsWith(query)) : [],
    );
    vi.mocked(fetchTodos).mockImplementation(async () => TODOS);
    vi.mocked(fetchGraph).mockImplementation(async () => GRAPH);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    if (emulated) {
      await commands.emulateMedia({});
      emulated = false;
    }
    await page.viewport(1280, 900);
  });
}

/** A leader sequence pressed on the editor that has focus, as a reader presses it. */
export function leader(host: HTMLElement, keys: string[]) {
  const editor = visibleEditor(host);
  editor.focus();
  for (const key of keys) {
    fireEvent.keyDown(editor, { key });
    fireEvent.keyUp(editor, { key });
  }
}

/** The editor in the pane on screen. A hidden tab's editor has no box. */
export function visibleEditor(host: HTMLElement): HTMLElement {
  const editor = [...host.querySelectorAll<HTMLElement>(".cm-content")].find(
    (one) => one.offsetParent !== null,
  );
  if (!editor) throw new Error("no editor is on screen");
  return editor;
}

/**
 * Folds the file tree, which a desktop opens by default. `<leader>b` is
 * toggleTree. At 1440 with the tree open the pane is under 1320 px, so the
 * right margin would go and the desktop pictures would not show it.
 */
export async function closeTree(host: HTMLElement) {
  leader(host, [" ", "b"]);
  await waitFor(
    () =>
      expect(
        host.querySelector<HTMLElement>("[data-reader]")?.getBoundingClientRect().width ?? 0,
      ).toBeGreaterThan(1300),
    PATIENCE,
  );
}

/** Two animation frames: the first lays out the last change, the second paints it. */
export const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** A CSS value as the browser resolves it, read off a probe element, so a token compares as a colour. */
export function resolved(property: "backgroundColor" | "color", value: string): string {
  const probe = document.body.appendChild(document.createElement("div"));
  probe.style[property] = value;
  const colour = getComputedStyle(probe)[property];
  probe.remove();
  return colour;
}

/** Takes the picture, and asks the width back so a run proves its size. */
export async function picture(host: HTMLElement, name: string, size: Size): Promise<void> {
  await document.fonts.ready;
  expect(await shot(host, name)).toBe(size.width);
}

/** The element a selector found, or a plain error naming what was looked for. */
export function need<T>(found: T | null | undefined, what: string): T {
  if (!found) throw new Error(`no ${what}`);
  return found;
}

/** The scroller of the editor on screen. */
export function scrollerOf(host: HTMLElement): HTMLElement {
  return need(visibleEditor(host).closest<HTMLElement>(".cm-scroller"), "editor scroller");
}
