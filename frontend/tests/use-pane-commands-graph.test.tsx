import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { emptyLayout, focusedPane, type Layout, tabPanes } from "@/lib/panes";
import { type PaneCommands, paneOpeners, usePaneCommands } from "@/lib/use-pane-commands";

const NOTE = "ideas/rag.md";
const client = new QueryClient();

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// The leader's `gl` names `openLocalGraph`, so the command is run as the key runs it.
function openLocalGraphWith(options: { sideGraph?: (pane: string) => void }) {
  const moveTo = vi.fn();
  const { result } = renderHook(
    () =>
      usePaneCommands({
        pane: { id: "pane-1", path: NOTE },
        setLayout: vi.fn(),
        saveFirst: async () => true,
        moves: { moveTo, focusToward: vi.fn(), shiftToward: vi.fn() },
        openPeriodic: vi.fn(),
        setNotice: vi.fn(),
        paths: [],
        focusedNote: { current: { path: NOTE, isWriting: () => false } },
        ...options,
      }),
    { wrapper },
  );
  result.current.commands.openLocalGraph();
  return { moveTo };
}

it("A9 Space g l on a desktop asks the focused pane for its graph and opens no pane", () => {
  const sideGraph = vi.fn();

  const { moveTo } = openLocalGraphWith({ sideGraph });

  expect(sideGraph).toHaveBeenCalledWith("pane-1");
  expect(moveTo).not.toHaveBeenCalled();
});

it("I2 openLocalGraph with neither a sheet nor a side ask still opens the graph beside the note", () => {
  const { moveTo } = openLocalGraphWith({});

  expect(moveTo).toHaveBeenCalledTimes(1);
  const layout = moveTo.mock.calls[0]?.[0](emptyLayout(NOTE));
  expect(tabPanes(layout).map((each) => each.graph?.around ?? null)).toEqual([null, NOTE]);
});

it("replace saves the note before it fills the pane, and a refused save fills nothing", async () => {
  const order: string[] = [];
  const moveTo = vi.fn((update: (previous: Layout) => Layout) => {
    order.push("move");
    return update(emptyLayout(NOTE)) !== undefined;
  });
  let saved = true;
  const saveFirst = vi.fn(async () => {
    order.push("save");
    return saved;
  });
  const { replace } = paneOpeners(saveFirst, moveTo);

  await replace({ todos: true });
  expect(order).toEqual(["save", "move"]);
  const layout = moveTo.mock.calls[0]?.[0](emptyLayout(NOTE)) as Layout;
  expect(focusedPane(layout)).toEqual({ id: focusedPane(layout).id, todos: true });

  saved = false;
  await replace({ log: true });
  expect(order).toEqual(["save", "move", "save"]);
});

it("beside opens the pane without a save, and goes to the pane already holding it", () => {
  const moveTo = vi.fn();
  const saveFirst = vi.fn(async () => true);
  const { beside } = paneOpeners(saveFirst, moveTo);

  beside((each) => each.video === NOTE, { video: NOTE }, "col");

  expect(saveFirst).not.toHaveBeenCalled();
  const once = moveTo.mock.calls[0]?.[0](emptyLayout(NOTE)) as Layout;
  expect(tabPanes(once).map((each) => each.video ?? null)).toEqual([null, NOTE]);
  expect(once.tabs[0]?.root).toMatchObject({ dir: "col" });
  expect(tabPanes(moveTo.mock.calls[0]?.[0](once))).toHaveLength(2);
});

type Command = keyof PaneCommands["commands"];

// Run as the key runs it, over a note pane, with the save answering `saved`.
async function runWith(command: Command, saved: boolean) {
  client.setQueryData(["note", NOTE], "---\ntype: Person\n---\n");
  const moveTo = vi.fn();
  const saveFirst = vi.fn(async () => saved);
  const { result } = renderHook(
    () =>
      usePaneCommands({
        pane: { id: "pane-1", path: NOTE },
        setLayout: vi.fn(),
        saveFirst,
        moves: { moveTo, focusToward: vi.fn(), shiftToward: vi.fn() },
        openPeriodic: vi.fn(),
        setNotice: vi.fn(),
        paths: [],
        focusedNote: { current: { path: NOTE, isWriting: () => false } },
      }),
    { wrapper },
  );
  await (result.current.commands[command] as () => unknown)();
  return { moveTo, saveFirst };
}

const REPLACING: Command[] = [
  "closeNote",
  "openTodos",
  "openLog",
  "openOverview",
  "openFinance",
  "openReview",
  "openChat",
  "openGraph",
  "openExam",
];
const BESIDE: Command[] = ["openBook", "openPerson", "openHistory", "openVideo", "openLocalGraph"];

it.each(REPLACING)(
  "%s saves the note first and replaces nothing when the save is refused",
  async (command) => {
    const refused = await runWith(command, false);
    expect(refused.saveFirst).toHaveBeenCalledTimes(1);
    expect(refused.moveTo).not.toHaveBeenCalled();

    const taken = await runWith(command, true);
    expect(taken.moveTo).toHaveBeenCalledTimes(1);
  },
);

it.each(BESIDE)("%s opens beside the note without a save", async (command) => {
  const { moveTo, saveFirst } = await runWith(command, false);
  expect(saveFirst).not.toHaveBeenCalled();
  expect(moveTo).toHaveBeenCalledTimes(1);
  const layout = moveTo.mock.calls[0]?.[0](emptyLayout(NOTE)) as Layout;
  expect(tabPanes(layout)[0]?.path).toBe(NOTE);
  expect(tabPanes(layout)).toHaveLength(2);
});
