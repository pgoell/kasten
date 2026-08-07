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

/**
 * Delete the line the cursor sits on, and read back what is left.
 *
 * `dd` is how these tests ask where the cursor is without reaching into the
 * view, which they have no handle on.
 */
function deleteCurrentLine(container: HTMLElement) {
  const content = container.querySelector(".cm-content") as HTMLElement;
  fireEvent.keyDown(content, { key: "d" });
  fireEvent.keyDown(content, { key: "d" });
  return content.textContent;
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

  it("follows the wikilink under the cursor on gf", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc="see [[borges]] now" onFollow={onFollow} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    // `w` twice, so the cursor sits in the link rather than on the word before
    // it. The brackets are hidden, so the first word after `see` is the target.
    fireEvent.keyDown(content, { key: "w" });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onFollow).toHaveBeenCalledWith("borges");
  });

  it("names the note without the spaces written around it", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc="[[ borges ]]" onFollow={onFollow} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onFollow).toHaveBeenCalledWith("borges");
  });

  it("follows a link the line ends on, which is where `$` leaves the cursor", () => {
    // The `]]` is hidden, so the cursor cannot rest between the name and the
    // end of the line: it lands past the link, painted at the end of the name.
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc="see [[borges]]" onFollow={onFollow} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "$" });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onFollow).toHaveBeenCalledWith("borges");
  });

  it("follows a wikilink on ctrl+click, the way a browser opens a link", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc="see [[borges]] now" onFollow={onFollow} />);

    fireEvent.mouseDown(container.querySelector(".cm-wikilink") as HTMLElement, { ctrlKey: true });

    expect(onFollow).toHaveBeenCalledWith("borges");
  });

  it("leaves a plain click on a wikilink to the cursor", () => {
    // Clicking a link to put the cursor in it is how it gets edited, so the
    // modifier is what tells the two apart.
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc="see [[borges]] now" onFollow={onFollow} />);

    fireEvent.mouseDown(container.querySelector(".cm-wikilink") as HTMLElement);

    expect(onFollow).not.toHaveBeenCalled();
  });

  it("stays put on ctrl+click off a wikilink", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc="plain words here" onFollow={onFollow} />);

    fireEvent.mouseDown(container.querySelector(".cm-line") as HTMLElement, { ctrlKey: true });

    expect(onFollow).not.toHaveBeenCalled();
  });

  it("stays put on gf outside a wikilink", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc="plain [[borges]]" onFollow={onFollow} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onFollow).not.toHaveBeenCalled();
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
  it("starts below the frontmatter, which is the vault's text and not the note's", () => {
    // A new note is nothing but its block, so the top of the document is inside
    // the fences and the first thing typed would land in the dates.
    const { container } = render(<Editor initialDoc={"---\nid: 1\n---\nNotes"} />);

    expect(deleteCurrentLine(container)).toBe("---id: 1---");
  });
});

describe("Editor reloaded from the vault", () => {
  const DOC = "one\ntwo\nthree\nfour";
  const APPENDED = `${DOC}\nfive`;

  it("takes text written under it, leaving the cursor where it was", () => {
    // The line is what the cursor is asked for through `dd`, and `startLine`
    // is only how it got there: that effect does not run again on a rerender
    // handing it the same line.
    const { container, rerender } = render(<Editor initialDoc={DOC} startLine={3} />);

    rerender(<Editor initialDoc={DOC} startLine={3} reloadDoc={APPENDED} />);

    expect(container.querySelector(".cm-content")?.textContent).toBe("onetwothreefourfive");
    expect(deleteCurrentLine(container)).toBe("onetwofourfive");
  });

  it("dispatches nothing when the vault hands back the text already open", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <Editor initialDoc={DOC} startLine={3} onChange={onChange} />,
    );

    rerender(<Editor initialDoc={DOC} startLine={3} reloadDoc={DOC} onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
    expect(deleteCurrentLine(container)).toBe("onetwofour");
  });

  it("does not report the reload as an edit, so nobody writes it back", () => {
    // A reload read as typing would be saved, which stamps a new date, which
    // is another change to the vault, which reloads: a note nobody touched
    // rewriting itself once a second.
    const onChange = vi.fn();
    const { rerender } = render(<Editor initialDoc={DOC} onChange={onChange} />);

    rerender(<Editor initialDoc={DOC} reloadDoc={APPENDED} onChange={onChange} />);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("holds the cursor inside a note that came back shorter", () => {
    // CodeMirror throws on a selection past the end rather than clamping, so
    // an external delete would take the editor down with it.
    const { container, rerender } = render(<Editor initialDoc={DOC} startLine={4} />);

    rerender(<Editor initialDoc={DOC} startLine={4} reloadDoc="one" />);

    expect(deleteCurrentLine(container)).toBe("");
  });
});
