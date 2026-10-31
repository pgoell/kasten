import { openInFocused } from "@/lib/pane-contents";
import {
  addTab,
  emptyLayout,
  fillFocused,
  focusedPane,
  focusPane,
  isSplit,
  removeFocused,
  splitFocused,
  tabPanes,
} from "@/lib/panes";
import { at, notes, open } from "./panes-fixture";

describe("closing", () => {
  it("empties a pane holding a note, leaving the pane behind", () => {
    const layout = fillFocused(emptyLayout("a.md"), {});

    expect(tabPanes(layout)).toHaveLength(1);
    expect(open(layout)).toBeNull();
  });

  it("drops a stale line with the note", () => {
    expect(focusedPane(fillFocused(emptyLayout("a.md", 40), {})).line).toBeUndefined();
  });

  it("removes an empty pane, leaving its neighbour", () => {
    const layout = removeFocused(splitFocused(emptyLayout("a.md"), "row"));

    expect(notes(layout)).toEqual(["a.md"]);
  });

  it("collapses the split it emptied rather than leaving a split of one", () => {
    const layout = removeFocused(splitFocused(emptyLayout("a.md"), "row"));

    expect(isSplit(at(layout.tabs, 0).root)).toBe(false);
  });

  it("focuses the pane that took its place", () => {
    // a | b | c with the focus on b. Closing b should land on c, which is now
    // second, rather than jumping back to the start.
    const three = splitFocused(splitFocused(emptyLayout("a.md"), "row"), "row");
    const labelled = openInFocused(focusPane(three, at(tabPanes(three), 1).id), "b.md");
    const withC = openInFocused(focusPane(labelled, at(tabPanes(labelled), 2).id), "c.md");
    const onB = focusPane(withC, at(tabPanes(withC), 1).id);

    const layout = removeFocused(onB);

    expect(notes(layout)).toEqual(["a.md", "c.md"]);
    expect(open(layout)).toBe("c.md");
  });

  it("takes the tab away with the last pane in it", () => {
    const layout = removeFocused(addTab(emptyLayout("a.md")));

    expect(layout.tabs).toHaveLength(1);
    expect(open(layout)).toBe("a.md");
  });

  it("stands still on the last pane of the last tab, having nothing to close", () => {
    const alone = emptyLayout();

    expect(removeFocused(alone)).toBe(alone);
  });
});
