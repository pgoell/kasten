import { fireEvent, render, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { Editor } from "@/components/editor";
import { readClock } from "@/lib/clock";
import type { EditorCommands } from "@/lib/key-bindings";
import { periodicNote } from "@/lib/periodic";

/** Read from the same helper the command reads it from, so this cannot expire. */
const TODAY = readClock(new Date()).date;

function stubCommands() {
  return {
    toggleTree: vi.fn(),
    togglePreview: vi.fn(),
    closeNote: vi.fn(),
    showHelp: vi.fn(),
    createNote: vi.fn(),
    renameNote: vi.fn(),
    findNote: vi.fn(),
    searchNotes: vi.fn(),
    findTodos: vi.fn(),
    openTodos: vi.fn(),
    showBacklinks: vi.fn(),
    showLinksOut: vi.fn(),
    openDaily: vi.fn(),
    openWeekly: vi.fn(),
    openMonthly: vi.fn(),
    openQuarterly: vi.fn(),
    openYearly: vi.fn(),
    focusTree: vi.fn(),
    createTab: vi.fn(),
    openTerminal: vi.fn(),
    splitRight: vi.fn(),
    splitDown: vi.fn(),
    nextPane: vi.fn(),
    paneLeft: vi.fn(),
    paneDown: vi.fn(),
    paneUp: vi.fn(),
    paneRight: vi.fn(),
    nextTab: vi.fn(),
    prevTab: vi.fn(),
    goToTab: vi.fn(),
  } satisfies EditorCommands;
}

function content(container: HTMLElement): string {
  return (container.querySelector(".cm-content") as HTMLElement).textContent ?? "";
}

function open(initialDoc: string, commands: EditorCommands = stubCommands(), path?: string) {
  const onChange = vi.fn();
  const onCycleTodo = vi.fn();
  const { container } = render(
    <Editor
      initialDoc={initialDoc}
      commands={commands}
      onChange={onChange}
      onCycleTodo={onCycleTodo}
      path={path}
    />,
  );

  return {
    container,
    editor: container.querySelector(".cm-content") as HTMLElement,
    onCycleTodo,
    /** The document itself, which the rendered text hides the marks of. */
    doc: () => (onChange.mock.lastCall?.[0] as string | undefined) ?? initialDoc,
  };
}

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

  it("waits for the second letter rather than acting on space then c", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "c" });

    for (const command of Object.values(commands)) {
      expect(command).not.toHaveBeenCalled();
    }
  });

  it("makes a todo of the line under the cursor on space then x", () => {
    const { editor, doc } = open("plain");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc()).toBe(`- [ ] plain ➕ ${TODAY}`);
  });

  it("leaves the cursor on the words rather than inside the box it wrote", () => {
    const { editor, doc } = open("plain");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });
    // The box is hidden and drawn as a symbol, so a cursor left where it was
    // would sit on a character nobody can see and this press would cut the
    // dash rather than the first letter.
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc()).toBe(`- [ ] lain ➕ ${TODAY}`);
  });

  it("takes a parent's parts into done with it, in one press", () => {
    const { editor, doc } = open("- [/] wire up the pane\n  - [ ] write it\n  - [ ] ship it");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    const lines = doc().split("\n");
    // The parent's id is whatever `newId` made, so it is matched rather than
    // written out. Neither part gets one: nothing names a part.
    expect(lines[0]).toMatch(new RegExp(`^- \\[x\\] wire up the pane ✅ ${TODAY} 🆔 kt-\\w{6}$`));
    expect(lines[1]).toBe(`  - [x] write it ✅ ${TODAY}`);
    expect(lines[2]).toBe(`  - [x] ship it ✅ ${TODAY}`);
  });

  it("puts every line the cascade moved back on one u", () => {
    const note = "- [/] wire up the pane\n  - [ ] write it\n  - [ ] ship it";
    const { editor, doc } = open(note);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });
    fireEvent.keyDown(editor, { key: "u" });

    expect(doc()).toBe(note);
  });

  it("stamps an id on the todo under the cursor on space then i", () => {
    // The spec's second stamp, the one entering done is not: a `⛔` is written
    // by hand and needs an id to name.
    const { editor, doc } = open("- [ ] wire up the pane");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "i" });

    expect(doc()).toMatch(/^- \[ \] wire up the pane 🆔 kt-\w{6}$/);
  });

  it("leaves the id it wrote on a second press", () => {
    const { editor, doc } = open("- [ ] wire up the pane");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "i" });
    const stamped = doc();
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "i" });

    expect(doc()).toBe(stamped);
  });

  it("moves a dependent in the same note in the press that closes its blocker", () => {
    const note = "- [/] ship it 🆔 kt-000001\n- [b] write the docs ⛔ kt-000001";
    const { editor, doc } = open(note);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc().split("\n")[1]).toBe("- [ ] write the docs ⛔ kt-000001");

    fireEvent.keyDown(editor, { key: "u" });

    // One press, so one undo takes back both lines.
    expect(doc()).toBe(note);
  });

  it("reports the line it cycled, so the done log can follow it", () => {
    // The press edits the buffer and autosave writes it, which is what keeps
    // `u` working. The `## Done` line lands in another note, so the route has
    // to be told, and it is told what the line read before and after.
    const { editor, onCycleTodo } = open("- [/] wire up the pane 🆔 kt-3f9a2c");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(onCycleTodo).toHaveBeenCalledWith({
      before: "- [/] wire up the pane 🆔 kt-3f9a2c",
      after: `- [x] wire up the pane ✅ ${TODAY} 🆔 kt-3f9a2c`,
      line: 1,
    });
  });

  it("logs a todo living in today's own note into that same buffer", () => {
    // The one note the route cannot write, this being the buffer being typed
    // into, so the press carries both halves and `u` takes back both.
    const { editor, doc } = open(
      "- [/] wire up the pane 🆔 kt-3f9a2c",
      stubCommands(),
      periodicNote("daily", new Date()).path,
    );

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc()).toBe(
      `- [x] wire up the pane ✅ ${TODAY} 🆔 kt-3f9a2c\n\n## Done\n- ✅ ${TODAY} wire up the pane kt-3f9a2c\n`,
    );
  });

  it("leaves the log to the route for a todo living in any other note", () => {
    const { editor, doc } = open(
      "- [/] wire up the pane 🆔 kt-3f9a2c",
      stubCommands(),
      "kasten.md",
    );

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc()).toBe(`- [x] wire up the pane ✅ ${TODAY} 🆔 kt-3f9a2c`);
  });

  it("stops space from moving the cursor", () => {
    const { editor, doc } = open("plain");

    // Vim ships `<Space>` bound to `l`. Were it still bound, the space would
    // step onto the `l` and the `x` sequence would never form, leaving "pain".
    // Read through the document rather than the screen: `<Space>x` now hides
    // the box it writes, so the rendered text would look right either way.
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(doc()).toBe(`- [ ] plain ➕ ${TODAY}`);
  });
});

/** What the route does with `<leader>p`: hold the flag, hand down the toggle. */
function PreviewHarness() {
  const [preview, setPreview] = useState(true);
  const commands = useMemo<EditorCommands>(
    // Built off the stub rather than listed again, so a command added to the
    // interface reaches this harness without anybody remembering to bring it.
    () => ({ ...stubCommands(), togglePreview: () => setPreview((previous) => !previous) }),
    [],
  );

  return <Editor initialDoc="## Notes" commands={commands} preview={preview} />;
}

describe("the live preview toggle", () => {
  it("reveals every mark on space then p, and hides them again", async () => {
    const { container } = render(<PreviewHarness />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    expect(content(container)).toBe("Notes");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "p" });
    await waitFor(() => expect(content(container)).toBe("## Notes"));

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "p" });
    await waitFor(() => expect(content(container)).toBe("Notes"));
  });

  it("keeps the undo history across the toggle", async () => {
    const { container } = render(<PreviewHarness />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    // Off first, so the text on screen is the text in the document and `x`
    // lands somewhere the hidden marks cannot move it.
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "p" });
    await waitFor(() => expect(content(container)).toBe("## Notes"));

    fireEvent.keyDown(editor, { key: "x" });
    await waitFor(() => expect(content(container)).toBe("# Notes"));

    // Back on and off again. A rebuilt view would lose the edit above.
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "p" });
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "p" });
    await waitFor(() => expect(content(container)).toBe("# Notes"));

    fireEvent.keyDown(editor, { key: "u" });

    await waitFor(() => expect(content(container)).toBe("## Notes"));
  });
});

describe("the formatting keys", () => {
  it("bolds the word under the cursor in insert mode", () => {
    const { editor, doc } = open("word");

    fireEvent.keyDown(editor, { key: "i" });
    fireEvent.keyDown(editor, { key: "b", ctrlKey: true });

    expect(doc()).toBe("**word**");
  });

  it("italicises in insert mode", () => {
    const { editor, doc } = open("word");

    fireEvent.keyDown(editor, { key: "i" });
    fireEvent.keyDown(editor, { key: "i", ctrlKey: true });

    expect(doc()).toBe("*word*");
  });

  // The letter is uppercase because that is what `KeyboardEvent.key` carries
  // while shift is held, and vim builds its key name straight off `e.key`.
  // Sending a lowercase letter here would test a keystroke nobody can type.
  it("strikes through in insert mode", () => {
    const { editor, doc } = open("word");

    fireEvent.keyDown(editor, { key: "i" });
    fireEvent.keyDown(editor, { key: "X", ctrlKey: true, shiftKey: true });

    expect(doc()).toBe("~~word~~");
  });

  it("highlights in insert mode", () => {
    const { editor, doc } = open("word");

    fireEvent.keyDown(editor, { key: "i" });
    fireEvent.keyDown(editor, { key: "H", ctrlKey: true, shiftKey: true });

    expect(doc()).toBe("==word==");
  });

  it("leaves the document alone in normal mode, where vim owns the key", () => {
    const { editor, doc } = open("word");

    fireEvent.keyDown(editor, { key: "b", ctrlKey: true });

    expect(doc()).toBe("word");
  });

  it("wraps the selection and drops back to normal mode", async () => {
    const { container, editor, doc } = open("word");

    fireEvent.keyDown(editor, { key: "v" });
    fireEvent.keyDown(editor, { key: "$" });
    fireEvent.keyDown(editor, { key: "b", ctrlKey: true });

    expect(doc()).toBe("**word**");
    // Normal mode is what hides the marks again, so the rendered text is the
    // readable proof that visual mode was left behind.
    await waitFor(() => expect(content(container)).toBe("word"));
  });
});

describe("the tab key", () => {
  it("nests the list item under the one above it", () => {
    const { editor, doc } = open("- first\n- second");

    fireEvent.keyDown(editor, { key: "j" });
    fireEvent.keyDown(editor, { key: "i" });
    fireEvent.keyDown(editor, { key: "Tab" });

    expect(doc()).toBe("- first\n  - second");
  });

  it("lifts it back out on shift tab", () => {
    const { editor, doc } = open("- first\n  - second");

    fireEvent.keyDown(editor, { key: "j" });
    fireEvent.keyDown(editor, { key: "i" });
    fireEvent.keyDown(editor, { key: "Tab", shiftKey: true });

    expect(doc()).toBe("- first\n- second");
  });

  it("indents a plain line too, tab being an indent key and not a list key", () => {
    const { editor, doc } = open("plain");

    fireEvent.keyDown(editor, { key: "i" });
    fireEvent.keyDown(editor, { key: "Tab" });

    expect(doc()).toBe("  plain");
  });
});
