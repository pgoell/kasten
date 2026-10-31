import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { usePaneMoves } from "@/components/use-pane-moves";
import { openInFocused } from "@/lib/pane-contents";
import { emptyLayout, splitFocused } from "@/lib/panes";

// jsdom measures nothing, so no pane sits any way and each key asks about the edge.
function moves(layout = openInFocused(splitFocused(emptyLayout("a.md"), "row"), "b.md")) {
  const saveFirst = vi.fn(async () => true);
  const setLayout = vi.fn();
  const { result } = renderHook(() =>
    usePaneMoves({
      setLayout,
      setFocusSignal: vi.fn(),
      isConflicted: () => false,
      saveFirst,
      layout,
    }),
  );
  return { result, saveFirst, setLayout };
}

it("writes nothing and moves nothing for a pane already filling that edge", async () => {
  const { result, saveFirst, setLayout } = moves();

  await act(() => result.current.shiftToward("right"));

  expect(saveFirst).not.toHaveBeenCalled();
  expect(setLayout).not.toHaveBeenCalled();
});

it("writes the note first for a pane that can go to the edge", async () => {
  const { result, saveFirst, setLayout } = moves();

  await act(() => result.current.shiftToward("down"));

  expect(saveFirst).toHaveBeenCalledOnce();
  expect(setLayout).toHaveBeenCalledOnce();
});
