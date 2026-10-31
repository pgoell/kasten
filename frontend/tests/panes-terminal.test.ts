import { mapPanes } from "@/lib/pane-contents";
import { emptyLayout, fillFocused, focusedPane, splitFocused, tabPanes } from "@/lib/panes";
import { notes } from "./panes-fixture";

describe("a terminal in a pane", () => {
  it("puts the session on the focused pane and keeps its id", () => {
    const layout = emptyLayout();
    const before = focusedPane(layout).id;

    const opened = fillFocused(layout, { term: "kasten" });

    expect(focusedPane(opened).term).toBe("kasten");
    // The tab names its focused pane by id, so a new one would lose track of it.
    expect(focusedPane(opened).id).toBe(before);
  });

  it("takes the note out of the pane it replaces", () => {
    // The pane is written whole the way `openInFocused` writes it, so a line
    // left over from a search hit cannot survive into a terminal either.
    const layout = fillFocused(emptyLayout("a.md", 12), { term: "kasten" });

    expect(focusedPane(layout).path).toBeUndefined();
    expect(focusedPane(layout).line).toBeUndefined();
  });

  it("is taken out of the pane by a clear, leaving the pane on screen", () => {
    // What `<leader>q` and the terminal's own close chord reach. A terminal
    // pane holds no note, so the route used to send it straight to the removal
    // instead, which does nothing at all on the last pane of the last tab: a
    // window holding one terminal had no way back to an editor.
    const layout = fillFocused(fillFocused(emptyLayout(), { term: "kasten" }), {});

    expect(focusedPane(layout).term).toBeUndefined();
    expect(focusedPane(layout).path).toBeUndefined();
    expect(tabPanes(layout)).toHaveLength(1);
  });

  it("is skipped by a note that moved, with no code of its own", () => {
    // `mapPanes` follows a move by keying on `path`, and a terminal pane has
    // none. That is the whole reason `term` sits beside `path` rather than
    // replacing it with a union.
    const split = fillFocused(splitFocused(emptyLayout("a.md"), "row"), { term: "kasten" });

    const layout = mapPanes(split, (pane) =>
      pane.path === "a.md" ? { ...pane, path: "moved/a.md" } : pane,
    );

    expect(tabPanes(layout).map((pane) => pane.term ?? null)).toEqual([null, "kasten"]);
    expect(notes(layout)).toEqual(["moved/a.md", null]);
  });
});
