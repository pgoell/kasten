import { openNoteBeside, openPdfInFocused } from "@/lib/pane-contents";
import { emptyLayout, focusedPane, nextPane, tabPanes } from "@/lib/panes";

describe("a pdf's note beside the pdf", () => {
  it("splits the pdf's pane to the right and puts the note in the new one", () => {
    const pdf = openPdfInFocused(emptyLayout(), "x/my plan.pdf");

    const layout = openNoteBeside(pdf, "x/my plan.md");

    expect(tabPanes(layout).map((pane) => pane.pdf?.path ?? null)).toEqual(["x/my plan.pdf", null]);
    expect(tabPanes(layout).map((pane) => pane.path ?? null)).toEqual([null, "x/my plan.md"]);
    expect(layout.tabs[0]?.root).toMatchObject({ dir: "row" });
    expect(focusedPane(layout).path).toBe("x/my plan.md");
  });

  it("goes to the pane already holding that note rather than making a second", () => {
    const pdf = openPdfInFocused(emptyLayout(), "x/my plan.pdf");
    const once = openNoteBeside(pdf, "x/my plan.md");
    const note = focusedPane(once).id;

    const twice = openNoteBeside(nextPane(once), "x/my plan.md");

    expect(tabPanes(twice)).toHaveLength(2);
    expect(focusedPane(twice).id).toBe(note);
  });
});
