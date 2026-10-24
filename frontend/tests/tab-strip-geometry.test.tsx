import { act, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { TabStrip } from "@/components/tab-strip";
import { openInFocused } from "@/lib/pane-contents";
import { addTab, emptyLayout, goToTab, type Layout } from "@/lib/panes";

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

function draw(layout: Layout, props: Props = {}) {
  return render(strip(layout, props));
}

function tabsOf(...paths: string[]): Layout {
  return paths
    .slice(1)
    .reduce((layout, path) => openInFocused(addTab(layout), path), emptyLayout(paths[0]));
}

/** jsdom lays nothing out: each tab is given its width, and the strip a room. */
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

function shownNames(): string[] {
  return screen.getAllByRole("tab").map((tab) => tab.textContent ?? "");
}

/**
 * A ResizeObserver that reports only when the test fires it, as a browser does
 * after a layout. `made` lists the observers built, and `fire` calls each back.
 */
function fakeObserver() {
  const made: { callback: () => void }[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: () => void;

      constructor(callback: () => void) {
        this.callback = callback;
        made.push(this);
      }

      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return {
    made,
    fire() {
      act(() => {
        for (const observer of made) observer.callback();
      });
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TabStrip geometry", () => {
  it("#974 A6 a tab switch reads no tab geometry: offsetWidth and offsetLeft are not read on a change of the active tab", () => {
    laidOut([50, 50, 50, 50, 50], 220);
    const observer = fakeObserver();
    const layout = goToTab(tabsOf("a.md", "b.md", "c.md", "d.md", "e.md"), 0);
    const view = draw(layout);
    observer.fire();

    const widthReads = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
    const leftReads = vi.spyOn(HTMLElement.prototype, "offsetLeft", "get");
    const before = widthReads.mock.calls.length + leftReads.mock.calls.length;
    view.rerender(strip(goToTab(layout, 3)));

    expect(widthReads.mock.calls.length + leftReads.mock.calls.length - before).toBe(0);
    expect(shownNames()).toEqual(["a", "d"]);
  });

  it("#974 A6b one ResizeObserver serves the fold and the bar", () => {
    const observer = fakeObserver();
    const layout = tabsOf("a.md", "b.md", "c.md");
    const view = draw(layout);
    expect(observer.made).toHaveLength(1);

    view.rerender(strip(goToTab(layout, 0)));

    expect(observer.made).toHaveLength(1);
  });

  it("#974 I1 the fold follows a width the observer reports", () => {
    const widths = [50, 50, 50, 50, 50];
    let room = 0;
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
    const observer = fakeObserver();
    draw(goToTab(tabsOf("a.md", "b.md", "c.md", "d.md", "e.md"), 0));
    // Nothing is laid out yet, so the strip has no room and folds nothing.
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();

    room = 220;
    observer.fire();
    expect(screen.getByRole("button", { name: "3 more" })).toBeInTheDocument();

    room = 400;
    observer.fire();
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
    expect(shownNames()).toEqual(["a", "b", "c", "d", "e"]);
  });
});
