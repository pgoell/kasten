import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { TabStrip } from "@/components/tab-strip";
import { TopBar } from "@/components/top-bar";
import type { TreeCommands } from "@/lib/key-bindings";
import { openInFocused } from "@/lib/pane-contents";
import { addTab, emptyLayout, goToTab, type Layout } from "@/lib/panes";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

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

/** Eight tabs, each holding its own note, the last one active. */
function eight(): Layout {
  let layout = emptyLayout("note-0.md");
  for (let index = 1; index < 8; index++) {
    layout = openInFocused(addTab(layout), `note-${index}.md`);
  }
  return layout;
}

/**
 * jsdom lays nothing out, so each tab is given the width in `widths` and the row
 * the room `room`, with each tab placed after the ones before it.
 */
function laidOut(widths: number[], room: number) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return widths[Number(this.dataset.tab)] ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    const tab = Number(this.dataset.tab);
    return Number.isNaN(tab) ? 0 : widths.slice(0, tab).reduce((sum, width) => sum + width, 0);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute("role") === "tablist" ? room : 0;
  });
}

/** jsdom keeps no scroll position, so each element keeps the one it is set to. */
function scrollable() {
  const at = new WeakMap<Element, number>();
  Object.defineProperty(HTMLElement.prototype, "scrollLeft", {
    configurable: true,
    get(this: HTMLElement) {
      return at.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      at.set(this, value);
    },
  });
}

const EIGHT = [100, 100, 100, 100, 100, 100, 100, 100];

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollLeft");
});

describe("#793 phone chrome: the tab strip", () => {
  it("#793 A2 in a narrow window the strip draws every tab and no N more", () => {
    laidOut(EIGHT, 300);

    render(strip(eight(), { narrow: true }));

    expect(screen.getAllByRole("tab")).toHaveLength(8);
    expect(screen.queryByRole("button", { name: /\d+ more/ })).toBeNull();
  });

  it("#793 A2 in a wide window the strip still folds behind N more", () => {
    laidOut(EIGHT, 300);

    render(strip(eight()));

    expect(screen.queryByRole("button", { name: /\d+ more/ })).not.toBeNull();
  });

  it("#793 A2 in a narrow window the active tab is brought into the row", () => {
    laidOut(EIGHT, 300);
    scrollable();

    render(strip(goToTab(eight(), 7), { narrow: true }));

    // The last tab spans 700 to 800 px, so the row shows 500 to 800 px of the strip.
    expect(screen.getByRole("tablist").scrollLeft).toBe(500);
  });

  it("#793 A2 in a narrow window the row goes back to a tab picked at its start", () => {
    laidOut(EIGHT, 300);
    scrollable();
    const layout = eight();
    const { rerender } = render(strip(goToTab(layout, 7), { narrow: true }));
    // The row sits at the last tab before the pick goes back to the first.
    screen.getByRole("tablist").scrollLeft = 500;

    rerender(strip(goToTab(layout, 0), { narrow: true }));

    expect(screen.getByRole("tablist").scrollLeft).toBe(0);
  });

  it("#793 I3 a narrow strip turned wide folds again, and narrow again draws every tab", () => {
    laidOut(EIGHT, 300);
    const layout = eight();
    const { rerender } = render(strip(layout, { narrow: true }));
    expect(screen.getAllByRole("tab")).toHaveLength(8);

    rerender(strip(layout, { narrow: false }));
    expect(screen.queryByRole("button", { name: /\d+ more/ })).not.toBeNull();

    rerender(strip(layout, { narrow: true }));
    expect(screen.getAllByRole("tab")).toHaveLength(8);
  });

  it("#793 A3 the strip's text is 15 px under a finger on a phone", () => {
    render(strip(eight(), { narrow: true }));

    expect(screen.getByRole("tablist").parentElement).toHaveClass(
      "max-md:pointer-coarse:text-k-15",
    );
  });
});

describe("#793 phone chrome: the top bar", () => {
  // The bar's own commands are the only ones it runs, so the rest are stubs.
  const commands = {
    createNote: vi.fn(),
    findNote: vi.fn(),
    toggleTree: vi.fn(),
    openGraph: vi.fn(),
    searchNotes: vi.fn(),
  } as unknown as TreeCommands;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("#793 A1 on a phone the top bar's new note button is a + named New note and runs createNote", () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });

    render(<TopBar commands={commands} count={2} />);
    const button = screen.getByRole("button", { name: "New note" });
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).not.toBeNull();

    fireEvent.click(button);
    expect(commands.createNote).toHaveBeenCalledTimes(1);
  });

  it("#793 A1 on a desktop the top bar still reads New note", () => {
    render(<TopBar commands={commands} count={2} />);

    expect(screen.getByRole("button", { name: "New note" }).textContent).toBe("New note");
  });

  it("#793 A3 on a phone the top bar's field is 15 px and at least 44 px tall under a finger", () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });

    render(<TopBar commands={commands} count={2} />);

    const field = screen.getByRole("button", { name: "Search 2 notes" });
    expect(field).toHaveClass("text-k-15", "pointer-coarse:min-h-11");
  });

  it("#793 A3 on a desktop the top bar's field stays 13 px", () => {
    render(<TopBar commands={commands} count={2} />);

    expect(screen.getByRole("button", { name: "Search 2 notes" })).toHaveClass("text-k-13");
  });
});
