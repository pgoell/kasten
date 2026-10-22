import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { emptyLayout, tabPanes } from "@/lib/panes";
import { usePaneCommands } from "@/lib/use-pane-commands";

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
        moves: { moveTo, focusToward: vi.fn(), swapToward: vi.fn() },
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
