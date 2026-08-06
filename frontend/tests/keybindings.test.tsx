import { fireEvent, render, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { Editor } from "@/components/editor";
import type { EditorCommands } from "@/lib/key-bindings";

function stubCommands() {
  return {
    toggleTree: vi.fn(),
    togglePreview: vi.fn(),
    closeNote: vi.fn(),
    showHelp: vi.fn(),
    createNote: vi.fn(),
    renameNote: vi.fn(),
    findNote: vi.fn(),
    focusTree: vi.fn(),
  } satisfies EditorCommands;
}

function content(container: HTMLElement): string {
  return (container.querySelector(".cm-content") as HTMLElement).textContent ?? "";
}

function open(initialDoc: string, commands: EditorCommands = stubCommands()) {
  const onChange = vi.fn();
  const { container } = render(
    <Editor initialDoc={initialDoc} commands={commands} onChange={onChange} />,
  );

  return {
    container,
    editor: container.querySelector(".cm-content") as HTMLElement,
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

  it("stops space from moving the cursor", () => {
    const { container, editor } = open("plain");

    // Vim ships `<Space>` bound to `l`. Were it still bound, the space would
    // step onto the `l` and `x` would cut it, leaving "pain". Read through a
    // delete because moving a cursor leaves the text alone either way.
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(content(container)).toBe("plain");
  });
});

/** What the route does with `<leader>p`: hold the flag, hand down the toggle. */
function PreviewHarness() {
  const [preview, setPreview] = useState(true);
  const commands = useMemo<EditorCommands>(
    () => ({
      toggleTree: () => {},
      togglePreview: () => setPreview((previous) => !previous),
      closeNote: () => {},
      showHelp: () => {},
      createNote: () => {},
      renameNote: () => {},
      findNote: () => {},
      focusTree: () => {},
    }),
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
