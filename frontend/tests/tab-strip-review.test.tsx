import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { TabStrip } from "@/components/tab-strip";
import { openInFocused } from "@/lib/pane-contents";
import { addTab, emptyLayout, goToTab, type Layout } from "@/lib/panes";
import { foldTabs } from "@/lib/tab-fold";

type Props = Partial<ComponentProps<typeof TabStrip>>;

function strip(layout: Layout, props: Props = {}) {
  return (
    <TabStrip
      layout={layout}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      onHome={vi.fn()}
      unsaved={() => false}
      {...props}
    />
  );
}

function tabsOf(...paths: string[]): Layout {
  return paths
    .slice(1)
    .reduce((layout, path) => openInFocused(addTab(layout), path), emptyLayout(paths[0]));
}

/** jsdom lays nothing out: each tab gets its width, and the strip a room. */
function laidOut(widths: number[], room: number) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return widths[Number(this.dataset.tab)] ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute("role") === "tablist" ? room : 0;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the review fixes", () => {
  it("R1 foldTabs drops tabs from the right until the active one fits beside the button", () => {
    // Room for 132 px beside the button. The active tab is 200 px, so nothing else
    // can stay with it, and it is shown alone.
    expect(foldTabs([50, 50, 50, 50, 200], 220, 4, 88)).toEqual({
      shown: [4],
      hidden: [0, 1, 2, 3],
    });
    // A 60 px active tab leaves room for the first tab beside it, not the second.
    expect(foldTabs([50, 50, 50, 50, 60], 220, 4, 88)).toEqual({
      shown: [0, 4],
      hidden: [1, 2, 3],
    });
  });

  it("R2 the N more list does not come back by itself once the tabs that folded it are gone", () => {
    laidOut([50, 50, 50, 50, 50], 220);
    const layout = goToTab(tabsOf("a.md", "b.md", "c.md", "d.md", "e.md"), 0);
    const view = render(strip(layout));
    fireEvent.click(screen.getByRole("button", { name: "3 more" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    // Two tabs fit, so nothing is folded and there is no button for the list.
    view.rerender(strip(goToTab(tabsOf("a.md", "b.md"), 0)));
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();

    // The window narrows again: the list must not reopen on its own.
    view.rerender(strip(layout));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("R7 the hover wash sits on the tab's wrapper, so the close x is washed with the tab", () => {
    render(strip(tabsOf("a.md", "b.md")));
    const [first] = screen.getAllByRole("tab");

    expect(first?.parentElement).toHaveClass("hover:bg-k-accent-wash");
    expect(first).not.toHaveClass("hover:bg-k-accent-wash");
  });

  it("R9 an N more row draws no browser focus ring, and takes the wash when it has the focus", () => {
    laidOut([50, 50, 50, 50, 50], 220);
    render(strip(goToTab(tabsOf("a.md", "b.md", "c.md", "d.md", "e.md"), 0)));
    fireEvent.click(screen.getByRole("button", { name: "3 more" }));

    expect(screen.getByRole("menuitem", { name: "c" })).toHaveClass(
      "outline-none",
      "focus-visible:bg-k-accent-wash",
    );
  });

  it("R10 the N more list sits 8 px in from the window's edge, a little below the strip", () => {
    laidOut([50, 50, 50, 50, 50], 220);
    render(strip(goToTab(tabsOf("a.md", "b.md", "c.md", "d.md", "e.md"), 0)));
    fireEvent.click(screen.getByRole("button", { name: "3 more" }));

    expect(screen.getByRole("menu")).toHaveClass("right-2", "mt-1");
  });

  it("R11 the tab has room after its x", () => {
    render(strip(tabsOf("a.md", "b.md")));
    const [first] = screen.getAllByRole("tab");

    expect(first?.parentElement).toHaveClass("pr-2");
  });

  it("R12 Today is set in the 15 px serif, the size the sans titles are near", () => {
    render(strip(tabsOf("a.md", "b.md")));

    expect(screen.getByRole("button", { name: "Today" })).toHaveClass("text-k-15");
  });

  it("R18 the cap does not feed back: a second measure of the same row folds the same tabs at the same cap", () => {
    // Widths here follow the cap the way a browser does: a tab cannot be wider than
    // its max-width. The first tab is 76 px, the active tab 200 px, in a 250 px row.
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      const natural = [76, 200][Number(this.dataset.tab)] ?? 0;
      const cap = Number.parseFloat(this.style.maxWidth);
      return Number.isNaN(cap) ? natural : Math.min(natural, cap);
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute("role") === "tablist" ? 250 : 0;
    });
    const measures: (() => void)[] = [];
    class FakeObserver {
      constructor(callback: () => void) {
        measures.push(callback);
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeObserver);
    try {
      render(strip(tabsOf("a.md", "b.md")));
      const active = () => screen.getByRole("tab", { selected: true }).parentElement;
      const folded = () => screen.queryByRole("button", { name: /more$/ })?.textContent ?? "none";
      expect(folded()).toBe("1 more");
      const cap = active()?.style.maxWidth;

      // The observer hears the cap it was given, and measures the row again.
      act(() => {
        for (const measure of measures) measure();
      });

      expect(folded()).toBe("1 more");
      expect(active()?.style.maxWidth).toBe(cap);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("R19 the cap is never negative: a row narrower than the button takes none", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(50);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute("role") === "tablist" ? 60 : 0;
    });
    render(strip(tabsOf("a.md", "b.md")));

    const active = screen.getByRole("tab", { selected: true }).parentElement;
    // A cap of zero, which the browser reads as a number; a negative one is refused.
    expect(Number.parseFloat(active?.style.maxWidth ?? "")).toBe(0);
  });
});
