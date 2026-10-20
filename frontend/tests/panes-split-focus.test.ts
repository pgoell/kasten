import { openInFocused } from "@/lib/pane-contents";
import {
  emptyLayout,
  focusedPane,
  focusPane,
  isSplit,
  nextPane,
  panesOf,
  splitFocused,
  tabPanes,
} from "@/lib/panes";
import { at, notes, open } from "./panes-fixture";

describe("a fresh layout", () => {
  it("is one tab holding one empty pane", () => {
    const layout = emptyLayout();

    expect(layout.tabs).toHaveLength(1);
    expect(tabPanes(layout)).toHaveLength(1);
    expect(open(layout)).toBeNull();
  });

  it("can start on a note, which is what a reload hands it", () => {
    const layout = emptyLayout("ideas/borges.md", 12);

    expect(open(layout)).toBe("ideas/borges.md");
    expect(focusedPane(layout).line).toBe(12);
  });
});

describe("splitting", () => {
  it("puts an empty pane beside this one and moves to it", () => {
    const layout = splitFocused(emptyLayout("a.md"), "row");

    expect(notes(layout)).toEqual(["a.md", null]);
    expect(open(layout)).toBeNull();
  });

  it("leaves the other panes alone", () => {
    const layout = openInFocused(splitFocused(emptyLayout("a.md"), "row"), "b.md");

    expect(notes(layout)).toEqual(["a.md", "b.md"]);
  });

  it("splits the focused pane and not the first one", () => {
    // a | b, focus on b, then split b downward: a | (b over empty).
    const two = openInFocused(splitFocused(emptyLayout("a.md"), "row"), "b.md");
    const layout = splitFocused(two, "col");

    expect(notes(layout)).toEqual(["a.md", "b.md", null]);

    const root = at(layout.tabs, 0).root;
    if (!isSplit(root)) throw new Error("the root should be a split");
    expect(root.dir).toBe("row");
    expect(root.children).toHaveLength(2);
    // The second child is the nested column, because only b was divided.
    const nested = at(root.children, 1);
    if (!isSplit(nested)) throw new Error("b should have become a column");
    expect(nested.dir).toBe("col");
  });

  // React keys the rendered tree off these ids. A split handed a new one on
  // every change would re-key the pane beside the one being divided, throwing
  // away a CodeMirror view, a cursor and an undo history nobody touched.
  it("keeps a split's id while a pane inside it is divided", () => {
    const two = splitFocused(emptyLayout("a.md"), "row");
    const before = at(two.tabs, 0).root;
    if (!isSplit(before)) throw new Error("the root should be a split");

    const after = at(splitFocused(two, "col").tabs, 0).root;
    if (!isSplit(after)) throw new Error("the root should still be a split");

    expect(after.id).toBe(before.id);
  });

  it("keeps three panes side by side flat rather than nesting them", () => {
    // Splitting the same way twice should give even thirds, not a half and
    // two quarters, so the second split joins the row instead of nesting in it.
    const layout = splitFocused(splitFocused(emptyLayout("a.md"), "row"), "row");

    const root = at(layout.tabs, 0).root;
    if (!isSplit(root)) throw new Error("the root should be a split");
    expect(root.children).toHaveLength(3);
    expect(root.children.every((child) => !isSplit(child))).toBe(true);
  });
});

describe("moving between panes", () => {
  it("walks them in order and wraps at the end", () => {
    const three = splitFocused(splitFocused(emptyLayout("a.md"), "row"), "row");
    const order = tabPanes(three);

    // The focus starts on the third, which is the one the last split made, so
    // the first step is the wrap.
    const back = nextPane(three);
    expect(focusedPane(back).id).toBe(at(order, 0).id);
    expect(focusedPane(nextPane(back)).id).toBe(at(order, 1).id);
    expect(focusedPane(nextPane(nextPane(back))).id).toBe(at(order, 2).id);
  });

  it("goes straight to the pane a click names", () => {
    const two = splitFocused(emptyLayout("a.md"), "row");
    const first = at(tabPanes(two), 0);

    expect(focusedPane(focusPane(two, first.id)).id).toBe(first.id);
  });
});

describe("panesOf", () => {
  it("reads a bare pane as one pane", () => {
    expect(panesOf(at(emptyLayout().tabs, 0).root)).toHaveLength(1);
  });
});
