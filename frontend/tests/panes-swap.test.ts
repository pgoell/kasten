import { openInFocused } from "@/lib/pane-contents";
import {
  addTab,
  emptyLayout,
  focusedPane,
  isSplit,
  type Layout,
  movePaneToEdge,
  type PaneNode,
  splitFocused,
  swapPanes,
  tabPanes,
  toggleZoom,
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

/** The tree as text, `row[a,col[b,c]]`, by each pane's note. */
function shape(node: PaneNode): string {
  if (isSplit(node)) return `${node.dir}[${node.children.map(shape).join(",")}]`;
  return (node.path ?? "").replace(".md", "");
}

function root(layout: Layout): string {
  return shape(at(layout.tabs, layout.active).root);
}

function stacked(...paths: string[]): Layout {
  return paths
    .slice(1)
    .reduce(
      (layout, path) => openInFocused(splitFocused(layout, "col"), path),
      emptyLayout(paths[0]),
    );
}

describe("moving a pane to the window's edge", () => {
  it("sets a stack side by side and back", () => {
    const beside = movePaneToEdge(stacked("a.md", "b.md"), "right");
    expect(root(beside)).toBe("row[a,b]");
    expect(root(movePaneToEdge(beside, "down"))).toBe("col[a,b]");
  });

  it("takes the middle of three out, leaving the other two stacked", () => {
    const layout = stacked("a.md", "b.md", "c.md");
    const pane = at(tabPanes(layout), 1);
    const middle = {
      ...layout,
      tabs: layout.tabs.map((tab) => ({ ...tab, focus: pane.id })),
    };
    expect(root(movePaneToEdge(middle, "right"))).toBe("row[col[a,c],b]");
  });

  it("joins a split dividing the same way rather than nesting in it", () => {
    const row = movePaneToEdge(stacked("a.md", "b.md"), "right");
    const three = openInFocused(splitFocused(row, "col"), "c.md");
    expect(root(three)).toBe("row[a,col[b,c]]");
    expect(root(movePaneToEdge(three, "left"))).toBe("row[c,a,b]");
  });

  it("keeps the pane, its contents and the focus", () => {
    const layout = stacked("a.md", "b.md");
    const moved = movePaneToEdge(layout, "left");
    expect(focusedPane(moved)).toBe(focusedPane(layout));
    expect(notes(moved)).toEqual(["b.md", "a.md"]);
  });

  it("stands still on a pane already filling the edge, a lone pane and a zoomed one", () => {
    const pair = stacked("a.md", "b.md");
    const lone = emptyLayout("a.md");
    const zoomed = toggleZoom(pair);
    expect(movePaneToEdge(pair, "down")).toBe(pair);
    expect(movePaneToEdge(lone, "right")).toBe(lone);
    expect(movePaneToEdge(zoomed, "right")).toBe(zoomed);
  });
});
