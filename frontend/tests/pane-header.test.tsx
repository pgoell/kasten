import { render } from "@testing-library/react";
import { PaneLayout } from "@/components/pane-layout";
import { openInFocused, openPdfBeside } from "@/lib/pane-contents";
import {
  activeTab,
  emptyLayout,
  focusPane,
  type Layout,
  splitFocused,
  tabPanes,
  toggleZoom,
} from "@/lib/panes";

/** One tab drawn the way the route draws it, with the children a fixed button. */
function tree(layout: Layout) {
  const tab = activeTab(layout);
  return (
    <PaneLayout
      node={tab.root}
      focus={tab.focus}
      divided={tabPanes(layout).length > 1}
      zoomed={tab.zoom === true ? tab.focus : null}
      onFocus={vi.fn()}
    >
      {(pane) => <button type="button">{pane.path ?? "empty"}</button>}
    </PaneLayout>
  );
}

function panes(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-pane]")];
}

function headers(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-pane-header]")];
}

/** Every element inside the panes, as its tag and class, the focus line left out. */
function snapshot(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("[data-pane], [data-pane] *")]
    .filter((element) => !element.hasAttribute("data-focus-line"))
    .map((element) => `${element.tagName} ${element.getAttribute("class")}`);
}

function focusLines(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll<HTMLElement>("[data-focus-line]")].map((line) =>
    line.getAttribute("class"),
  );
}

describe("pane header", () => {
  it("A9 each pane of a split has a header row with its kind and path", () => {
    const layout = openPdfBeside(emptyLayout("a.md"), "x/plan.pdf");
    const { container } = render(tree(layout));

    expect(headers(container)).toHaveLength(2);
    const pdf = container.querySelector<HTMLElement>('[data-kind="pdf"]');
    expect(pdf?.closest("[data-pane]")?.querySelector("[data-pane-header]")).toHaveTextContent(
      "PDF",
    );
    expect(pdf?.closest("[data-pane]")?.querySelector("[data-pane-header]")).toHaveTextContent(
      "x/plan.pdf",
    );
    expect(headers(container)[0]).toHaveTextContent("a.md");
  });

  it("A9 a single pane and a zoomed pane draw no header row", () => {
    const single = render(tree(emptyLayout("a.md")));
    expect(headers(single.container)).toHaveLength(0);
    single.unmount();

    // The same split, unzoomed, has them: the zoom is what takes them away.
    const split = splitFocused(emptyLayout("a.md"), "row");
    const unzoomed = render(tree(split));
    expect(headers(unzoomed.container)).toHaveLength(2);
    unzoomed.unmount();

    const zoomed = render(tree(toggleZoom(split)));
    expect(headers(zoomed.container)).toHaveLength(0);
  });

  it("A10 the focused pane carries the 2 px accent line and the other a transparent one", () => {
    // The split focuses the pane it made, the second one.
    const { container } = render(tree(splitFocused(emptyLayout("a.md"), "row")));
    const [first, second] = panes(container);

    expect(first?.querySelector("[data-focus-line]")?.getAttribute("class")).toContain(
      "bg-transparent",
    );
    expect(second?.querySelector("[data-focus-line]")?.getAttribute("class")).toContain(
      "bg-k-accent",
    );
    expect(second?.querySelector("[data-focus-line]")?.getAttribute("class")).toContain("h-0.5");
  });

  it("A10 the header reads the same on the focused and the other pane", () => {
    const layout = openInFocused(splitFocused(emptyLayout("a.md"), "row"), "b.md");
    const { container } = render(tree(layout));
    const [first, second] = headers(container);

    expect(headers(container)).toHaveLength(2);
    expect(first?.getAttribute("class")).toBe(second?.getAttribute("class"));
  });

  it("I8 taking the focus changes the line's colour and nothing else", () => {
    const layout = splitFocused(emptyLayout("a.md"), "row");
    const [first] = tabPanes(layout);
    if (first === undefined) throw new Error("the split should have made two panes");

    const view = render(tree(layout));
    const before = snapshot(view.container);
    const linesBefore = focusLines(view.container);

    view.rerender(tree(focusPane(layout, first.id)));

    expect(snapshot(view.container)).toEqual(before);
    expect(focusLines(view.container)).not.toEqual(linesBefore);
  });
});
