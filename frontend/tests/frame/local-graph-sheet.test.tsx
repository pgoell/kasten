/**
 * `Space g l` on a note opens its local graph. On a phone the graph is the
 * bottom sheet over the window (#798, S11); on a desktop it is a pane beside the
 * note when the pane is wide (I7), and the 540 px side sheet over the note when
 * the margin is not there (A9).
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
import { page, userEvent } from "vitest/browser";
import { fetchMentions } from "@/lib/api";
import { fetchGraph } from "@/lib/graph-api";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { closeTree, leader, need, nextFrame, PATIENCE, visibleEditor } from "./reader-fixture";
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
    fetchMentions: vi.fn(async () => MENTIONS),
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(async () => GRAPH),
}));

/** A stream that never says anything, so the route opens no connection. */
class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

/** Mounts the route on Lesson.md with vim as asked, and waits for its text. */
async function mountLesson(host: HTMLElement, vim: "on" | "off" = "on") {
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
function pressSpaceGL(host: HTMLElement) {
  const editor = host.querySelector(".cm-content") as HTMLElement;
  editor.focus();
  for (const key of [" ", "g", "l"]) {
    fireEvent.keyDown(editor, { key });
    fireEvent.keyUp(editor, { key });
  }
}

const sheet = () =>
  document.querySelector<HTMLElement>("[role='dialog'][aria-label='Local graph']");

/** The Graph button in the note's head, which the margin's width hides. */
const graphButton = (host: HTMLElement) =>
  need(host.querySelector<HTMLElement>("[data-head='graph']"), "graph button");

/** The reader of the pane on screen, which the side sheet sits in. */
const readerOf = (host: HTMLElement) =>
  need(host.querySelector<HTMLElement>("[data-reader]"), "reader");

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
  vi.mocked(fetchGraph).mockClear();
  vi.mocked(fetchMentions).mockClear();
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

it("A12 on a phone a tap outside the graph sheet closes it, the sheet leaving downwards, and the focus is back on the note", async () => {
  await page.viewport(390, 844);
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    pressSpaceGL(host);
    await waitFor(() => expect(sheet()).not.toBeNull(), { timeout: 5000 });
    const panel = sheet() as HTMLElement;

    // Every transform the panel is given while it leaves, read as the spring writes them.
    const offsets: string[] = [];
    const watch = new MutationObserver(() => offsets.push(panel.style.transform));
    watch.observe(panel, { attributes: true, attributeFilter: ["style"] });
    (panel.previousElementSibling as HTMLElement).click();

    await waitFor(() => expect(sheet()).toBeNull(), { timeout: 5000 });
    watch.disconnect();
    // The browser writes the value back as `translate3d(0px, Npx, 0px)`.
    const moved = offsets.map((each) => /translate3d\(0px, ([0-9.]+)px, 0px\)/.exec(each)?.[1]);
    expect(moved.some((px) => px !== undefined && Number(px) > 0)).toBe(true);
    expect(document.activeElement).toBe(host.querySelector(".cm-content"));
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("I2 in a wide pane Space g l opens the graph as a pane beside the note and no sheet", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    // The tree folded, so the pane is 1320 px or more and the margin would show.
    await closeTree(host);
    await nextFrame();
    await nextFrame();
    pressSpaceGL(host);

    // The graph lands in a second pane beside the note, which is the desktop's answer.
    await waitFor(() => expect(host.querySelectorAll("[data-pane]").length).toBe(2), PATIENCE);
    expect(host.textContent).toContain("Lesson depth 1");
    expect(sheet()).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A9 in a narrow pane Space g l opens the 540 px side sheet over the note, with the graph and lists", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    // The tree is open at 1440, so the pane is under 1320 px and the margin is hidden.
    const reader = readerOf(host);
    expect(reader.getBoundingClientRect().width).toBeLessThan(1320);

    pressSpaceGL(host);
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    const panel = sheet() as HTMLElement;
    // The panel slides in from the edge, so its right edge is checked once it rests.
    await expect
      .poll(() =>
        Math.abs(panel.getBoundingClientRect().right - reader.getBoundingClientRect().right),
      )
      .toBeLessThan(1);

    expect(panel.getBoundingClientRect().width).toBeCloseTo(540, 0);
    expect(panel.textContent).toContain("Links");
    expect(panel.textContent).toContain("Backlinks");
    expect(panel.textContent).toContain("Unlinked mentions");
    expect(panel.querySelector("canvas")).not.toBeNull();
    expect(host.querySelectorAll("[data-pane]").length).toBe(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A8 in a narrow pane the Graph button beside the path opens the side sheet", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    const button = graphButton(host);
    expect(getComputedStyle(button).display).not.toBe("none");

    // A script's click does not move the focus, so the note keeps it, as a press in the note leaves it.
    visibleEditor(host).focus();
    button.click();

    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    expect(sheet()?.getBoundingClientRect().width).toBeCloseTo(540, 0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A10 with vim on, Esc closes the side sheet and the note takes keys in normal mode", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host, "on");
  try {
    pressSpaceGL(host);
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(sheet()).toBeNull(), PATIENCE);
    expect(document.activeElement).toBe(host.querySelector(".cm-content"));

    // `j` onto the blank line and `j` again onto the paragraph, then `x` deletes its first
    // letter. In insert mode the two letters would be typed instead, and the text would grow.
    const editor = visibleEditor(host);
    const before = editor.textContent ?? "";
    await userEvent.keyboard("j");
    await userEvent.keyboard("j");
    await userEvent.keyboard("x");
    expect((editor.textContent ?? "").length).toBe(before.length - 1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A10 with vim off, Esc closes the side sheet and typing goes into the note", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host, "off");
  try {
    // With vim off the leader is not wired, so the Graph button opens the sheet.
    visibleEditor(host).focus();
    graphButton(host).click();
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(sheet()).toBeNull(), PATIENCE);
    expect(document.activeElement).toBe(host.querySelector(".cm-content"));
    await userEvent.keyboard("Q");
    expect(visibleEditor(host).textContent).toContain("Q");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A10 a click outside the side sheet closes it", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    pressSpaceGL(host);
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    const panel = sheet() as HTMLElement;
    // The scrim is the element the panel sits after.
    (panel.previousElementSibling as HTMLElement).click();

    await waitFor(() => expect(sheet()).toBeNull(), PATIENCE);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A11 at 1440 with the tree open no graph is asked, no mentions read and no canvas made until the sheet opens", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    // The note has loaded: nothing has asked for the graph.
    expect(vi.mocked(fetchGraph)).toHaveBeenCalledTimes(0);
    expect(vi.mocked(fetchMentions)).toHaveBeenCalledTimes(0);
    expect(document.querySelectorAll("canvas").length).toBe(0);

    pressSpaceGL(host);
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    await waitFor(() => expect(vi.mocked(fetchGraph)).toHaveBeenCalledTimes(1), PATIENCE);
    expect(vi.mocked(fetchMentions)).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.querySelectorAll("canvas").length).toBe(1), PATIENCE);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A7 in a wide pane the margin shows the graph and the Graph button is hidden; in a narrow one the margin is hidden and the button shows", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    // The tree open: the pane is narrow, so the margin is hidden and the button is there.
    const narrowMargin = need(host.querySelector<HTMLElement>("[data-margin='links']"), "margin");
    expect(getComputedStyle(narrowMargin).display).toBe("none");
    expect(getComputedStyle(graphButton(host)).display).not.toBe("none");

    await closeTree(host);

    const wideMargin = need(host.querySelector<HTMLElement>("[data-margin='links']"), "margin");
    expect(getComputedStyle(wideMargin).display).not.toBe("none");
    expect(getComputedStyle(graphButton(host)).display).toBe("none");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A5 in a split of two wide panes each margin draws its own note", async () => {
  await page.viewport(2900, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    await closeTree(host);
    // The split's new pane is empty: no note, so no reader and no margin yet.
    leader(host, [" ", "%"]);
    await waitFor(
      () => expect(host.querySelectorAll(".cm-content").length).toBeGreaterThan(1),
      PATIENCE,
    );
    // A click in the empty pane takes the focus into it, so the row below opens there.
    await userEvent.click(need(host.querySelectorAll<HTMLElement>(".cm-content")[1], "empty pane"));
    await nextFrame();

    // A row of the left margin opens Design Notes in the focused pane, the empty one on the
    // right. Then the left margin still draws Lesson and the right one draws Design Notes.
    // The row is drawn once the left margin's graph has answered, so the test waits for it.
    const rowNamed = () =>
      [
        ...(host
          .querySelectorAll<HTMLElement>("[data-reader]")[0]
          ?.querySelectorAll<HTMLElement>("[data-margin='links'] button") ?? []),
      ].find((each) => each.textContent === "Design Notes");
    await waitFor(() => expect(rowNamed()).toBeDefined(), PATIENCE);
    need(rowNamed(), "Design Notes row").click();
    await waitFor(
      () =>
        expect(
          host.querySelectorAll("[data-reader]")[1]?.querySelector(".cm-content")?.textContent,
        ).toContain("Design Notes"),
      PATIENCE,
    );

    await waitFor(
      () => expect(host.querySelectorAll("[data-margin='links'] canvas").length).toBe(2),
      PATIENCE,
    );
    const asked = vi.mocked(fetchGraph).mock.calls.map(([ask]) => ask.around);
    expect(asked).toContain("Lesson.md");
    expect(asked).toContain("Design Notes.md");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A12 on a phone the Graph button opens the bottom sheet from the foot of the screen", async () => {
  await page.viewport(390, 844);
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    visibleEditor(host).focus();
    graphButton(host).click();
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    const panel = sheet() as HTMLElement;

    await expect.poll(() => Math.round(panel.getBoundingClientRect().bottom)).toBe(844);
    expect(Math.round(panel.getBoundingClientRect().width)).toBe(390);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("I8 a pane that grows past 1320 px with the side sheet open closes the sheet", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    pressSpaceGL(host);
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);

    // Folding the tree widens the pane past 1320 px: the margin takes the graph's place.
    await closeTree(host);

    await waitFor(() => expect(sheet()).toBeNull(), PATIENCE);
    const margin = need(host.querySelector<HTMLElement>("[data-margin='links']"), "margin");
    expect(getComputedStyle(margin).display).not.toBe("none");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
