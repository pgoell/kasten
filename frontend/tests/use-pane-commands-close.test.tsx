import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { openBeside } from "@/lib/panes/layout/pane-contents";
import {
  activeTab,
  addTab,
  emptyLayout,
  fillFocused,
  focusedPane,
  focusPane,
  isEmptyTab,
  type Layout,
  removeFocused,
  splitFocused,
  tabPanes,
} from "@/lib/panes/layout/panes";
import { paneOpeners, usePaneCommands } from "@/lib/panes/layout/use-pane-commands";

const NOTE = "ideas/rag.md";
type Commands = ReturnType<typeof usePaneCommands>["commands"];
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

// The close waits on the place write; whatever moves the focus meanwhile must not be what closes.
async function closeTwiceWhileWriting(start: Layout, between: (layout: Layout) => Layout) {
  let land: () => void = () => {};
  const written = new Promise<void>((resolve) => {
    land = resolve;
  });
  const moveTo = vi.fn((_update: (previous: Layout) => Layout) => true);
  const { result } = renderHook(
    () =>
      usePaneCommands({
        pane: focusedPane(start),
        setLayout: vi.fn(),
        saveFirst: vi.fn(async () => true),
        moves: { moveTo, focusToward: vi.fn(), shiftToward: vi.fn() },
        openPeriodic: vi.fn(),
        setNotice: vi.fn(),
        paths: [],
        focusedNote: { current: { path: undefined, isWriting: () => false } },
        flushBook: () => written,
      }),
    { wrapper },
  );
  const closes = [result.current.commands.closeNote(), result.current.commands.closeNote()];
  land();
  await Promise.all(closes);
  return moveTo.mock.calls.reduce((layout, [update]) => update(layout), between(start));
}

it("#1605 q twice while the place is written closes the book once and keeps the note", async () => {
  const start = openBeside(emptyLayout(NOTE), (pane) => pane.book === NOTE, { book: NOTE }, "row");

  const layout = await closeTwiceWhileWriting(start, (same) => same);

  expect(tabPanes(layout).map((pane) => pane.path)).toEqual([NOTE]);
  expect(focusedPane(layout).path).toBe(NOTE);
});

it("#1605 a focus moved to the note while the place is written still closes the book", async () => {
  const start = openBeside(emptyLayout(NOTE), (pane) => pane.book === NOTE, { book: NOTE }, "row");
  const note = tabPanes(start).find((pane) => pane.path === NOTE)?.id ?? "";

  const layout = await closeTwiceWhileWriting(start, (same) => focusPane(same, note));

  expect(tabPanes(layout).map((pane) => pane.path)).toEqual([NOTE]);
});

// Two notes side by side, the focus on the left one, where the key is pressed.
function leftOfTwo(): Layout {
  const split = fillFocused(splitFocused(emptyLayout(NOTE), "row"), { path: PERSON });
  return focusPane(split, tabPanes(split)[0]?.id ?? "");
}

// Runs a command pressed on the left pane, with the focus moved by `between` before the save answers.
async function pressedThenMoved(
  start: Layout,
  run: (commands: ReturnType<typeof usePaneCommands>["commands"]) => unknown,
  between: (layout: Layout) => Layout,
  saved = true,
) {
  let answer = (_saved: boolean) => {};
  const saveFirst = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
  );
  const moveTo = vi.fn((_update: (previous: Layout) => Layout) => true);
  const openPeriodic = vi.fn(async () => true);
  const { result } = renderHook(
    () =>
      usePaneCommands({
        pane: focusedPane(start),
        setLayout: vi.fn(),
        saveFirst,
        moves: { moveTo, focusToward: vi.fn(), shiftToward: vi.fn() },
        openPeriodic,
        setNotice: vi.fn(),
        paths: [],
        focusedNote: { current: { path: undefined, isWriting: () => false } },
        flushBook: vi.fn(async () => {}),
      }),
    { wrapper },
  );
  const pressed = run(result.current.commands);
  answer(saved);
  await pressed;
  return {
    moveTo,
    openPeriodic,
    layout: moveTo.mock.calls.reduce((layout, [update]) => update(layout), between(start)),
  };
}

const toRight = (layout: Layout) => focusPane(layout, tabPanes(layout)[1]?.id ?? "");

it.each([
  ["q on a note", (c: Commands) => c.closeNote(), {}],
  ["todos", (c: Commands) => c.openTodos(), { todos: true }],
  ["log", (c: Commands) => c.openLog(), { log: true }],
  ["overview", (c: Commands) => c.openOverview(), { overview: true }],
  ["finance", (c: Commands) => c.openFinance(), { finance: true }],
  ["review", (c: Commands) => c.openReview(), { review: true }],
  ["chat", (c: Commands) => c.openChat(), { chat: true }],
  ["timers", (c: Commands) => c.openTimers(), { timers: true }],
  ["graph", (c: Commands) => c.openGraph(), { graph: {} }],
  ["exam", (c: Commands) => c.openExam(), { exam: NOTE }],
])(
  "#1609 %s fills the pane it was pressed in when the focus moves during the save",
  async (_name, run, content) => {
    const start = leftOfTwo();
    const left = focusedPane(start).id;

    const { layout } = await pressedThenMoved(start, run, toRight);

    expect(tabPanes(layout)).toEqual([{ id: left, ...content }, { ...tabPanes(start)[1] }]);
    expect(focusedPane(layout).path).toBe(PERSON);
  },
);

it("#1609 q fills the pane it was pressed in when another tab is open by the time the save answers", async () => {
  const start = leftOfTwo();
  const left = focusedPane(start).id;

  const { layout } = await pressedThenMoved(start, (c) => c.closeNote(), addTab);

  expect(layout.active).toBe(1);
  expect(tabPanes({ ...layout, active: 0 })).toEqual([{ id: left }, tabPanes(start)[1]]);
  expect(focusedPane(layout)).not.toHaveProperty("path");
});

it("#1609 q fills no pane when its own has gone by the time the save answers", async () => {
  const start = leftOfTwo();

  const { layout } = await pressedThenMoved(start, (c) => c.closeNote(), removeFocused);

  expect(tabPanes(layout).map((pane) => pane.path)).toEqual([PERSON]);
});

it("#1609 a refused save changes no pane", async () => {
  const { moveTo } = await pressedThenMoved(leftOfTwo(), (c) => c.closeNote(), toRight, false);

  expect(moveTo).not.toHaveBeenCalled();
});

it("#1609 the terminal prompt's opener fills the pane it was asked from", async () => {
  const start = leftOfTwo();
  const left = focusedPane(start).id;
  const moveTo = vi.fn((_update: (previous: Layout) => Layout) => true);

  await paneOpeners(left, async () => true, moveTo).replace({ term: "main" });

  const layout = moveTo.mock.calls[0]?.[0](toRight(start)) as Layout;
  expect(tabPanes(layout)[0]).toEqual({ id: left, term: "main" });
  expect(focusedPane(layout).path).toBe(PERSON);
});

it.each([
  ["logFood", (c: Commands) => c.logFood()],
  ["logWeight", (c: Commands) => c.logWeight?.("kg")],
])("#1626 %s opens today's note in the pane it was pressed in", async (_name, run) => {
  const start = leftOfTwo();

  const { openPeriodic } = await pressedThenMoved(start, run, toRight);

  expect(openPeriodic).toHaveBeenCalledWith("daily", focusedPane(start).id);
});
