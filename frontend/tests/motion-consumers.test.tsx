import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { PaneLayout, TabStrip } from "@/components/pane-layout";
import { ReviewDecks } from "@/components/review-decks";
import * as api from "@/lib/api";
import {
  activeTab,
  addTab,
  emptyLayout,
  goToTab,
  type Layout,
  splitFocused,
  tabPanes,
} from "@/lib/panes";
import { DEFAULT_VIEWS, VIEWS_NOTE } from "@/lib/todo-view";
import { stubMatchMedia } from "./match-media";
import { HITS, seededClient, serveNotes } from "./review-pane-fixture";
import { renderPane as renderTodos, TODOS } from "./todo-pane-fixture";

// jsdom lays nothing out, so each tab is given a place in the strip: its left
// edge is 100 px per tab and its width 60 px and up.
function laidOut() {
  const place = (element: HTMLElement) =>
    Array.from(element.parentElement?.children ?? []).indexOf(element);
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return place(this) * 100;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return 60 + place(this) * 10;
  });
}

/** The bar the strip draws under its tabs, or null where the strip draws none. */
function bar(): HTMLElement | null {
  return screen.getByRole("tablist").querySelector<HTMLElement>('span[aria-hidden="true"]');
}

/** The tab's panes drawn the way the route draws them, each showing its note. */
function tabView(layout: Layout, narrow = false) {
  const tab = activeTab(layout);
  return (
    <PaneLayout
      node={tab.root}
      focus={tab.focus}
      divided={tabPanes(layout).length > 1}
      zoomed={tab.zoom === true ? tab.focus : null}
      onFocus={() => {}}
      tabId={tab.id}
      narrow={narrow}
    >
      {(pane) => pane.path ?? "empty"}
    </PaneLayout>
  );
}

function leaves(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-pane]")];
}

/** The pane the split made: the one of `after` that `before` did not have. */
function madeBy(before: Layout, after: Layout) {
  return tabPanes(after).find((pane) => !tabPanes(before).some((old) => old.id === pane.id));
}

const threeTabs = addTab(addTab(emptyLayout("a.md")));

describe("the consumers of the motion", () => {
  beforeEach(() => {
    vi.spyOn(api, "fetchTodos").mockResolvedValue([]);
    vi.spyOn(api, "fetchNote").mockResolvedValue(DEFAULT_VIEWS);
    vi.spyOn(api, "fetchFiles").mockResolvedValue([VIEWS_NOTE]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("the underline jumps under the active tab on first draw", () => {
    laidOut();

    render(<TabStrip layout={goToTab(threeTabs, 1)} onSelect={() => {}} />);

    expect(bar()?.style.transform).toBe("translateX(100px) scaleX(70)");
  });

  it("the underline glides to a newly selected tab on the tab spring", () => {
    laidOut();
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"],
    });
    const { rerender } = render(<TabStrip layout={goToTab(threeTabs, 0)} onSelect={() => {}} />);

    rerender(<TabStrip layout={goToTab(threeTabs, 1)} onSelect={() => {}} />);
    vi.advanceTimersByTime(100);

    const x = Number(/translateX\((-?[\d.]+)px\)/.exec(bar()?.style.transform ?? "")?.[1]);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(100);
    vi.advanceTimersByTime(1000);
    expect(bar()?.style.transform).toBe("translateX(100px) scaleX(70)");
  });

  it("the underline follows when a tab left of the active one closes", () => {
    laidOut();
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"],
    });
    const { rerender } = render(<TabStrip layout={goToTab(threeTabs, 2)} onSelect={() => {}} />);

    const closed: Layout = { ...threeTabs, tabs: threeTabs.tabs.slice(1), active: 1 };
    rerender(<TabStrip layout={closed} onSelect={() => {}} />);
    vi.advanceTimersByTime(1000);

    expect(bar()?.style.transform).toBe("translateX(100px) scaleX(70)");
  });

  it("a pane split off after the first draw slides in from the right and fades", async () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"],
    });
    const before = emptyLayout("a.md");
    const after = splitFocused(before, "row");
    const { container, rerender } = render(tabView(before));

    rerender(tabView(after));
    const element = container.querySelector<HTMLElement>(
      `[data-pane="${madeBy(before, after)?.id}"]`,
    );
    expect(element?.style.transform).toBe("translateX(36px)");
    expect(element?.style.opacity).toBe("0");
    vi.advanceTimersByTime(1000);
    // The inline style is cleared in the spring's promise, which runs after this turn.
    await act(async () => {});

    expect(element?.style.transform).toBe("");
    expect(element?.style.opacity).toBe("");
  });

  it("a stacked pane enters from below", () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"],
    });
    const before = emptyLayout("a.md");
    const after = splitFocused(before, "col");
    const { container, rerender } = render(tabView(before));

    rerender(tabView(after));
    const element = container.querySelector<HTMLElement>(
      `[data-pane="${madeBy(before, after)?.id}"]`,
    );

    expect(element?.style.transform).toBe("translateY(36px)");
    expect(element?.style.opacity).toBe("0");
  });

  it("panes on the first draw and on a tab switch do not slide", () => {
    const first = splitFocused(emptyLayout("a.md"), "row");
    const second = splitFocused(addTab(first), "col");
    const { container, rerender } = render(tabView(goToTab(second, 0)));

    expect(leaves(container)).toHaveLength(2);
    for (const leaf of leaves(container)) expect(leaf.style.transform).toBe("");

    // The second tab is drawn for the first time here, and its panes are new to
    // the window but not to the tab, so they are not new.
    rerender(tabView(goToTab(second, 1)));

    expect(leaves(container)).toHaveLength(2);
    for (const leaf of leaves(container)) expect(leaf.style.transform).toBe("");
  });

  it("deck rows of the first load enter staggered, a deck added later does not", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);
    const client = seededClient(HITS);
    render(
      <QueryClientProvider client={client}>
        <ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />
      </QueryClientProvider>,
    );
    const row = (name: string) =>
      screen.getByRole("button", { name: new RegExp(name) }).closest("li");

    await waitFor(() => expect(row("alpha")).toHaveClass("k-enter"));
    expect(
      ["alpha", "beta", "zeta"].map((name) => row(name)?.style.getPropertyValue("--i")),
    ).toEqual(["0", "1", "2"]);

    const next = [
      ...HITS,
      { path: "c.md", line: 1, text: "#flashcards/gamma" },
      { path: "c.md", line: 2, text: "x::y" },
    ];
    serveNotes(next);
    act(() => client.setQueryData(["cards", false], next));

    await screen.findByRole("button", { name: /gamma/ });
    expect(row("gamma")).not.toHaveClass("k-enter");
  });

  it("todo rows of the first load enter staggered, a row added later does not", async () => {
    const pane = renderTodos(TODOS);
    const rows = () => [...document.querySelectorAll<HTMLElement>("[data-row]")];

    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(rows().filter((row) => !row.classList.contains("k-enter"))).toHaveLength(0);
    expect(rows().map((row) => row.style.getPropertyValue("--i"))).toEqual(
      rows().map((_, index) => String(index)),
    );

    pane.answer([
      ...TODOS,
      { path: "projects/kasten.md", line: 40, text: "- [ ] added later 📅 2026-08-10" },
    ]);

    const added = await screen.findByText(/added later/);
    expect(added.closest("[data-row]")).not.toHaveClass("k-enter");
  });

  it("under reduced motion the underline and a new pane land at once", async () => {
    laidOut();
    stubMatchMedia({ "(prefers-reduced-motion: reduce)": true });
    const { rerender } = render(<TabStrip layout={goToTab(threeTabs, 0)} onSelect={() => {}} />);

    rerender(<TabStrip layout={goToTab(threeTabs, 1)} onSelect={() => {}} />);
    expect(bar()?.style.transform).toBe("translateX(100px) scaleX(70)");

    const before = emptyLayout("a.md");
    const after = splitFocused(before, "row");
    const view = render(tabView(before));
    view.rerender(tabView(after));
    const element = view.container.querySelector<HTMLElement>(
      `[data-pane="${madeBy(before, after)?.id}"]`,
    );
    await waitFor(() => expect(element?.style.transform).toBe(""));
    expect(element?.style.opacity).toBe("");
  });
});
