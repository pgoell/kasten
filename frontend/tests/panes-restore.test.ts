import { openInFocused, openOnTop } from "@/lib/pane-contents";
import {
  addTab,
  emptyLayout,
  focusedPane,
  goToTab,
  isSplit,
  type Layout,
  nextPane,
  panesOf,
  reidLayout,
  splitFocused,
} from "@/lib/panes";
import { notes, open } from "./panes-fixture";

describe("a restored layout", () => {
  /** Two tabs, `index.md` focused beside `other.md` in the first, `far.md` in the second. */
  function restored(): Layout {
    const split = openInFocused(splitFocused(emptyLayout("index.md"), "row"), "other.md");
    return openInFocused(addTab(nextPane(split)), "far.md");
  }

  it("I8 takes fresh ids for every tab, split and pane, and keeps the focus on its pane", () => {
    const layout = restored();

    const fresh = reidLayout(layout);

    const ids = (each: Layout) =>
      each.tabs.flatMap((tab) => [
        tab.id,
        ...(isSplit(tab.root)
          ? [tab.root.id, ...panesOf(tab.root).map((pane) => pane.id)]
          : [tab.root.id]),
      ]);
    expect(ids(fresh).filter((id) => ids(layout).includes(id))).toEqual([]);
    expect(open(fresh)).toBe("far.md");
    expect(open(goToTab(fresh, 0))).toBe("index.md");
  });

  it("I3 a URL naming the focused pane's note changes nothing", () => {
    const layout = goToTab(restored(), 0);

    expect(openOnTop(layout, "index.md")).toBe(layout);
  });

  it("I3 a URL with a line on the focused pane's note jumps there", () => {
    const layout = goToTab(restored(), 0);

    const moved = openOnTop(layout, "index.md", 12);

    expect(notes(moved)).toEqual(["index.md", "other.md"]);
    expect(focusedPane(moved)).toMatchObject({ path: "index.md", line: 12, jump: 1 });
  });

  it("I3 a URL naming a note another tab holds goes to that tab and that pane", () => {
    const layout = goToTab(restored(), 0);

    const moved = openOnTop(layout, "far.md");

    expect(moved.active).toBe(1);
    expect(open(moved)).toBe("far.md");
    expect(notes(goToTab(moved, 0))).toEqual(["index.md", "other.md"]);
  });

  it("I3 a URL naming a note another pane of this tab holds focuses that pane", () => {
    const layout = goToTab(restored(), 0);

    const moved = openOnTop(layout, "other.md", 7);

    expect(notes(moved)).toEqual(["index.md", "other.md"]);
    expect(focusedPane(moved)).toMatchObject({ path: "other.md", line: 7, jump: 1 });
  });

  it("I3 a URL naming a note no pane holds opens it in the focused pane", () => {
    const layout = goToTab(restored(), 0);

    const moved = openOnTop(layout, "new.md", 3);

    expect(notes(moved)).toEqual(["new.md", "other.md"]);
    expect(focusedPane(moved)).toMatchObject({ path: "new.md", line: 3 });
  });
});
