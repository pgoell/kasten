import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { usePaneMoves } from "@/components/use-pane-moves";
import { openInFocused } from "@/lib/panes/layout/pane-contents";
import {
  emptyLayout,
  focusedPane,
  focusPane,
  type Layout,
  removeFocused,
  splitFocused,
  tabPanes,
} from "@/lib/panes/layout/panes";

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

it("#1626 sends the pane it was pressed in to the edge when the focus moves during the save", async () => {
  const layout = openInFocused(splitFocused(emptyLayout("a.md"), "row"), "b.md");
  const { result, setLayout } = moves(layout);
  const [left, right] = tabPanes(layout);

  await act(() => result.current.shiftToward("down"));

  const update = setLayout.mock.calls[0]?.[0] as (previous: Layout) => Layout;
  const next = update(focusPane(layout, left?.id ?? ""));
  expect(next.tabs[0]?.root).toMatchObject({ dir: "col", children: [{ id: left?.id }, right] });
  expect(focusedPane(next)).toEqual(left);
});

it("#1626 moves no pane when its own has gone by the time the save answers", async () => {
  const layout = openInFocused(splitFocused(emptyLayout("a.md"), "row"), "b.md");
  const { result, setLayout } = moves(layout);

  await act(() => result.current.shiftToward("down"));

  const update = setLayout.mock.calls[0]?.[0] as (previous: Layout) => Layout;
  const gone = removeFocused(layout);
  expect(update(gone)).toEqual(gone);
});
