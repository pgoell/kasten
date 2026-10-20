import { clearFocused, openImageInFocused, openTodosInFocused } from "@/lib/pane-contents";
import { emptyLayout, focusedPane, tabPanes } from "@/lib/panes";

describe("the todo list in a pane", () => {
  it("takes the note out of the pane it replaces, keeping its id", () => {
    const before = emptyLayout("a.md", 12);
    const layout = openTodosInFocused(before);

    expect(focusedPane(layout).todos).toBe(true);
    expect(focusedPane(layout).path).toBeUndefined();
    expect(focusedPane(layout).line).toBeUndefined();
    // The tab names its focused pane by id, so a new one would lose track of it.
    expect(focusedPane(layout).id).toBe(focusedPane(before).id);
  });

  it("is taken out of the pane by a clear, leaving the pane on screen", () => {
    // What `<leader>q` reaches. Emptying rather than removing, so a window
    // holding only the todo list has a way back to an editor.
    const layout = clearFocused(openTodosInFocused(emptyLayout()));

    expect(focusedPane(layout).todos).toBeUndefined();
    expect(tabPanes(layout)).toHaveLength(1);
  });
});

describe("an image in a pane", () => {
  it("takes the note out of the pane it replaces, keeping its id", () => {
    const before = emptyLayout("a.md", 12);
    const layout = openImageInFocused(before, "99 Misc/shot.png");

    expect(focusedPane(layout).image).toBe("99 Misc/shot.png");
    expect(focusedPane(layout).path).toBeUndefined();
    expect(focusedPane(layout).line).toBeUndefined();
    expect(focusedPane(layout).id).toBe(focusedPane(before).id);
  });

  it("is taken out of the pane by a clear, leaving the pane on screen", () => {
    // What `<leader>q` reaches, the way it reaches the todo list above: a window
    // holding one image has to have a way back to an editor.
    const layout = clearFocused(openImageInFocused(emptyLayout(), "99 Misc/shot.png"));

    expect(focusedPane(layout).image).toBeUndefined();
    expect(tabPanes(layout)).toHaveLength(1);
  });
});
