import { render, screen } from "@testing-library/react";
import { cursor, Harness, press, renderTree, tree } from "./file-explorer-fixture";

describe("the tree keyboard", () => {
  // Rows in display order, with `daily` and `projects` unfolded:
  // daily, 2026-08-04, 2026-08-05, projects, kasten, api-design, kasten.md, index
  it("starts the cursor on the first row", () => {
    renderTree();

    expect(cursor()).toHaveTextContent("daily");
  });

  it("moves the cursor down on j and up on k", () => {
    renderTree();

    press("j");
    expect(cursor()).toHaveTextContent("2026-08-04");

    press("j");
    expect(cursor()).toHaveTextContent("2026-08-05");

    press("k");
    expect(cursor()).toHaveTextContent("2026-08-04");
  });

  it("stops at the top rather than wrapping", () => {
    renderTree();

    press("k");

    expect(cursor()).toHaveTextContent("daily");
  });

  it("stops at the bottom rather than wrapping", () => {
    renderTree();

    press("G");
    press("j");

    expect(cursor()).toHaveTextContent("index");
  });

  it("collapses a folder on h and expands it again on l", () => {
    renderTree();

    press("h");
    expect(screen.queryByText("2026-08-04")).toBeNull();

    press("l");
    expect(screen.getByText("2026-08-04")).toBeInTheDocument();
  });

  it("jumps to the parent on h when the row is not an open folder", () => {
    renderTree();

    press("j");
    press("h");

    expect(cursor()).toHaveTextContent("daily");
  });

  it("steps into an open folder on l and on enter rather than folding it", () => {
    renderTree();

    press("l");
    expect(cursor()).toHaveTextContent("2026-08-04");

    press("G");
    press("k");
    press("k");
    press("k");
    press("k");
    press("Enter");
    expect(cursor()).toHaveTextContent("kasten");
    expect(screen.getByText("api-design")).toBeInTheDocument();
  });

  it("opens the note under the cursor on enter", () => {
    const onOpenFile = vi.fn();
    renderTree({ onOpenFile });

    press("j");
    press("Enter");

    expect(onOpenFile).toHaveBeenCalledWith("daily/2026-08-04.md");
  });

  it("opens the note under the cursor on l", () => {
    const onOpenFile = vi.fn();
    renderTree({ onOpenFile });

    press("j");
    press("l");

    expect(onOpenFile).toHaveBeenCalledWith("daily/2026-08-04.md");
  });

  it("goes to the last row on G and back to the first on gg", () => {
    renderTree();

    press("G");
    expect(cursor()).toHaveTextContent("index");

    press("g");
    press("g");
    expect(cursor()).toHaveTextContent("daily");
  });

  it("ignores a g that is not followed by another one", () => {
    renderTree();

    press("g");
    press("j");

    expect(cursor()).toHaveTextContent("daily");
  });

  it("holds the cursor still when a leader sequence ends in g", () => {
    // `gg` is the whole sequence, not whatever key arrives last. A leader
    // sequence that dies on a `g` reaches the same branch, and reading the key
    // alone would send the cursor to the top of the tree.
    renderTree();

    press("j");
    press(" ");
    press("c");
    press("g");

    expect(cursor()).toHaveTextContent("2026-08-04");
  });

  it("drops a g followed by a leader letter rather than waiting on it", () => {
    // Only a leader sequence waits for more letters. `gc` prefixes `<leader>cf`
    // by its letters alone, and a pending buffer that took it would grow
    // forever and swallow every key after it.
    renderTree();

    press("g");
    press("c");
    press("j");

    expect(cursor()).toHaveTextContent("2026-08-04");
  });

  it("closes the panel on q", () => {
    const onOpenChange = vi.fn();
    renderTree({ onOpenChange });

    press("q");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes the panel on the leader key too", () => {
    const onOpenChange = vi.fn();
    renderTree({ onOpenChange });

    press(" ");
    press("b");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("goes to a tab on the leader and a digit", () => {
    // The digits live in `TAB_KEYS` rather than in `LEADER`, and reading one
    // table and not the other is how they used to reach a tab from a note and
    // nothing at all from in here.
    const onGoToTab = vi.fn();
    renderTree({ onGoToTab });

    press(" ");
    press("3");

    expect(onGoToTab).toHaveBeenCalledWith(2);
  });

  it("opens the note prompt on the leader, c, then f", () => {
    const onCreateNote = vi.fn();
    renderTree({ onCreateNote });

    expect(cursor()).toHaveTextContent("daily");
    press(" ");
    press("c");
    press("f");

    expect(onCreateNote).toHaveBeenCalledWith("daily/");
  });

  it("renames the note under the cursor on the leader, r, then f", () => {
    const onRenameNote = vi.fn();
    renderTree({ onRenameNote });

    press("G");
    press("k");
    // By title, not by name: the folder `projects/kasten/` reads the same.
    expect(cursor()).toHaveAttribute("title", "projects/kasten.md");
    press(" ");
    press("r");
    press("f");

    expect(onRenameNote).toHaveBeenCalledWith("projects/kasten.md");
  });

  it("renames nothing when the cursor is on a folder", () => {
    // `rf` names a file, and the tree has `r` for a row of either kind. Doing
    // nothing is how it says the key does not apply here.
    const onRenameNote = vi.fn();
    const onRenameFolder = vi.fn();
    renderTree({ onRenameNote, onRenameFolder });

    expect(cursor()).toHaveTextContent("daily");
    press(" ");
    press("r");
    press("f");

    expect(onRenameNote).not.toHaveBeenCalled();
    expect(onRenameFolder).not.toHaveBeenCalled();
  });

  it("opens the note prompt on c", () => {
    const onCreateNote = vi.fn();
    renderTree({ onCreateNote });

    expect(cursor()).toHaveTextContent("daily");
    press("c");

    expect(onCreateNote).toHaveBeenCalledWith("daily/");
  });

  it("opens the note prompt on c in the folder holding the note under the cursor", () => {
    const onCreateNote = vi.fn();
    renderTree({ onCreateNote });

    press("G");
    expect(cursor()).toHaveTextContent("index");
    press("c");

    // A note at the root names no folder, so the prompt opens on the vault root.
    expect(onCreateNote).toHaveBeenCalledWith("");
  });

  it("renames the note under the cursor on r", () => {
    const onRenameNote = vi.fn();
    renderTree({ onRenameNote });

    press("G");
    press("k");
    // By title, not by name: the folder `projects/kasten/` reads the same.
    expect(cursor()).toHaveAttribute("title", "projects/kasten.md");
    press("r");

    expect(onRenameNote).toHaveBeenCalledWith("projects/kasten.md");
  });

  it("deletes the note under the cursor on d", () => {
    const onDeleteNote = vi.fn();
    renderTree({ onDeleteNote });

    press("G");
    press("k");
    expect(cursor()).toHaveAttribute("title", "projects/kasten.md");
    press("d");

    expect(onDeleteNote).toHaveBeenCalledWith("projects/kasten.md");
  });

  it("deletes the folder under the cursor on d", () => {
    const onDeleteFolder = vi.fn();
    const onDeleteNote = vi.fn();
    renderTree({ onDeleteFolder, onDeleteNote });

    expect(cursor()).toHaveTextContent("daily");
    press("d");

    expect(onDeleteFolder).toHaveBeenCalledWith("daily");
    expect(onDeleteNote).not.toHaveBeenCalled();
  });

  it("keeps the focus in the tree when the deleted row goes", () => {
    // Without this the keyboard is dead after `d`: the row that had the focus
    // is unmounted when the listing comes back without it, and the browser
    // hands the focus to the body rather than to the row that took its place.
    const { rerender } = render(<Harness paths={["index.md", "other.md"]} />);
    cursor().focus();
    expect(cursor()).toHaveFocus();

    press("d");
    rerender(<Harness paths={["other.md"]} />);

    expect(document.body).not.toHaveFocus();
    expect(cursor()).toHaveFocus();
  });

  it("renames the folder under the cursor on r", () => {
    const onRenameFolder = vi.fn();
    const onRenameNote = vi.fn();
    renderTree({ onRenameFolder, onRenameNote });

    expect(cursor()).toHaveTextContent("daily");
    press("r");

    // No trailing slash: this is the folder's path, not a prefix to type after.
    expect(onRenameFolder).toHaveBeenCalledWith("daily");
    expect(onRenameNote).not.toHaveBeenCalled();
  });

  it("renames a folder nested inside another on r", () => {
    const onRenameFolder = vi.fn();
    renderTree({ onRenameFolder });

    press("G");
    press("k");
    press("k");
    press("k");
    expect(cursor()).toHaveTextContent("kasten");
    press("r");

    expect(onRenameFolder).toHaveBeenCalledWith("projects/kasten");
  });

  it("finds a note on f, whatever the cursor is on", () => {
    // The finder ranks the whole vault, so unlike `c` and `r` it takes nothing
    // from the row the cursor happens to be on.
    const onFindNote = vi.fn();
    renderTree({ onFindNote });

    expect(cursor()).toHaveTextContent("daily");
    press("f");

    expect(onFindNote).toHaveBeenCalledTimes(1);

    press("G");
    press("f");

    expect(onFindNote).toHaveBeenCalledTimes(2);
  });

  it("searches note content on s, whatever the cursor is on", () => {
    // `s` rather than the `g` that `<leader>fg` ends on, because `g` is the
    // first half of `gg` here. Takes nothing from the row, the way `f` does not.
    const onSearchNotes = vi.fn();
    renderTree({ onSearchNotes });

    press("s");

    expect(onSearchNotes).toHaveBeenCalledTimes(1);
  });

  it("still goes to the first row on gg, which the search key must not have eaten", () => {
    renderTree();

    press("G");
    expect(cursor()).not.toHaveTextContent("daily");

    press("g");
    press("g");

    expect(cursor()).toHaveTextContent("daily");
  });

  it("waits for the second letter rather than acting on the leader and c", () => {
    const onCreateNote = vi.fn();
    const onOpenChange = vi.fn();
    renderTree({ onCreateNote, onOpenChange });

    press(" ");
    press("c");

    expect(onCreateNote).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("drops a sequence that reaches no binding, keeping the keys after it", () => {
    const onCreateNote = vi.fn();
    renderTree({ onCreateNote });

    press(" ");
    press("c");
    press("x");
    press("j");

    expect(onCreateNote).not.toHaveBeenCalled();
    expect(cursor()).toHaveTextContent("2026-08-04");
  });

  it("reads a leader key that needs shift", () => {
    // The browser sends a keydown for the shift key itself before it sends the
    // letter, and a pending sequence that took it for a key would be dropped
    // before the letter it was waiting for arrived. Every shifted leader key
    // reachable from here rides on this: `<leader>E`, and `<leader>H` to `L`.
    const onRevealTree = vi.fn();
    renderTree({ onRevealTree });

    press(" ");
    press("Shift");
    press("E");

    expect(onRevealTree).toHaveBeenCalledTimes(1);
  });

  it("hands focus back to the editor on escape", () => {
    renderTree();
    const editor = document.createElement("div");
    editor.className = "cm-content";
    editor.tabIndex = 0;
    document.body.append(editor);

    tree().focus();
    press("Escape");

    expect(document.activeElement).toBe(editor);
  });

  it("takes the focus when the route asks for it", () => {
    // The other half of escape: `<leader>e` is pressed in the editor, so the
    // route raises the signal and the panel puts the focus on its cursor row.
    const { rerender } = render(<Harness focusSignal={0} />);
    expect(cursor()).not.toHaveFocus();

    rerender(<Harness focusSignal={1} />);

    expect(cursor()).toHaveFocus();
  });

  it("leaves the focus alone until the signal changes", () => {
    // Mounting is not a request. A panel that focused on the value rather than
    // the change would grab the cursor back every time the tree was folded
    // away and brought out again.
    const { rerender } = render(<Harness focusSignal={2} />);
    expect(cursor()).not.toHaveFocus();

    rerender(<Harness focusSignal={2} />);

    expect(cursor()).not.toHaveFocus();
  });
});
