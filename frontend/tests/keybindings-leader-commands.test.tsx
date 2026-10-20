import { fireEvent } from "@testing-library/react";
import { content, open, stubCommands } from "./keybindings-fixture";

describe("the leader key", () => {
  it("runs the file tree command on space then b", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "b" });

    expect(commands.toggleTree).toHaveBeenCalledTimes(1);
  });

  it("runs the close command on space then q", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "q" });

    expect(commands.closeNote).toHaveBeenCalledTimes(1);
  });

  it("runs the review command on space then g then s", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "g" });
    fireEvent.keyDown(editor, { key: "s" });

    expect(commands.openReview).toHaveBeenCalledTimes(1);
    // `gr` is the book's and stays the book's. The two are one keystroke apart
    // and this is the assertion that keeps them that way.
    expect(commands.openBook).not.toHaveBeenCalled();
  });

  it("runs the book command on space then g then r", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "g" });
    fireEvent.keyDown(editor, { key: "r" });

    expect(commands.openBook).toHaveBeenCalledTimes(1);
  });

  it("runs the current book command on space then g then c", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "g" });
    fireEvent.keyDown(editor, { key: "c" });

    expect(commands.openReadingBook).toHaveBeenCalledTimes(1);
  });

  it("runs the upload command on space then c then b", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "c" });
    fireEvent.keyDown(editor, { key: "b" });

    expect(commands.uploadBook).toHaveBeenCalledTimes(1);
  });

  it("runs the help command on space then question mark", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "?" });

    expect(commands.showHelp).toHaveBeenCalledTimes(1);
  });

  it("runs the focus tree command on space then e", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "e" });

    expect(commands.focusTree).toHaveBeenCalledTimes(1);
  });

  it("runs the reveal command on space then shifted e", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "E", shiftKey: true });

    expect(commands.revealTree).toHaveBeenCalledTimes(1);
    // One keystroke apart from the focus, and the shift is the whole
    // difference. This is the assertion that keeps them apart.
    expect(commands.focusTree).not.toHaveBeenCalled();
  });

  it("runs the create command on space then c then f", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "c" });
    fireEvent.keyDown(editor, { key: "f" });

    expect(commands.createNote).toHaveBeenCalledTimes(1);
    // The editor names no folder, so the prompt opens on the vault root.
    expect(commands.createNote).toHaveBeenCalledWith(undefined);
  });

  it("runs the rename command on space then r then f", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "r" });
    fireEvent.keyDown(editor, { key: "f" });

    expect(commands.renameNote).toHaveBeenCalledTimes(1);
    // The editor names no note, so the route renames the one that is open.
    expect(commands.renameNote).toHaveBeenCalledWith(undefined);
  });

  it("runs the delete command on space then d then f", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "d" });
    fireEvent.keyDown(editor, { key: "f" });

    expect(commands.deleteNote).toHaveBeenCalledTimes(1);
    // The editor names no note, so the route deletes the one that is open.
    expect(commands.deleteNote).toHaveBeenCalledWith(undefined);
  });

  it("runs the restore command on space then d then u", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "d" });
    fireEvent.keyDown(editor, { key: "u" });

    expect(commands.restoreDeleted).toHaveBeenCalledTimes(1);
  });

  it("leaves vim's own d alone", () => {
    // The leader is the space bar, so `dd` is still vim's delete line.
    const commands = stubCommands();
    const { editor, container } = open("first\nsecond", commands);

    fireEvent.keyDown(editor, { key: "d" });
    fireEvent.keyDown(editor, { key: "d" });

    expect(commands.deleteNote).not.toHaveBeenCalled();
    expect(content(container)).toBe("second");
  });

  it("runs the find command on space then f then f", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "f" });
    fireEvent.keyDown(editor, { key: "f" });

    expect(commands.findNote).toHaveBeenCalledTimes(1);
  });

  it("runs the search command on space then f then g", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "f" });
    fireEvent.keyDown(editor, { key: "g" });

    expect(commands.searchNotes).toHaveBeenCalledTimes(1);
    expect(commands.findNote).not.toHaveBeenCalled();
  });

  it("runs the todo overlay command on space then f then t", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "f" });
    fireEvent.keyDown(editor, { key: "t" });

    expect(commands.findTodos).toHaveBeenCalledTimes(1);
    // The third member of the `f` group, and neither of the other two fires.
    expect(commands.findNote).not.toHaveBeenCalled();
    expect(commands.searchNotes).not.toHaveBeenCalled();
  });

  it("runs the backlinks command on space then g then b", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "g" });
    fireEvent.keyDown(editor, { key: "b" });

    expect(commands.showBacklinks).toHaveBeenCalledTimes(1);
    // `<leader>b` folds the tree, and the `b` here is the second letter of a
    // sequence rather than that key arriving late.
    expect(commands.toggleTree).not.toHaveBeenCalled();
  });

  it("runs the outgoing links command on space then g then o", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "g" });
    fireEvent.keyDown(editor, { key: "o" });

    expect(commands.showLinksOut).toHaveBeenCalledTimes(1);
    expect(commands.showBacklinks).not.toHaveBeenCalled();
  });
});
