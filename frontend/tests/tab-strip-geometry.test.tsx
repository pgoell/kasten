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

/** The width a tab draws at: its natural width, or the cap it is given when that is narrower. */
function boxOf(tab: HTMLElement, natural: number): number {
  const limit = Number.parseFloat(tab.style.maxWidth);
  return Number.isNaN(limit) ? natural : Math.min(natural, limit);
}

/** The layout with the note of one tab renamed, as a label that grows does. */
function renamed(layout: Layout, index: number, path: string): Layout {
  return {
    ...layout,
    tabs: layout.tabs.map((tab, at) =>
      at === index ? { ...tab, root: { ...tab.root, path } } : tab,
    ),
  };
}

/**
 * A ResizeObserver that reports only when the test fires it, as a browser does
 * after a layout. It fires only for an observer that still watches an element in
 * the document, and a disconnected one never fires. `made` lists the observers built.
 */
function fakeObserver() {
  const made: object[] = [];
  const live = new Set<{ callback: () => void; watched: Element[] }>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: () => void;
      watched: Element[] = [];

      constructor(callback: () => void) {
        this.callback = callback;
        made.push(this);
        live.add(this);
      }

      observe(element: Element) {
        this.watched.push(element);
      }
      unobserve(element: Element) {
        this.watched = this.watched.filter((watched) => watched !== element);
      }
      disconnect() {
        live.delete(this);
      }
    },
  );
  return {
    made,
    /** Whether a live observer watches the element. */
    observes(element: Element | null) {
      return [...live].some((observer) => observer.watched.includes(element as Element));
    },
    fire() {
      act(() => {
        for (const observer of live) {
          if (observer.watched.some((element) => element.isConnected)) observer.callback();
        }
      });
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

  it("#976 R5 the bar and the fold follow an active tab whose label grows past the cap", () => {
    // A 300 px row caps the active tab at 200 px, and this one is 150 px, under it.
    const widths = [60, 60, 60, 60, 150];
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return boxOf(this, widths[Number(this.dataset.tab)] ?? 0);
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute("role") === "tablist" ? 300 : 0;
    });
    const observer = fakeObserver();
    const layout = goToTab(tabsOf("a.md", "b.md", "c.md", "d.md", "e.md"), 4);
    const view = draw(layout);
    observer.fire();
    expect(screen.getByRole("button", { name: /more$/ }).textContent).toBe("3 more");

    // The label grows to 250 px. The tab stays at the cap, so its box does not change.
    widths[4] = 250;
    view.rerender(strip(renamed(layout, 4, "a-much-longer-name.md")));
    observer.fire();

    expect(screen.getByRole("button", { name: /more$/ }).textContent).toBe("4 more");
  });

  it("#976 R6 a tab that reaches the cap only once active is measured without the cap", () => {
    // The active tab draws 44 px wider, as the close x slot does on a phone.
    const widths = [60, 60, 60, 60, 170];
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      const selected = this.querySelector('[role="tab"]')?.getAttribute("aria-selected") === "true";
      return boxOf(this, (widths[Number(this.dataset.tab)] ?? 0) + (selected ? 44 : 0));
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute("role") === "tablist" ? 330 : 0;
    });
    const observer = fakeObserver();
    const layout = tabsOf("a.md", "b.md", "c.md", "d.md", "e.md");
    const view = draw(goToTab(layout, 0));
    observer.fire();

    view.rerender(strip(goToTab(layout, 4)));
    observer.fire();

    expect(screen.getByRole("button", { name: /more$/ }).textContent).toBe("4 more");
  });

  it("#976 R7 a new tab that replaces the last one at the same count is observed and gets its bar", () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"],
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute("role") === "tablist" ? 400 : 0;
    });
    const observer = fakeObserver();
    const view = draw(emptyLayout("a.md"));
    observer.fire();

    // Closing the last tab puts a new tab in its place: the count stays at one.
    view.rerender(strip(emptyLayout("b.md")));
    expect(observer.observes(document.querySelector('[data-tab="0"]'))).toBe(true);
    observer.fire();
    vi.advanceTimersByTime(1000);

    const bar = screen.getByRole("tablist").querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(bar?.style.transform).toBe("translateX(0px) scaleX(80)");
  });
});
