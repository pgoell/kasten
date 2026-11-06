import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { openBeside } from "@/lib/panes/layout/pane-contents";
import {
  activeTab,
  emptyLayout,
  fillFocused,
  focusedPane,
  focusPane,
  isEmptyTab,
  type Layout,
  removeFocused,
  tabPanes,
} from "@/lib/panes/layout/panes";
import { usePaneCommands } from "@/lib/panes/layout/use-pane-commands";

const NOTE = "ideas/rag.md";
const PERSON = "people/ada.md";
const client = new QueryClient();

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// The note pane is closed, leaving the pane beside it as the lone focused pane.
function withoutNote(layout: Layout): Layout {
  const note = tabPanes(layout).find((pane) => pane.path === NOTE);
  if (note === undefined) throw new Error("no note pane to take away");
  return removeFocused(focusPane(layout, note.id));
}

// The leader's `q` names `closeNote`, so the command is run as the key runs it.
async function closeFocused(
  start: Layout,
  flushBook = vi.fn(async (_note: string) => {}),
  order: string[] = [],
) {
  const moveTo = vi.fn((_update: (previous: Layout) => Layout) => {
    order.push("moved");
    return true;
  });
  const saveFirst = vi.fn(async () => true);
  const { result } = renderHook(
    () =>
      usePaneCommands({
        pane: focusedPane(start),
        setLayout: vi.fn(),
        saveFirst,
        moves: { moveTo, focusToward: vi.fn(), shiftToward: vi.fn() },
        openPeriodic: vi.fn(),
        setNotice: vi.fn(),
        paths: [],
        focusedNote: { current: { path: undefined, isWriting: () => false } },
        flushBook,
      }),
    { wrapper },
  );
  await result.current.commands.closeNote();
  const layout = moveTo.mock.calls[0]?.[0](start) as Layout;
  return { layout, saveFirst };
}

function expectEmptiedInPlace(start: Layout, layout: Layout) {
  expect(layout.tabs).toHaveLength(1);
  expect(focusedPane(layout).id).toBe(focusedPane(start).id);
  expect(isEmptyTab(activeTab(layout))).toBe(true);
}

// Closed in a split, as Obsidian closes a split's last view: the note beside takes the focus (#1605).
function expectClosedBeside(start: Layout, layout: Layout) {
  const panes = tabPanes(layout);
  expect(panes.map((pane) => pane.id)).not.toContain(focusedPane(start).id);
  expect(panes).toHaveLength(tabPanes(start).length - 1);
  expect(focusedPane(layout).path).toBe(NOTE);
}

it("A1 q on a lone graph pane empties it and shows Today", async () => {
  const start = fillFocused(emptyLayout(), { graph: {} });
  expect(focusedPane(start).graph).toBeDefined();

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).not.toHaveBeenCalled();
  expectEmptiedInPlace(start, layout);
});

it("A2 q on a graph beside a note closes that pane and focuses the note", async () => {
  const start = openBeside(
    emptyLayout(NOTE),
    (pane) => pane.graph?.around === NOTE,
    { graph: { around: NOTE } },
    "row",
  );
  expect(focusedPane(start).graph?.around).toBe(NOTE);

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).not.toHaveBeenCalled();
  expectClosedBeside(start, layout);
});

it("A3 q on a lone history pane empties it and shows Today", async () => {
  const start = withoutNote(
    openBeside(emptyLayout(NOTE), (pane) => pane.history === NOTE, { history: NOTE }, "row"),
  );
  expect(focusedPane(start).history).toBe(NOTE);

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).not.toHaveBeenCalled();
  expectEmptiedInPlace(start, layout);
});

it("A4 q on a history beside a note closes that pane and focuses the note", async () => {
  const start = openBeside(
    emptyLayout(NOTE),
    (pane) => pane.history === NOTE,
    { history: NOTE },
    "row",
  );
  expect(focusedPane(start).history).toBe(NOTE);

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).not.toHaveBeenCalled();
  expectClosedBeside(start, layout);
});

it("A5 q on a lone person pane empties it and shows Today", async () => {
  const start = withoutNote(
    openBeside(emptyLayout(NOTE), (pane) => pane.person === PERSON, { person: PERSON }, "row"),
  );
  expect(focusedPane(start).person).toBe(PERSON);

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).not.toHaveBeenCalled();
  expectEmptiedInPlace(start, layout);
});

it("A6 q on a person beside a note closes that pane and focuses the note", async () => {
  const start = openBeside(
    emptyLayout(NOTE),
    (pane) => pane.person === PERSON,
    { person: PERSON },
    "row",
  );
  expect(focusedPane(start).person).toBe(PERSON);

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).not.toHaveBeenCalled();
  expectClosedBeside(start, layout);
});

it("#978 q on a note saves it first, then empties the pane", async () => {
  const start = emptyLayout(NOTE);

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).toHaveBeenCalledTimes(1);
  expectEmptiedInPlace(start, layout);
});

it("#1605 q on a book beside a note closes that pane and focuses the note", async () => {
  const start = openBeside(emptyLayout(NOTE), (pane) => pane.book === NOTE, { book: NOTE }, "row");
  expect(focusedPane(start).book).toBe(NOTE);

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).not.toHaveBeenCalled();
  expectClosedBeside(start, layout);
});

it("#1605 q on a lone book pane empties it and shows Today", async () => {
  const start = withoutNote(
    openBeside(emptyLayout(NOTE), (pane) => pane.book === NOTE, { book: NOTE }, "row"),
  );
  expect(focusedPane(start).book).toBe(NOTE);

  const { layout } = await closeFocused(start);

  expectEmptiedInPlace(start, layout);
});

it("#1605 a note beside a book still empties first, keeping its pane", async () => {
  const start = openBeside(emptyLayout(NOTE), (pane) => pane.book === NOTE, { book: NOTE }, "row");
  const note = tabPanes(start).find((pane) => pane.path === NOTE);
  if (note === undefined) throw new Error("no note pane");
  const focused = focusPane(start, note.id);

  const { layout } = await closeFocused(focused);

  expect(tabPanes(layout).map((pane) => pane.id)).toEqual(tabPanes(focused).map((pane) => pane.id));
  expect(focusedPane(layout).path).toBeUndefined();
});

it("#1605 Ctrl+Shift+Q on a terminal beside a note empties it, never removes it", async () => {
  const start = openBeside(emptyLayout(NOTE), () => false, { term: "main" }, "row");
  expect(focusedPane(start).term).toBe("main");

  const { layout } = await closeFocused(start);

  expect(tabPanes(layout).map((pane) => pane.id)).toEqual(tabPanes(start).map((pane) => pane.id));
  expect(focusedPane(layout).id).toBe(focusedPane(start).id);
  expect(focusedPane(layout).term).toBeUndefined();
});

it("#1605 q on a book writes its place before the note beside takes the focus", async () => {
  const start = openBeside(emptyLayout(NOTE), (pane) => pane.book === NOTE, { book: NOTE }, "row");
  const order: string[] = [];
  const flushBook = vi.fn(async (note: string) => {
    await Promise.resolve();
    order.push(`flush ${note}`);
  });

  const { layout } = await closeFocused(start, flushBook, order);

  expect(order).toEqual([`flush ${NOTE}`, "moved"]);
  expectClosedBeside(start, layout);
});
