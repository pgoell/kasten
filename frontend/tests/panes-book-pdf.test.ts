import { openBeside, openPdfBeside, openPdfInFocused } from "@/lib/pane-contents";
import { emptyLayout, focusedPane, nextPane, tabPanes } from "@/lib/panes";
import { notes } from "./panes-fixture";

describe("a book in a pane beside its note", () => {
  it("splits the focused pane and puts the book in the new one", () => {
    const layout = openBeside(
      emptyLayout("lit/DDIA.md"),
      (pane) => pane.book === "lit/DDIA.md",
      { book: "lit/DDIA.md" },
      "row",
    );

    // The note stays where it was. A key called "read this book beside this
    // note" must not eat the note.
    expect(tabPanes(layout).map((pane) => pane.path ?? null)).toEqual(["lit/DDIA.md", null]);
    expect(tabPanes(layout).map((pane) => pane.book ?? null)).toEqual([null, "lit/DDIA.md"]);
  });

  it("leaves the focus on the reader", () => {
    const layout = openBeside(
      emptyLayout("lit/DDIA.md"),
      (pane) => pane.book === "lit/DDIA.md",
      { book: "lit/DDIA.md" },
      "row",
    );

    expect(focusedPane(layout).book).toBe("lit/DDIA.md");
  });

  it("goes to the pane already reading that book rather than making a second", () => {
    const once = openBeside(
      emptyLayout("lit/DDIA.md"),
      (pane) => pane.book === "lit/DDIA.md",
      { book: "lit/DDIA.md" },
      "row",
    );
    const reader = focusedPane(once).id;

    const twice = openBeside(
      nextPane(once),
      (pane) => pane.book === "lit/DDIA.md",
      { book: "lit/DDIA.md" },
      "row",
    );

    expect(tabPanes(twice)).toHaveLength(2);
    expect(focusedPane(twice).id).toBe(reader);
  });
});

describe("a pdf in a pane beside the note naming it", () => {
  it("splits the focused pane and puts the pdf, at its page, in the new one", () => {
    const layout = openPdfBeside(emptyLayout("index.md"), "docs/plan.pdf", 3);

    expect(notes(layout)).toEqual(["index.md", null]);
    expect(focusedPane(layout).pdf).toEqual({ path: "docs/plan.pdf", page: 3, opened: 1 });
  });

  it("I2 turns the pane already showing that pdf to the new page, no second pane", () => {
    const once = openPdfBeside(emptyLayout("index.md"), "docs/plan.pdf", 3);
    const viewer = focusedPane(once).id;

    const twice = openPdfBeside(nextPane(once), "docs/plan.pdf", 5);

    expect(tabPanes(twice)).toHaveLength(2);
    expect(focusedPane(twice).id).toBe(viewer);
    expect(focusedPane(twice).pdf).toEqual({ path: "docs/plan.pdf", page: 5, opened: 2 });
  });

  it("B counts a second open at the same page as a new one", () => {
    const once = openPdfBeside(emptyLayout("index.md"), "docs/plan.pdf", 3);

    const twice = openPdfBeside(nextPane(once), "docs/plan.pdf", 3);

    expect(focusedPane(twice).pdf).toEqual({ path: "docs/plan.pdf", page: 3, opened: 2 });
  });
});

describe("a pdf in the focused pane, from a row of the tree", () => {
  it("I1 takes the note out of the pane it replaces, at page 1, keeping its id", () => {
    const before = emptyLayout("index.md", 12);
    const layout = openPdfInFocused(before, "docs/plan.pdf");

    expect(tabPanes(layout)).toHaveLength(1);
    expect(focusedPane(layout).id).toBe(focusedPane(before).id);
    expect(focusedPane(layout).path).toBeUndefined();
    expect(focusedPane(layout).line).toBeUndefined();
    expect(focusedPane(layout).pdf).toEqual({ path: "docs/plan.pdf", page: undefined, opened: 1 });
  });

  it("I1 counts a second open of the pdf the pane already shows as a new one", () => {
    // The pane reopens at `page` only when `opened` moves, and the reader may
    // have scrolled off page 1 since: a second click on the row must take
    // them back to it, as a second click on an image row shows the image.
    const once = openPdfInFocused(emptyLayout(), "docs/plan.pdf");
    const twice = openPdfInFocused(once, "docs/plan.pdf");

    expect(focusedPane(twice).pdf).toEqual({ path: "docs/plan.pdf", page: undefined, opened: 2 });
  });

  it("I1 starts the count again for another pdf", () => {
    const once = openPdfInFocused(emptyLayout(), "docs/plan.pdf");
    const other = openPdfInFocused(once, "docs/other.pdf");

    expect(focusedPane(other).pdf).toEqual({ path: "docs/other.pdf", page: undefined, opened: 1 });
  });
});
