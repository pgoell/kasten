import { render, screen } from "@testing-library/react";
import { PaneLayout, TabStrip } from "@/components/pane-layout";
import {
  activeTab,
  addTab,
  emptyLayout,
  type Layout,
  openBookBeside,
  splitFocused,
  tabPanes,
} from "@/lib/panes";

/** Draw one tab's panes the way the route does, with a button to focus in each. */
function draw(layout: Layout, onFocus = vi.fn()) {
  const tab = activeTab(layout);
  const view = render(
    <PaneLayout
      node={tab.root}
      focus={tab.focus}
      divided={tabPanes(layout).length > 1}
      onFocus={onFocus}
    >
      {(pane, focused) => (
        <button type="button" data-testid={pane.id} data-focused={focused}>
          {pane.path ?? "empty"}
        </button>
      )}
    </PaneLayout>,
  );

  return { ...view, onFocus };
}

/** The wrappers the layout draws, in the order they sit in. */
function panes(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-pane]")];
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
    expect(screen.getByText("a.md")).toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("lays a row out along the row and a column down it", () => {
    const { container: row } = draw(splitFocused(emptyLayout("a.md"), "row"));
    const { container: column } = draw(splitFocused(emptyLayout("a.md"), "col"));

    expect(row.querySelector(".flex-row")).toBeInTheDocument();
    expect(column.querySelector(".flex-col")).toBeInTheDocument();
  });

  it("tells the focused pane apart once there is another one", () => {
    const layout = splitFocused(emptyLayout("a.md"), "row");
    const { container } = draw(layout);

    const focused = panes(container).filter((pane) => pane.className.includes("border-one-accent"));
    expect(focused).toHaveLength(1);
    // The split focused the pane it made, which is the empty one.
    expect(focused[0]).toHaveTextContent("empty");
  });

  it("draws no border on a single pane, having nothing to tell it from", () => {
    const { container } = draw(emptyLayout("a.md"));

    expect(container.querySelector(".border-one-line")).toBeNull();
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
});

describe("TabStrip", () => {
  it("stays out of the way while there is only one tab", () => {
    const { container } = render(<TabStrip layout={emptyLayout()} onSelect={() => {}} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names each tab by the note in the pane it left focused", () => {
    const layout = addTab(emptyLayout("ideas/borges.md"));

    render(<TabStrip layout={layout} onSelect={() => {}} />);

    expect(screen.getByRole("tab", { name: /borges/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /empty/ })).toBeInTheDocument();
  });

  it("marks the tab on screen and no other", () => {
    render(<TabStrip layout={addTab(emptyLayout("a.md"))} onSelect={() => {}} />);

    const selected = screen.getAllByRole("tab").filter((tab) => tab.ariaSelected === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("empty");
  });

  it("numbers the tenth tab 0, which is the key that reaches it", () => {
    let layout = emptyLayout();
    for (let index = 0; index < 9; index += 1) layout = addTab(layout);

    render(<TabStrip layout={layout} onSelect={() => {}} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(10);
    expect(tabs[9]).toHaveTextContent("0 empty");
  });

  it("goes to the tab that was clicked", () => {
    const onSelect = vi.fn();
    render(<TabStrip layout={addTab(emptyLayout("a.md"))} onSelect={onSelect} />);

    screen.getByRole("tab", { name: /a$/ }).click();

    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("names a tab whose focused pane holds a book after the note", () => {
    // Without this, `tabLabel` reads `term`, `todos` then `path` and calls a
    // reader `empty`, and every other test in this branch still passes.
    const layout = addTab(openBookBeside(emptyLayout("lit/DDIA.md"), "lit/DDIA.md"));

    render(<TabStrip layout={layout} onSelect={() => {}} />);

    expect(screen.getByRole("tab", { name: /DDIA/ })).toBeInTheDocument();
  });
});
