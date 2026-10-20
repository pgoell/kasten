import { mapPanes, openInFocused } from "@/lib/pane-contents";
import { addTab, emptyLayout, goToTab, splitFocused } from "@/lib/panes";
import { notes } from "./panes-fixture";

describe("following a note that moved", () => {
  it("rewrites the path in every pane holding it, across tabs", () => {
    const split = openInFocused(splitFocused(emptyLayout("a.md"), "row"), "a.md");
    const both = addTab(split);
    const opened = openInFocused(both, "a.md");

    const layout = mapPanes(opened, (pane) =>
      pane.path === "a.md" ? { ...pane, path: "moved/a.md" } : pane,
    );

    expect(notes(layout)).toEqual(["moved/a.md"]);
    expect(notes(goToTab(layout, 0))).toEqual(["moved/a.md", "moved/a.md"]);
  });

  it("leaves the panes holding other notes alone", () => {
    const two = openInFocused(splitFocused(emptyLayout("a.md"), "row"), "b.md");

    const layout = mapPanes(two, (pane) =>
      pane.path === "b.md" ? { ...pane, path: "moved/b.md" } : pane,
    );

    expect(notes(layout)).toEqual(["a.md", "moved/b.md"]);
  });
});
