import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { isUnsaved, resetStripEntrance, TabStrip } from "@/components/tab-strip";
import {
  openBookBeside,
  openExamInFocused,
  openGraphBeside,
  openGraphInFocused,
  openHtmlInFocused,
  openImageInFocused,
  openInFocused,
  openPdfBeside,
  openPersonBeside,
  openReviewInFocused,
} from "@/lib/pane-contents";
import { addTab, emptyLayout, goToTab, type Layout } from "@/lib/panes";
import { foldTabs } from "@/lib/tab-fold";

type Props = Partial<ComponentProps<typeof TabStrip>>;

/** The strip as the route draws it, with every handler a test does not name left out. */
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

/** Tabs named by these notes: the first is the window's own, each other one a new tab holding its note. */
function tabsOf(...paths: string[]): Layout {
  return paths
    .slice(1)
    .reduce((layout, path) => openInFocused(addTab(layout), path), emptyLayout(paths[0]));
}

/**
 * jsdom lays nothing out, so each tab is given the width in `widths` and the
 * strip the room `room`. A strip with no room reads as not laid out.
 */
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

/** The names of the tabs on screen, which leaves out the ones behind "N more". */
function shownNames(): string[] {
  return screen.getAllByRole("tab").map((tab) => tab.textContent ?? "");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TabStrip", () => {
  it("A1 is drawn with one tab, 40px tall under the top bar and 44px under a finger", () => {
    draw(emptyLayout());

    const row = screen.getByRole("button", { name: "Today" }).parentElement;
    expect(row).toHaveClass("h-10", "sticky", "top-0", "k-glass", "k-hairline");
    expect(row).toHaveClass("pointer-coarse:h-11");
  });

  it("names each tab by the note in the pane it left focused", () => {
    const layout = addTab(emptyLayout("ideas/borges.md"));

    draw(layout);

    expect(screen.getByRole("tab", { name: /borges/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /New tab/ })).toBeInTheDocument();
  });

  it("names a tab sitting an exam by the exam's note", () => {
    draw(openExamInFocused(addTab(emptyLayout()), "borges.md"));

    expect(screen.getAllByRole("tab")[1]).toHaveTextContent("borges");
  });

  it("names a tab showing a person card by the person", () => {
    draw(openPersonBeside(addTab(emptyLayout()), "ada.md"));

    expect(screen.getAllByRole("tab")[1]).toHaveTextContent("ada");
  });

  it("names a tab drawing the whole vault graph view", () => {
    draw(openGraphInFocused(addTab(emptyLayout())));

    expect(screen.getAllByRole("tab")[1]).toHaveTextContent("graph view");
  });

  it("names a tab holding the review review", () => {
    draw(openReviewInFocused(addTab(emptyLayout())));

    expect(screen.getAllByRole("tab")[1]).toHaveTextContent("review");
  });

  it("names a tab drawing the graph around a note by that note", () => {
    draw(openGraphBeside(addTab(emptyLayout()), "ideas/borges.md"));

    expect(screen.getAllByRole("tab")[1]).toHaveTextContent("graph of borges");
  });

  it("names a person or exam tab without the folder or the suffix", () => {
    const person = openPersonBeside(addTab(emptyLayout()), "people/Ada Lovelace.md");
    const exam = openExamInFocused(addTab(person), "notes/Borges.md");

    draw(exam);

    const tabs = screen.getAllByRole("tab");
    expect(tabs[1]).toHaveTextContent("Ada Lovelace");
    expect(tabs[2]).toHaveTextContent("Borges");
  });

  // jsdom applies no media query, so this reads the class that carries one.
  it("makes the strip 44px tall under a finger", () => {
    draw(addTab(emptyLayout()));

    expect(screen.getByRole("tablist").parentElement).toHaveClass("pointer-coarse:h-11");
  });

  it("marks the tab on screen and no other", () => {
    draw(addTab(emptyLayout("a.md")));

    const selected = screen.getAllByRole("tab").filter((tab) => tab.ariaSelected === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("New tab");
  });

  it("keys the tenth tab Space 0, which is the key that reaches it", () => {
    let layout = emptyLayout();
    for (let index = 0; index < 9; index += 1) layout = addTab(layout);

    draw(layout);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(10);
    expect(tabs[9]).toHaveAttribute("aria-keyshortcuts", "Space 0");
    expect(tabs[0]).toHaveAttribute("aria-keyshortcuts", "Space 1");
  });

  it("goes to the tab that was clicked", () => {
    const onSelect = vi.fn();
    draw(addTab(emptyLayout("a.md")), { onSelect });

    screen.getByRole("tab", { name: /a$/ }).click();

    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("names a tab whose focused pane holds a book after the note", () => {
    // Without this, `tabLabel` reads `term`, `todos` then `path` and calls a
    // reader `New tab`, and every other test in this branch still passes.
    const layout = addTab(openBookBeside(emptyLayout("lit/DDIA.md"), "lit/DDIA.md"));

    draw(layout);

    expect(screen.getByRole("tab", { name: /DDIA/ })).toBeInTheDocument();
  });

  // Obsidian names a tab by the file's base name, and so does this: the suffix
  // goes, the folder goes, and the space inside the name stays.
  it("A1 names a tab whose focused pane holds a pdf after the pdf, not New tab", () => {
    const layout = addTab(openPdfBeside(emptyLayout(), "x/my plan.pdf", 3));

    draw(layout);

    expect(screen.getByRole("tab", { name: "my plan" })).toBeInTheDocument();
  });

  it("A2 names a tab whose focused pane holds an image after the image, not New tab", () => {
    const layout = addTab(openImageInFocused(emptyLayout(), "media/diagram.png"));

    draw(layout);

    expect(screen.getByRole("tab", { name: "diagram" })).toBeInTheDocument();
  });

  it("I7 names a tab whose focused pane holds an HTML page after the page, not New tab", () => {
    const layout = addTab(openHtmlInFocused(emptyLayout(), "research/report.html"));

    draw(layout);

    expect(screen.getByRole("tab", { name: "report" })).toBeInTheDocument();
  });

  it("folds the tabs that do not fit rather than scrolling them", () => {
    draw(addTab(emptyLayout("a.md")));

    expect(screen.getByRole("tablist")).toHaveClass("overflow-hidden");
    expect(screen.getByRole("tablist")).not.toHaveClass("overflow-x-auto");
  });

  it("A2 Today sits first in italic serif, then a divider, then the open tabs", () => {
    draw(addTab(emptyLayout("a.md")));

    const home = screen.getByRole("button", { name: "Today" });
    expect(home).toHaveClass("font-serif", "italic");
    const divider = home.nextElementSibling;
    expect(divider).toHaveAttribute("aria-hidden", "true");
    expect(divider).toHaveClass("w-px", "bg-k-rule");
    expect(divider?.nextElementSibling).toBe(screen.getByRole("tablist"));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("A2 Today reads ink only while the active tab is one empty pane, and goes home when pressed", () => {
    const onHome = vi.fn();
    const layout = addTab(emptyLayout("a.md"));
    const view = draw(layout, { onHome });

    expect(screen.getByRole("button", { name: "Today" })).toHaveClass("text-k-ink");
    view.rerender(strip(goToTab(layout, 0), { onHome }));
    expect(screen.getByRole("button", { name: "Today" })).toHaveClass("text-k-muted");

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onHome).toHaveBeenCalledOnce();
  });

  it("A3 shows the kind icon of the pane each tab has focused", () => {
    let layout = openPdfBeside(emptyLayout(), "x/my plan.pdf");
    layout = openReviewInFocused(addTab(layout));
    layout = openGraphInFocused(addTab(layout));
    layout = openBookBeside(addTab(layout), "lit/DDIA.md");
    layout = openInFocused(addTab(layout), "a.md");

    draw(layout);

    const kinds = screen
      .getAllByRole("tab")
      .map((tab) => tab.querySelector("[data-kind]")?.getAttribute("data-kind"));
    expect(kinds).toEqual(["pdf", "review", "graph", "book", "page"]);
  });

  it("A3 cuts a long title with an ellipsis, and caps the tab at 200px", () => {
    draw(emptyLayout("a-very-long-name-of-a-note-that-runs-on-and-on.md"));

    const tab = screen.getByRole("tab");
    // The cap is on the whole tab, the x included, which is the tab's wrapper.
    expect(tab.parentElement).toHaveClass("max-w-[200px]");
    expect(tab.querySelector("span")).toHaveClass("truncate");
  });

  it("A4 names the close x of each tab for screen readers, and shows it on the active tab", () => {
    draw(tabsOf("a.md", "b.md"));

    expect(screen.getByRole("button", { name: "Close b" })).not.toHaveClass("invisible");
  });

  it("A4 hides the close x of a tab that is not active until the tab is hovered", () => {
    draw(tabsOf("a.md", "b.md"));

    expect(screen.getByRole("button", { name: "Close a" })).toHaveClass(
      "invisible",
      "group-hover:visible",
    );
  });

  it("A5 the active tab is ink under the 2px accent underline, and the others fill with the wash on hover", () => {
    draw(addTab(emptyLayout("a.md")));

    const [first, second] = screen.getAllByRole("tab");
    expect(second).toHaveClass("text-k-ink");
    // The wash is on the tab's wrapper, so the close x is washed with the tab (R7).
    expect(first?.parentElement).toHaveClass("hover:bg-k-accent-wash");
    const bar = screen.getByRole("tablist").querySelector('span[aria-hidden="true"]');
    expect(bar).toHaveClass("h-0.5", "bg-k-accent");
  });

  it("A6 an unsaved tab shows a dot where the x is, and says so to a screen reader", () => {
    draw(emptyLayout("a.md"), { unsaved: () => true });

    const tab = screen.getByRole("tab", { name: "a (unsaved)" });
    expect(tab.parentElement?.querySelector(".rounded-full")).toBeInTheDocument();
  });

  it("I7 an unsaved tab shows the x in place of the dot on hover, so it can still be closed", () => {
    draw(tabsOf("a.md", "b.md"), { unsaved: () => true });

    const tab = screen.getByRole("tab", { name: "a (unsaved)" });
    expect(tab.parentElement?.querySelector(".rounded-full")).toHaveClass("group-hover:hidden");
    expect(screen.getByRole("button", { name: "Close a" })).toHaveClass(
      "invisible",
      "group-hover:visible",
    );
  });

  it("I1 the close x of the active tab asks for that tab to be closed", () => {
    const onClose = vi.fn();
    draw(addTab(emptyLayout("a.md")), { onClose });

    fireEvent.click(screen.getByRole("button", { name: "Close New tab" }));

    expect(onClose).toHaveBeenCalledWith(1);
  });

  it("I3 a click on the x of a tab that is not active closes that tab and selects nothing", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    draw(tabsOf("a.md", "b.md"), { onClose, onSelect });

    fireEvent.click(screen.getByRole("button", { name: "Close a" }));

    expect(onClose).toHaveBeenCalledWith(0);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("I4 Left and Right move the focus between the tabs, and Home and End go to the ends", () => {
    const onSelect = vi.fn();
    draw(tabsOf("a.md", "b.md", "c.md"), { onSelect });
    const tabs = () => screen.getAllByRole("tab");

    tabs()[2]?.focus();
    fireEvent.keyDown(tabs()[2] as HTMLElement, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tabs()[1]);
    fireEvent.keyDown(tabs()[1] as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(tabs()[0]);
    fireEvent.keyDown(tabs()[0] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(tabs()[2]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("I4 only the active tab is in the tab order, so the tablist is one tab stop", () => {
    draw(tabsOf("a.md", "b.md", "c.md"));

    expect(screen.getAllByRole("tab").map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("I4 Delete closes the tab the focus is on", () => {
    const onClose = vi.fn();
    draw(tabsOf("a.md", "b.md"), { onClose });

    fireEvent.keyDown(screen.getAllByRole("tab")[0] as HTMLElement, { key: "Delete" });

    expect(onClose).toHaveBeenCalledWith(0);
  });

  it("I2 Today is a button outside the tabs, and a press asks for home", () => {
    const onHome = vi.fn();
    draw(tabsOf("a.md", "b.md"), { onHome });

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onHome).toHaveBeenCalledOnce();
  });

  it("A7 tabs that do not fit go behind N more, and only the ones that fit are drawn", () => {
    laidOut([50, 50, 50, 50, 50], 220);

    draw(goToTab(tabsOf("a.md", "b.md", "c.md", "d.md", "e.md"), 0));

    expect(shownNames()).toEqual(["a", "b"]);
    expect(screen.getByRole("button", { name: "3 more" })).toHaveAttribute("aria-haspopup", "menu");
  });

  it("I6 N more opens a list of the hidden tabs, and a pick selects that tab and closes the list", () => {
    laidOut([50, 50, 50, 50, 50], 220);
    const onSelect = vi.fn();
    draw(goToTab(tabsOf("a.md", "b.md", "c.md", "d.md", "e.md"), 0), { onSelect });

    fireEvent.click(screen.getByRole("button", { name: "3 more" }));
    expect(screen.getAllByRole("menuitem").map((row) => row.textContent)).toEqual(["c", "d", "e"]);

    fireEvent.click(screen.getByRole("menuitem", { name: "d" }));

    expect(onSelect).toHaveBeenCalledWith(3);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("I6 Escape closes the list and gives the focus back to the button", () => {
    laidOut([50, 50, 50, 50, 50], 220);
    draw(goToTab(tabsOf("a.md", "b.md", "c.md", "d.md", "e.md"), 0));
    const more = screen.getByRole("button", { name: "3 more" });

    fireEvent.click(more);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("I6 a click outside the list closes it", () => {
    laidOut([50, 50, 50, 50, 50], 220);
    draw(goToTab(tabsOf("a.md", "b.md", "c.md", "d.md", "e.md"), 0));

    fireEvent.click(screen.getByRole("button", { name: "3 more" }));
    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("I6 the arrow keys move between the rows of the list", () => {
    laidOut([50, 50, 50, 50, 50], 220);
    draw(goToTab(tabsOf("a.md", "b.md", "c.md", "d.md", "e.md"), 0));

    fireEvent.click(screen.getByRole("button", { name: "3 more" }));
    expect(document.activeElement).toHaveTextContent("c");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toHaveTextContent("d");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toHaveTextContent("c");
  });

  it("I5 a pick from N more keeps the picked tab in view, swapped in for the last one drawn", () => {
    laidOut([50, 50, 50, 50, 50], 220);
    const layout = goToTab(tabsOf("a.md", "b.md", "c.md", "d.md", "e.md"), 0);
    const view = draw(layout);

    view.rerender(strip(goToTab(layout, 3)));

    expect(screen.getByRole("tab", { name: "d" })).toHaveAttribute("aria-selected", "true");
    expect(shownNames()).toEqual(["a", "d"]);
  });

  it("A16 a tab switch that moves the fold is drawn in the same render, not a frame later", () => {
    laidOut([50, 50, 50, 50, 50], 220);
    const layout = goToTab(tabsOf("a.md", "b.md", "c.md", "d.md", "e.md"), 0);
    const view = draw(layout);

    view.rerender(strip(goToTab(layout, 4)));

    expect(shownNames()).toEqual(["a", "e"]);
  });

  it("A14 the strip's entrance plays on the first mount only", () => {
    resetStripEntrance();
    const first = draw(tabsOf("a.md", "b.md"));
    expect(screen.getByRole("button", { name: "Today" }).parentElement).toHaveClass("k-enter");

    first.unmount();
    draw(tabsOf("a.md", "b.md"));

    expect(screen.getByRole("button", { name: "Today" }).parentElement).not.toHaveClass("k-enter");
  });

  it("A14 a tab switch does not play the entrance again", () => {
    resetStripEntrance();
    const layout = tabsOf("a.md", "b.md");
    const view = draw(layout);
    const row = screen.getByRole("button", { name: "Today" }).parentElement;

    view.rerender(strip(goToTab(layout, 0)));

    expect(screen.getByRole("button", { name: "Today" }).parentElement).toBe(row);
    expect(row).toHaveClass("k-enter");
  });
});

describe("foldTabs", () => {
  it("A7 draws every tab when they all fit, and keeps no room back for the button", () => {
    expect(foldTabs([50, 50], 100, 0, 88)).toEqual({ shown: [0, 1], hidden: [] });
  });

  it("A7 draws the tabs from the left that fit beside the N more button", () => {
    expect(foldTabs([50, 50, 50, 50, 50], 220, 0, 88)).toEqual({
      shown: [0, 1],
      hidden: [2, 3, 4],
    });
  });

  it("I5 keeps the room for the button only once something is behind it", () => {
    // 150 px of tabs in 140 px: one tab must go, and 30 px must stay for the button.
    expect(foldTabs([50, 50, 50], 140, 0, 30)).toEqual({ shown: [0, 1], hidden: [2] });
  });

  it("I5 swaps the active tab in for the last tab drawn when it is behind the button", () => {
    expect(foldTabs([50, 50, 50, 50, 50], 220, 4, 88)).toEqual({
      shown: [0, 4],
      hidden: [1, 2, 3],
    });
  });

  it("I5 draws only the active tab when no tab fits beside the button", () => {
    expect(foldTabs([50, 50, 50], 0, 1, 30)).toEqual({ shown: [1], hidden: [0, 2] });
  });
});

describe("isUnsaved", () => {
  it("A6 holds for held text in any pane of a tab, and for the focused pane of the active tab while unsaved", () => {
    const [, second] = openInFocused(addTab(emptyLayout("a.md")), "b.md").tabs;
    if (second === undefined) throw new Error("two tabs were made");

    // Held text is what is not in the vault, whichever tab it sits in.
    expect(isUnsaved(second, false, [{ path: "b.md" }], "saved")).toBe(true);
    // The autosave follows the focused pane of the active tab alone.
    expect(isUnsaved(second, true, [], "unsaved")).toBe(true);
    expect(isUnsaved(second, false, [], "unsaved")).toBe(false);
    expect(isUnsaved(second, true, [], "saved")).toBe(false);
    expect(isUnsaved(second, true, [{ path: "a.md" }], "saved")).toBe(false);
  });
});
