import { fireEvent } from "@testing-library/react";
import { open, stubCommands } from "./keybindings-fixture";

describe("the leader key", () => {
  // tmux spells its splits `%` and `"`, and both are shifted keys. Vim builds
  // its key name off `KeyboardEvent.key`, so these arrive as the characters
  // themselves. `"` is the one worth doubting: bare, it begins a register
  // selection and swallows the key after it. As the tail of a `<Space>`
  // sequence the dispatcher has a full match to prefer, and these two prove it.
  it("splits left and right on space then percent", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "%", shiftKey: true });

    expect(commands.splitRight).toHaveBeenCalledTimes(1);
  });

  it("splits top and bottom on space then double quote", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: '"', shiftKey: true });

    expect(commands.splitDown).toHaveBeenCalledTimes(1);
  });

  it("leaves the register key alone without the leader in front of it", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: '"', shiftKey: true });

    expect(commands.splitDown).not.toHaveBeenCalled();
  });

  // Bare, all four are vim's own motions. The leader in front is what makes
  // them a sequence, the way it does for `o`, `p` and `q` beside them.
  it("moves between panes on space then h, j, k or l", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    for (const key of ["h", "j", "k", "l"]) {
      fireEvent.keyDown(editor, { key: " " });
      fireEvent.keyDown(editor, { key });
    }

    expect(commands.paneLeft).toHaveBeenCalledTimes(1);
    expect(commands.paneDown).toHaveBeenCalledTimes(1);
    expect(commands.paneUp).toHaveBeenCalledTimes(1);
    expect(commands.paneRight).toHaveBeenCalledTimes(1);
  });

  it("leaves h and l as motions without the leader in front of them", () => {
    const commands = stubCommands();
    const { editor, doc } = open("word");

    // `l` steps right and `x` cuts what it landed on.
    fireEvent.keyDown(editor, { key: "l" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(commands.paneRight).not.toHaveBeenCalled();
    expect(doc()).toBe("wrd");
  });

  it("waits for the second letter rather than acting on space then t", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    // `th` and `tl` share a first letter with nothing, but `h` and `l` are
    // commands of their own now, so the sequence must not resolve early.
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "t" });

    for (const command of Object.values(commands)) {
      expect(command).not.toHaveBeenCalled();
    }
  });

  it("moves to the next pane on space then o", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "o" });

    expect(commands.nextPane).toHaveBeenCalledTimes(1);
  });

  it("creates a tab on space then c then t", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "c" });
    fireEvent.keyDown(editor, { key: "t" });

    expect(commands.createTab).toHaveBeenCalledTimes(1);
    // The other half of the `c` group, which shares its first letter.
    expect(commands.createNote).not.toHaveBeenCalled();
  });

  it("opens a terminal on space then c then s", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "c" });
    fireEvent.keyDown(editor, { key: "s" });

    expect(commands.openTerminal).toHaveBeenCalledTimes(1);
    // The third member of the `c` group, and neither of the other two fires.
    expect(commands.createTab).not.toHaveBeenCalled();
    expect(commands.createNote).not.toHaveBeenCalled();
  });

  it("walks the tabs on space then t then l or h", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "t" });
    fireEvent.keyDown(editor, { key: "l" });
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "t" });
    fireEvent.keyDown(editor, { key: "h" });

    expect(commands.nextTab).toHaveBeenCalledTimes(1);
    expect(commands.prevTab).toHaveBeenCalledTimes(1);
  });

  // Shifted, so vim sees the uppercase letter rather than shift and a letter,
  // the same trap `<C-S-H>` carries in the formatting keys below.
  it("swaps the pane leftward on space then shift h", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: "H", shiftKey: true });

    // Nothing yet: the leader was not pressed, and bare `H` is vim's own move
    // to the top of the screen.
    expect(commands.movePaneLeft).not.toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "H", shiftKey: true });

    expect(commands.movePaneLeft).toHaveBeenCalledTimes(1);
  });

  it("swaps the pane down, up and right on the other three", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    for (const key of ["J", "K", "L"]) {
      fireEvent.keyDown(editor, { key: " " });
      fireEvent.keyDown(editor, { key, shiftKey: true });
    }

    expect(commands.movePaneDown).toHaveBeenCalledTimes(1);
    expect(commands.movePaneUp).toHaveBeenCalledTimes(1);
    expect(commands.movePaneRight).toHaveBeenCalledTimes(1);
  });

  it("zooms the pane on space then z", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "z" });

    expect(commands.zoomPane).toHaveBeenCalledTimes(1);
  });

  // The digits are the sequence most likely to be eaten on the way through:
  // bare, a digit in normal mode is a count, and vim collects one before it
  // looks for a command. These pass only if the leader in front is enough to
  // make the pair a sequence instead.
  it("jumps to a tab on space then a digit", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "3" });

    // Counting from one on the keyboard, from zero in the array.
    expect(commands.goToTab).toHaveBeenCalledWith(2);
  });

  it("reads space then zero as the tenth tab, the way tmux does", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "0" });

    expect(commands.goToTab).toHaveBeenCalledWith(9);
  });

  it("leaves the count alone without the leader in front of it", () => {
    const commands = stubCommands();
    const { editor, doc } = open("aaaa");

    // `3x` cuts three characters. Were the digit stolen for a tab, one would go.
    fireEvent.keyDown(editor, { key: "3" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(commands.goToTab).not.toHaveBeenCalled();
    expect(doc()).toBe("a");
  });

  it("waits for the second letter rather than acting on space then f", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "f" });

    for (const command of Object.values(commands)) {
      expect(command).not.toHaveBeenCalled();
    }
  });

  it("waits for the second letter rather than acting on space then r", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "r" });

    for (const command of Object.values(commands)) {
      expect(command).not.toHaveBeenCalled();
    }
  });

  it("opens the dump prompt on space then c then d", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "c" });
    fireEvent.keyDown(editor, { key: "d" });

    expect(commands.captureDump).toHaveBeenCalledTimes(1);
    expect(commands.deleteNote).not.toHaveBeenCalled();
  });

  it("waits for the second letter rather than acting on space then c", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "c" });

    for (const command of Object.values(commands)) {
      expect(command).not.toHaveBeenCalled();
    }
  });
});
