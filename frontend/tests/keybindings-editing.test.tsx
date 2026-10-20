import { fireEvent, render, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { Editor } from "@/components/editor";
import type { EditorCommands } from "@/lib/key-bindings";
import { content, open, stubCommands } from "./keybindings-fixture";

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
