import { fireEvent, render, waitFor } from "@testing-library/react";
import { useMemo, useState } from "react";
import { Editor } from "@/components/editor";
import type { EditorCommands } from "@/lib/key-bindings";

function stubCommands() {
  return { toggleTree: vi.fn(), togglePreview: vi.fn() } satisfies EditorCommands;
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

  it("strikes through in insert mode", () => {
    const { editor, doc } = open("word");

    fireEvent.keyDown(editor, { key: "i" });
    fireEvent.keyDown(editor, { key: "x", ctrlKey: true, shiftKey: true });

    expect(doc()).toBe("~~word~~");
  });

  it("highlights in insert mode", () => {
    const { editor, doc } = open("word");

    fireEvent.keyDown(editor, { key: "i" });
    fireEvent.keyDown(editor, { key: "h", ctrlKey: true, shiftKey: true });

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
