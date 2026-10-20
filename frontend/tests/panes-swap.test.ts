import { openInFocused } from "@/lib/pane-contents";
import {
  addTab,
  emptyLayout,
  focusedPane,
  type Layout,
  splitFocused,
  swapPanes,
  tabPanes,
} from "@/lib/panes";
import { at, notes, open } from "./panes-fixture";

describe("swapping two panes", () => {
  /** a | b, focused on b, which is the shape every one of these starts from. */
  function pair(): Layout {
    const split = splitFocused(emptyLayout("a.md"), "row");
    return openInFocused(split, "b.md");
  }

  it("trades what the two panes hold, leaving the arrangement alone", () => {
    const layout = pair();
    const first = at(tabPanes(layout), 0);

    const swapped = swapPanes(layout, first.id);

    expect(notes(swapped)).toEqual(["b.md", "a.md"]);
    expect(tabPanes(swapped)).toHaveLength(2);
  });

  it("keeps the focus on the pane you were in, which has moved with you", () => {
    const layout = pair();
    const first = at(tabPanes(layout), 0);

    const swapped = swapPanes(layout, first.id);

    expect(focusedPane(swapped).id).toBe(focusedPane(layout).id);
    expect(open(swapped)).toBe("b.md");
  });

  it("stands still on the focused pane itself, there being nothing to trade", () => {
    const layout = pair();

    expect(swapPanes(layout, focusedPane(layout).id)).toBe(layout);
  });

  it("stands still on a pane of another tab", () => {
    const layout = pair();
    const elsewhere = at(tabPanes(addTab(layout)), 0);

    expect(swapPanes(layout, elsewhere.id)).toBe(layout);
  });

  it("reaches across two splits, which the tree cannot flatten", () => {
    // a | (b / c), focused on c, swapping with a.
    const row = openInFocused(splitFocused(emptyLayout("a.md"), "row"), "b.md");
    const column = openInFocused(splitFocused(row, "col"), "c.md");
    const first = at(tabPanes(column), 0);

    const swapped = swapPanes(column, first.id);

    expect(notes(swapped)).toEqual(["c.md", "b.md", "a.md"]);
    expect(open(swapped)).toBe("c.md");
  });
});
