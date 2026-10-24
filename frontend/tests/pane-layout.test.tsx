import { render, screen } from "@testing-library/react";
import { PaneLayout } from "@/components/pane-layout";
import { openInFocused } from "@/lib/pane-contents";
import {
  activeTab,
  emptyLayout,
  focusPane,
  type Layout,
  removeFocused,
  splitFocused,
  tabPanes,
  toggleZoom,
} from "@/lib/panes";

/** One tab's panes the way the route draws them, with a button to focus in each. */
function tree(layout: Layout, onFocus = vi.fn()) {
  const tab = activeTab(layout);
  return (
    <PaneLayout
      node={tab.root}
      focus={tab.focus}
      divided={tabPanes(layout).length > 1}
      zoomed={tab.zoom === true ? tab.focus : null}
      onFocus={onFocus}
    >
      {(pane, focused) => (
        <button type="button" data-testid={pane.id} data-focused={focused}>
          {pane.path ?? "empty"}
        </button>
      )}
    </PaneLayout>
  );
}

/** Draw one tab's panes the way the route does. */
function draw(layout: Layout, onFocus = vi.fn()) {
  const view = render(tree(layout, onFocus));

  return { ...view, onFocus };
}

/** The wrappers the layout draws, in the order they sit in. */
function panes(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-pane]")];
}

/** Every pane's node by id, as drawn now. */
function nodesById(container: HTMLElement): Map<string, HTMLElement> {
  return new Map(panes(container).map((pane) => [pane.dataset.pane ?? "", pane]));
}

describe("PaneLayout", () => {
  it("draws one pane when nothing is divided", () => {
    const { container } = draw(emptyLayout("a.md"));

    expect(panes(container)).toHaveLength(1);
    expect(screen.getByText("a.md")).toBeInTheDocument();
  });

  it("draws both sides of a split", () => {
    const { container } = draw(splitFocused(emptyLayout("a.md"), "row"));

    expect(panes(container)).toHaveLength(2);
    // The header row names the path too, so the pane's own button is the match.
    expect(screen.getByText("a.md", { selector: "button" })).toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("hides the other panes while one is zoomed, without taking them down", () => {
    const layout = toggleZoom(splitFocused(emptyLayout("a.md"), "row"));
    const [first, second] = tabPanes(layout);
    const { container } = draw(layout);

    // Both are still drawn, so the editor in the hidden one keeps its cursor
    // and whatever has not reached the vault yet.
    expect(panes(container)).toHaveLength(2);
    expect(screen.getByText("a.md")).toBeInTheDocument();
    expect(container.querySelector(`[data-pane="${first?.id}"]`)).toHaveClass("hidden");
    expect(container.querySelector(`[data-pane="${second?.id}"]`)).not.toHaveClass("hidden");
  });

  it("hides a whole split holding none of the zoomed pane", () => {
    // a / (b | c), zoomed on a: b and c go with the row they share, and a takes
    // the whole window rather than its share of it.
    const column = openInFocused(splitFocused(emptyLayout("a.md"), "col"), "b.md");
    const three = openInFocused(splitFocused(column, "row"), "c.md");
    const layout = toggleZoom(focusPane(three, tabPanes(three)[0]?.id ?? ""));
    const { container } = draw(layout);

    const [a, b, c] = panes(container);
    expect(a).not.toHaveClass("hidden");
    expect(b).toHaveClass("hidden");
    expect(c).toHaveClass("hidden");
    expect(a?.style.left).toBe("0px");
    expect(a?.style.right).toBe("0px");
  });

  it("lays a row out along the row and a column down it", () => {
    const { container: row } = draw(splitFocused(emptyLayout("a.md"), "row"));
    const { container: column } = draw(splitFocused(emptyLayout("a.md"), "col"));

    // Side by side in a row: the second pane starts half way across, and the
    // first ends there. Stacked in a column, the same along the top and bottom.
    const [rowFirst, rowSecond] = panes(row);
    expect(rowFirst?.style.right).toBe("calc(50% + 1px)");
    expect(rowSecond?.style.left).toBe("calc(50% + 1px)");
    const [columnFirst, columnSecond] = panes(column);
    expect(columnFirst?.style.bottom).toBe("calc(50% + 1px)");
    expect(columnSecond?.style.top).toBe("calc(50% + 1px)");
  });

  it("tells the focused pane apart once there is another one", () => {
    const layout = splitFocused(emptyLayout("a.md"), "row");
    const { container } = draw(layout);

    const focused = panes(container).filter((pane) =>
      pane.querySelector("[data-focus-line]")?.classList.contains("bg-k-accent"),
    );
    expect(focused).toHaveLength(1);
    // The split focused the pane it made, which is the empty one.
    expect(focused[0]).toHaveTextContent("empty");
  });

  it("draws no header row or focus line on a single pane, having nothing to tell it from", () => {
    const { container } = draw(emptyLayout("a.md"));

    expect(container.querySelector("[data-pane-header]")).toBeNull();
    expect(container.querySelector("[data-focus-line]")).toBeNull();
  });

  it("reports the pane the focus moved into", () => {
    const layout = splitFocused(emptyLayout("a.md"), "row");
    const [first] = tabPanes(layout);
    if (first === undefined) throw new Error("the split should have made two panes");
    const { onFocus } = draw(layout);

    // A real focus rather than a synthetic event: this is how clicking into a
    // pane and how `gf` following a link into one both reach the handler.
    screen.getByTestId(first.id).focus();

    expect(onFocus).toHaveBeenCalledWith(first.id);
  });

  it("#932 A3 a lone pane keeps its node when a second pane opens beside it", () => {
    const lone = emptyLayout("a.md");
    const [first] = tabPanes(lone);
    if (first === undefined) throw new Error("a tab has one pane");
    const { container, rerender } = draw(lone);
    const leaf = container.querySelector(`[data-pane="${first.id}"]`);
    const button = screen.getByTestId(first.id);

    const split = splitFocused(lone, "row");
    rerender(tree(split));

    // The lone pane is the split's first child, so it keeps its place and its node.
    expect(tabPanes(split)[0]?.id).toBe(first.id);
    expect(container.querySelector(`[data-pane="${first.id}"]`)).toBe(leaf);
    expect(screen.getByTestId(first.id)).toBe(button);
  });

  it("#932 A4 the pane left when its neighbour closes keeps its node", () => {
    const split = splitFocused(emptyLayout("a.md"), "row");
    const [first] = tabPanes(split);
    if (first === undefined) throw new Error("the split should have made two panes");
    const { container, rerender } = draw(split);
    const leaf = container.querySelector(`[data-pane="${first.id}"]`);
    const button = screen.getByTestId(first.id);

    // The focus is on the pane the split made, so closing it leaves the first one.
    const closed = removeFocused(split);
    rerender(tree(closed));

    expect(tabPanes(closed).map((pane) => pane.id)).toEqual([first.id]);
    expect(container.querySelector(`[data-pane="${first.id}"]`)).toBe(leaf);
    expect(screen.getByTestId(first.id)).toBe(button);
  });

  it("#935 A8 a pane in a row divided into a column keeps every pane's node", () => {
    const row = splitFocused(emptyLayout("a.md"), "row");
    const { container, rerender } = draw(row);
    const before = nodesById(container);

    // The focus is on the second pane, which the split divides into a column.
    rerender(tree(splitFocused(row, "col")));

    expect(panes(container)).toHaveLength(3);
    for (const [id, node] of before) expect(nodesById(container).get(id)).toBe(node);
  });

  it("#935 A8 a pane in a column divided into a row keeps every pane's node", () => {
    const column = splitFocused(emptyLayout("a.md"), "col");
    const { container, rerender } = draw(column);
    const before = nodesById(container);

    rerender(tree(splitFocused(column, "row")));

    expect(panes(container)).toHaveLength(3);
    for (const [id, node] of before) expect(nodesById(container).get(id)).toBe(node);
  });

  it("#935 A8 closing the other pane of a column folds it back into the row and keeps every node", () => {
    const column = splitFocused(splitFocused(emptyLayout("a.md"), "row"), "col");
    const { container, rerender } = draw(column);
    const before = nodesById(container);

    // The focus is on the pane the column made, so closing it leaves the row.
    rerender(tree(removeFocused(column)));

    expect(panes(container)).toHaveLength(2);
    for (const [id, node] of nodesById(container)) expect(before.get(id)).toBe(node);
  });

  it("#935 A8 three splits deep, and back out again, keeps every pane's node", () => {
    const row = splitFocused(emptyLayout("a.md"), "row");
    const column = splitFocused(row, "col");
    const deep = splitFocused(column, "row");
    const { container, rerender } = draw(deep);
    const before = nodesById(container);
    const expectKept = () => {
      for (const [id, node] of nodesById(container)) expect(before.get(id)).toBe(node);
    };

    const back = removeFocused(deep);
    rerender(tree(back));
    expect(panes(container)).toHaveLength(3);
    expectKept();

    rerender(tree(removeFocused(back)));
    expect(panes(container)).toHaveLength(2);
    expectKept();
  });
});
