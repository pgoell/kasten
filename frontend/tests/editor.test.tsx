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

  it("puts an undone line back where it was when the text already open comes back", () => {
    // An autosave's own text comes back through the query, and replacing the
    // document with itself is still a transaction. Undo maps its stored change
    // through every transaction since, and a whole-document replace maps
    // anything inside it to the far end, so the line would come back at the
    // foot of the note: once for every save.
    const { container, rerender } = render(<Editor initialDoc={DOC} startLine={3} />);
    const content = container.querySelector(".cm-content") as HTMLElement;
    deleteCurrentLine(container);

    rerender(<Editor initialDoc={DOC} startLine={3} reloadDoc={"one\ntwo\nfour"} />);
    fireEvent.keyDown(content, { key: "u" });

    expect(content.textContent).toBe("onetwothreefour");
  });

  it("is no undo step, so `u` cannot revert somebody else's write", () => {
    // Undoing a reload puts the text from before it back, and that revert is
    // not annotated: autosave writes it to the vault. One `u` would overwrite
    // whatever the agent or the ssh session had just written.
    const { container, rerender } = render(<Editor initialDoc={DOC} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    rerender(<Editor initialDoc={DOC} reloadDoc={APPENDED} />);
    fireEvent.keyDown(content, { key: "u" });

    expect(content.textContent).toBe("onetwothreefourfive");
  });

  it("reports nothing and leaves the cursor put when the text already open comes back", () => {
    // Neither of these turns on the guard against equal text: the reload is
    // annotated, so it is never reported, and the cursor is restored by offset
    // either way. What that guard is worth is the undo above.
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

  it("keeps the cursor on its line when the write landed above it", () => {
    // The line is what the cursor is asked for through `dd`. A write above it
    // moves every offset below, so an offset held across the reload lands on
    // the wrong words: only a change over the span that actually differs maps
    // the cursor with the text it sits on.
    const { container, rerender } = render(<Editor initialDoc={DOC} startLine={3} />);

    rerender(<Editor initialDoc={DOC} startLine={3} reloadDoc={`zero\n${DOC}`} />);

    expect(deleteCurrentLine(container)).toBe("zeroonetwofour");
  });

  it("puts an undone line back where it was after a write below it", () => {
    // Undo maps its stored change through every transaction since. A change
    // over the whole document maps anything inside it to the far end, so the
    // line would come back at the foot of the note.
    const { container, rerender } = render(<Editor initialDoc={DOC} startLine={3} />);
    const content = container.querySelector(".cm-content") as HTMLElement;
    deleteCurrentLine(container);

    rerender(<Editor initialDoc={DOC} startLine={3} reloadDoc={"one\ntwo\nfour\nfive"} />);
    fireEvent.keyDown(content, { key: "u" });

    expect(content.textContent).toBe("onetwothreefourfive");
  });

  // The shapes an external write arrives in, and the arithmetic that trims it
  // down to the span that differs. The last two pairs are where an off-by-one
  // lives: the common prefix and the common suffix overlap unless the second
  // is stopped at the end of the first.
  it.each([
    ["appended to", DOC, `${DOC}\nfive`],
    ["written above", DOC, `zero\n${DOC}`],
    ["cut in the middle", DOC, "one\nfour"],
    ["emptied", DOC, ""],
    ["written into an empty note", "", DOC],
    ["extended by more of what it already held", "aaa", "aaaaa"],
    ["shortened by more of what it already held", "aaaaa", "aaa"],
  ])("takes a note %s", (_shape, start, next) => {
    const { container, rerender } = render(<Editor initialDoc={start} />);

    rerender(<Editor initialDoc={start} reloadDoc={next} />);

    // CodeMirror draws a line per element, so the text runs together.
    expect(container.querySelector(".cm-content")?.textContent).toBe(next.split("\n").join(""));
  });

  it("stays put when what holds the unsaved text refuses the reload", () => {
    // The buffer can pick up text between the vault reporting a write and the
    // read of it landing here, so the answer given when the event arrived is
    // out of date by now. This is the last moment anyone can tell.
    const { container, rerender } = render(<Editor initialDoc={DOC} allowReload={() => false} />);

    rerender(<Editor initialDoc={DOC} allowReload={() => false} reloadDoc={APPENDED} />);

    expect(container.querySelector(".cm-content")?.textContent).toBe("onetwothreefour");
  });

  it("does not ask when the vault hands back the text already open", () => {
    // Asked after the trim and not before it, so a reload with nothing in it
    // cannot stand a note in conflict over a change that was never made.
    const allowReload = vi.fn(() => true);
    const { rerender } = render(<Editor initialDoc={DOC} allowReload={allowReload} />);

    rerender(<Editor initialDoc={DOC} allowReload={allowReload} reloadDoc={DOC} />);

    expect(allowReload).not.toHaveBeenCalled();
  });

  it("holds the cursor inside a note that came back shorter", () => {
    // CodeMirror throws on a selection past the end rather than clamping, so
    // an external delete would take the editor down with it.
    const { container, rerender } = render(<Editor initialDoc={DOC} startLine={4} />);

    rerender(<Editor initialDoc={DOC} startLine={4} reloadDoc="one" />);

    expect(deleteCurrentLine(container)).toBe("");
  });
});

describe("coming back to the tab", () => {
  /** Leave the page with nothing focused, then return to it. */
  function leaveAndComeBack() {
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent(window, new Event("focus"));
  }

  it("takes the cursor back when this pane is the focused one", () => {
    // The window lands on the body when the page had nothing focused as you
    // left it, and the cursor is dead until you click. This is what revives it.
    const { container } = render(<Editor initialDoc="one" focused />);

    leaveAndComeBack();

    expect(container.querySelector(".cm-content")).toHaveFocus();
  });

  it("leaves the focus alone when another pane holds it", () => {
    // Every pane mounts one of these, and without the guard all of them race
    // for the focus on the way back in. The pane that wins is arbitrary, and a
    // terminal pane loses every time, because it has no editor to race with:
    // the shell silently stops receiving keys and only a click brings it back.
    const { container } = render(<Editor initialDoc="one" focused={false} />);

    leaveAndComeBack();

    expect(container.querySelector(".cm-content")).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });
});

describe("Editor gutter", () => {
  const DOC = "one\ntwo\nthree\nfour";

  /**
   * What the gutter shows, top to bottom.
   *
   * The first element is the spacer holding the column open, hidden rather
   * than a line of the note, so it is dropped.
   */
  function gutter(container: HTMLElement) {
    return [...container.querySelectorAll<HTMLElement>(".cm-lineNumbers .cm-gutterElement")]
      .filter((n) => n.style.visibility !== "hidden")
      .map((n) => n.textContent ?? "");
  }

  it("counts the distance from the cursor, and names the line it sits on", () => {
    const { container } = render(<Editor initialDoc={DOC} startLine={2} />);

    expect(gutter(container)).toEqual(["1", "2", "1", "2"]);
  });

  it("counts from the top when the cursor sits on the first line", () => {
    const { container } = render(<Editor initialDoc={DOC} />);

    expect(gutter(container)).toEqual(["1", "1", "2", "3"]);
  });

  it("recounts when the cursor moves", () => {
    const { container, rerender } = render(<Editor initialDoc={DOC} startLine={2} />);

    rerender(<Editor initialDoc={DOC} startLine={4} />);

    expect(gutter(container)).toEqual(["3", "2", "1", "4"]);
  });
});
