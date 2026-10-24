import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import {
  openGraphBeside,
  openGraphInFocused,
  openHistoryBeside,
  openPersonBeside,
} from "@/lib/pane-contents";
import {
  activeTab,
  emptyLayout,
  focusedPane,
  focusPane,
  isEmptyTab,
  type Layout,
  removeFocused,
  tabPanes,
} from "@/lib/panes";
import { usePaneCommands } from "@/lib/use-pane-commands";

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
async function closeFocused(start: Layout) {
  const moveTo = vi.fn();
  const saveFirst = vi.fn(async () => true);
  const { result } = renderHook(
    () =>
      usePaneCommands({
        pane: focusedPane(start),
        setLayout: vi.fn(),
        saveFirst,
        moves: { moveTo, focusToward: vi.fn(), swapToward: vi.fn() },
        openPeriodic: vi.fn(),
        setNotice: vi.fn(),
        paths: [],
        focusedNote: { current: { path: undefined, isWriting: () => false } },
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

function expectEmptiedBeside(start: Layout, layout: Layout, kind: "graph" | "history" | "person") {
  const panes = tabPanes(layout);
  const emptied = panes.find((pane) => pane.id === focusedPane(start).id);
  expect(panes.map((pane) => pane.path)).toContain(NOTE);
  expect(emptied?.[kind]).toBeUndefined();
  expect(panes.map((pane) => pane.id)).toEqual(tabPanes(start).map((pane) => pane.id));
}

it("A1 q on a lone graph pane empties it and shows Today", async () => {
  const start = openGraphInFocused(emptyLayout());
  expect(focusedPane(start).graph).toBeDefined();

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).not.toHaveBeenCalled();
  expectEmptiedInPlace(start, layout);
});

it("A2 q on a graph beside a note empties that pane and keeps the note", async () => {
  const start = openGraphBeside(emptyLayout(NOTE), NOTE);
  expect(focusedPane(start).graph?.around).toBe(NOTE);

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).not.toHaveBeenCalled();
  expectEmptiedBeside(start, layout, "graph");
});

it("A3 q on a lone history pane empties it and shows Today", async () => {
  const start = withoutNote(openHistoryBeside(emptyLayout(NOTE), NOTE));
  expect(focusedPane(start).history).toBe(NOTE);

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).not.toHaveBeenCalled();
  expectEmptiedInPlace(start, layout);
});

it("A4 q on a history beside a note empties that pane and keeps the note", async () => {
  const start = openHistoryBeside(emptyLayout(NOTE), NOTE);
  expect(focusedPane(start).history).toBe(NOTE);

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).not.toHaveBeenCalled();
  expectEmptiedBeside(start, layout, "history");
});

it("A5 q on a lone person pane empties it and shows Today", async () => {
  const start = withoutNote(openPersonBeside(emptyLayout(NOTE), PERSON));
  expect(focusedPane(start).person).toBe(PERSON);

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).not.toHaveBeenCalled();
  expectEmptiedInPlace(start, layout);
});

it("A6 q on a person beside a note empties that pane and keeps the note", async () => {
  const start = openPersonBeside(emptyLayout(NOTE), PERSON);
  expect(focusedPane(start).person).toBe(PERSON);

  const { layout, saveFirst } = await closeFocused(start);

  expect(saveFirst).not.toHaveBeenCalled();
  expectEmptiedBeside(start, layout, "person");
});
