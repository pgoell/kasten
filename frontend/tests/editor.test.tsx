import { fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";

/**
 * Run an ex command, the way a user types one.
 *
 * `:` opens a panel with its own input and moves focus there, so the rest of
 * the command never reaches `.cm-content`.
 */
function runExCommand(container: HTMLElement, command: string) {
  fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: ":" });

  const input = container.querySelector(".cm-vim-panel input") as HTMLInputElement;
  input.value = command;
  fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
}

describe("Editor", () => {
  it("starts in vim normal mode, so keys act as commands", () => {
    const { container } = render(<Editor initialDoc={"line one\nline two"} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    // `dd` in normal mode deletes the line the cursor sits on.
    fireEvent.keyDown(content, { key: "d" });
    fireEvent.keyDown(content, { key: "d" });

    expect(content.textContent).toBe("line two");
  });

  it("mounts a CodeMirror view holding the initial document", () => {
    // No markdown syntax: live preview hides the marks, and what this test is
    // about is that the view mounted holding the document it was given.
    const { container } = render(<Editor initialDoc="hello" />);

    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toBe("hello");
  });

  it("saves on ctrl+s, and keeps the browser's own save dialog shut", () => {
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc="# hello" onSave={onSave} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    const handled = fireEvent.keyDown(content, { key: "s", ctrlKey: true });

    expect(onSave).toHaveBeenCalledWith("# hello");
    // fireEvent returns false once something called preventDefault.
    expect(handled).toBe(false);
  });

  it("saves on :w, because vim mode is on and that is the reflex", () => {
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc="# hello" onSave={onSave} />);

    runExCommand(container, "w");

    expect(onSave).toHaveBeenCalledWith("# hello");
  });

  it("saves the text as it stands, not the text it opened with", () => {
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={"line one\nline two"} onSave={onSave} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "d" });
    fireEvent.keyDown(content, { key: "d" });
    fireEvent.keyDown(content, { key: "s", ctrlKey: true });

    expect(onSave).toHaveBeenCalledWith("line two");
  });

  it("reports an undo like any other edit, so what you undo is written too", () => {
    const onChange = vi.fn();
    const { container } = render(<Editor initialDoc={"line one\nline two"} onChange={onChange} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "d" });
    fireEvent.keyDown(content, { key: "d" });
    fireEvent.keyDown(content, { key: "u" });

    expect(content.textContent).toBe("line oneline two");
    expect(onChange).toHaveBeenLastCalledWith("line one\nline two");
  });

  it("tears the view down on unmount", () => {
    const { container, unmount } = render(<Editor initialDoc="# hello" />);

    unmount();

    expect(container.querySelector(".cm-editor")).toBeNull();
  });
});

describe("the editor focus", () => {
  /** Somewhere else on the page that can hold the focus, as the tree does. */
  function elsewhere() {
    const button = document.createElement("button");
    document.body.append(button);
    return button;
  }

  it("takes the focus on mount, so the first key lands in the note", () => {
    const { container } = render(<Editor initialDoc="plain" />);

    expect(container.querySelector(".cm-content")).toHaveFocus();
  });

  it("leaves the focus alone when something else already holds it", () => {
    // Opening a note from the tree remounts the editor. Taking the focus on
    // every mount would end browsing with `j` and Enter after one note.
    const tree = elsewhere();
    tree.focus();

    const { container } = render(<Editor initialDoc="plain" />);

    expect(tree).toHaveFocus();
    expect(container.querySelector(".cm-content")).not.toHaveFocus();
    tree.remove();
  });

  it("takes the focus back when the tab returns to nothing focused", () => {
    const { container } = render(<Editor initialDoc="plain" />);
    const content = container.querySelector(".cm-content") as HTMLElement;
    content.blur();

    fireEvent.focus(window);

    expect(content).toHaveFocus();
  });

  it("leaves the focus alone when the tab returns to the tree", () => {
    const { container } = render(<Editor initialDoc="plain" />);
    const tree = elsewhere();
    tree.focus();

    fireEvent.focus(window);

    expect(tree).toHaveFocus();
    expect(container.querySelector(".cm-content")).not.toHaveFocus();
    tree.remove();
  });
});

describe("Editor opened on a line", () => {
  const DOC = "one\ntwo\nthree\nfour";

  // `dd` deletes the line the cursor sits on, which is how the tests above ask
  // where the cursor is without reaching into the view.
  function deleteCurrentLine(container: HTMLElement) {
    const content = container.querySelector(".cm-content") as HTMLElement;
    fireEvent.keyDown(content, { key: "d" });
    fireEvent.keyDown(content, { key: "d" });
    return content.textContent;
  }

  it("puts the cursor on the line it was opened at", () => {
    const { container } = render(<Editor initialDoc={DOC} startLine={3} />);

    expect(deleteCurrentLine(container)).toBe("onetwofour");
  });

  it("starts at the top when it was given no line", () => {
    const { container } = render(<Editor initialDoc={DOC} />);

    expect(deleteCurrentLine(container)).toBe("twothreefour");
  });

  it("moves the cursor when a second hit names another line of the same note", () => {
    // No remount: the note has not changed, only where in it to look. Without
    // this the second hit on an open note would go nowhere.
    const { container, rerender } = render(<Editor initialDoc={DOC} startLine={2} />);

    rerender(<Editor initialDoc={DOC} startLine={4} />);

    expect(deleteCurrentLine(container)).toBe("onetwothree");
  });

  it("holds at the last line when the note is shorter than the hit said", () => {
    // The note can be edited between the scan finding a line and the click
    // opening it, and a line past the end is a crash rather than a miss.
    const { container } = render(<Editor initialDoc={DOC} startLine={99} />);

    expect(deleteCurrentLine(container)).toBe("onetwothree");
  });
});
