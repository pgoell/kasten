import { acceptCompletion, completionStatus, startCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { type EmbedSource, embedSource } from "@/lib/embed";
import { vimModeField } from "@/lib/vim-mode";
import { toggleVim } from "@/lib/vim-setting";

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

/** A passage a note took out of a book, and the block that carries it. */
const PASSAGE = "Systems that tolerate faults are called fault-tolerant.";
const HIGHLIGHT = `> ${PASSAGE}\n\nStorage and Retrieval ^hl-a3f9c1`;

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

  it("follows the wikilink under the cursor on Enter", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc="see [[borges]] now" onFollow={onFollow} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "w" });
    fireEvent.keyDown(content, { key: "Enter", keyCode: 13 });

    expect(onFollow).toHaveBeenCalledWith("borges");
  });

  it("moves the way vim moves on Enter outside a wikilink", () => {
    // Vim reads `<CR>` as `j^`, and a mapping takes the key whether or not it
    // followed anything, so the line under the cursor is what says the motion
    // survived the mapping.
    const onFollow = vi.fn();
    const { container } = render(
      <Editor initialDoc={"plain words\n  second line"} onFollow={onFollow} />,
    );
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "Enter", keyCode: 13 });

    expect(onFollow).not.toHaveBeenCalled();
    expect(deleteCurrentLine(container)).toBe("plain words");
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

  it("opens a markdown link's address in a new tab on ctrl+click", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(
      <Editor initialDoc="see [mail](https://mail.google.com/mail/u/0/#all/1a) now" />,
    );

    fireEvent.mouseDown(container.querySelector(".cm-link") as HTMLElement, { ctrlKey: true });

    expect(open).toHaveBeenCalledWith(
      "https://mail.google.com/mail/u/0/#all/1a",
      "_blank",
      "noopener",
    );
    open.mockRestore();
  });

  it("opens nothing on ctrl+click on a markdown link with a relative address", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(<Editor initialDoc="see [notes](notes.md) now" />);

    fireEvent.mouseDown(container.querySelector(".cm-link") as HTMLElement, { ctrlKey: true });

    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
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

  it("opens the highlight block under the cursor on gf", () => {
    const onOpenHighlight = vi.fn();
    const { container } = render(
      <Editor initialDoc={HIGHLIGHT} onOpenHighlight={onOpenHighlight} />,
    );
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onOpenHighlight).toHaveBeenCalledWith([PASSAGE]);
  });

  it.each([
    ["the blank line", ["j"]],
    ["the chapter words", ["j", "j"]],
    ["the anchor", ["j", "j", "$"]],
  ])("opens the block from a cursor on %s", (_place, keys) => {
    // pin: all four places answer the same, because the rule reads the block's
    // own range rather than the line it was handed. A one paragraph block has
    // three lines, the chapter words and the anchor sharing the last.
    const onOpenHighlight = vi.fn();
    const { container } = render(
      <Editor initialDoc={HIGHLIGHT} onOpenHighlight={onOpenHighlight} />,
    );
    const content = container.querySelector(".cm-content") as HTMLElement;

    for (const key of keys) fireEvent.keyDown(content, { key });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onOpenHighlight).toHaveBeenCalledWith([PASSAGE]);
  });

  it("opens nothing on gf in a block whose anchor is gone", () => {
    // pin: the anchor line is what tells a highlight from a quotation.
    const onOpenHighlight = vi.fn();
    const { container } = render(
      <Editor
        initialDoc={`> ${PASSAGE}\n\nStorage and Retrieval`}
        onOpenHighlight={onOpenHighlight}
      />,
    );
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onOpenHighlight).not.toHaveBeenCalled();
  });

  it("follows a wikilink written into a quote line rather than the block", () => {
    // pin: the readers are tried in this order, and a link under the cursor is
    // a link even inside a quote.
    const onFollow = vi.fn();
    const onOpenHighlight = vi.fn();
    const { container } = render(
      <Editor
        initialDoc={"> see [[borges]] now\n\nStorage and Retrieval ^hl-a3f9c1"}
        onFollow={onFollow}
        onOpenHighlight={onOpenHighlight}
      />,
    );
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "w" });
    fireEvent.keyDown(content, { key: "w" });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onFollow).toHaveBeenCalledWith("borges");
    expect(onOpenHighlight).not.toHaveBeenCalled();
  });

  it("stays put on gf over a block in an editor handed no callback", () => {
    // pin: `follow` answers true either way, which swallows the key rather
    // than throwing. The only editor with no callback is the empty pane.
    const { container } = render(<Editor initialDoc={HIGHLIGHT} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(deleteCurrentLine(container)).toBe("Storage and Retrieval ^hl-a3f9c1");
  });

  it("opens the block on Enter, the way it opens a link", () => {
    const onOpenHighlight = vi.fn();
    const { container } = render(
      <Editor initialDoc={HIGHLIGHT} onOpenHighlight={onOpenHighlight} />,
    );
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "Enter", keyCode: 13 });

    expect(onOpenHighlight).toHaveBeenCalledWith([PASSAGE]);
  });

  it("moves the way vim moves on Enter in a plain blockquote", () => {
    // pin: the case the anchor line exists for. Enter reaches the same reader
    // `gf` does, so a rule firing on any blockquote would turn Enter on every
    // quoted paragraph in the vault into "open a book".
    const onOpenHighlight = vi.fn();
    const { container } = render(
      <Editor initialDoc={"> a quotation\n  second line"} onOpenHighlight={onOpenHighlight} />,
    );
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "Enter", keyCode: 13 });

    expect(onOpenHighlight).not.toHaveBeenCalled();
    // The `>` is decorated away by the live preview, so what is left on screen
    // is the quotation's own words.
    expect(deleteCurrentLine(container)).toBe("a quotation");
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

  it("asks the autosave about vault text equal to the screen", () => {
    // Equal text is still an answer: the vault has come to hold what the
    // buffer holds, which settles a conflict or a held entry over it.
    const allowReload = vi.fn(() => true);
    const { container, rerender } = render(<Editor initialDoc={DOC} allowReload={allowReload} />);

    rerender(<Editor initialDoc={DOC} allowReload={allowReload} reloadDoc={DOC} />);

    expect(allowReload).toHaveBeenCalledWith(DOC);
    expect(container.querySelector(".cm-content")?.textContent).toBe("onetwothreefour");
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

describe("Editor following a link with an alias or a heading", () => {
  // The whole target, heading and alias and all: the route is what splits it,
  // and a heading cut off here could never be jumped to.
  const DOC = "see [[borges#Life|Jorge]] now";
  const TARGET = "borges#Life|Jorge";

  afterEach(() => localStorage.clear());

  it("hands the whole target on gf", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} onFollow={onFollow} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "w" });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onFollow).toHaveBeenCalledWith(TARGET);
  });

  it("hands the whole target on ctrl+click on the alias, vim on or off", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} onFollow={onFollow} />);
    const alias = () => container.querySelector(".cm-wikilink") as HTMLElement;

    expect(alias().textContent).toBe("Jorge");
    fireEvent.mouseDown(alias(), { ctrlKey: true });
    act(() => toggleVim());
    fireEvent.mouseDown(alias(), { ctrlKey: true });

    expect(onFollow.mock.calls).toEqual([[TARGET], [TARGET]]);
  });

  it("jumps to a heading of its own note itself, on gf and on ctrl+click", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <Editor initialDoc={"[[#Below]]\ntext\n## Below\nend"} onFollow={onFollow} />,
    );
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });
    expect(onFollow).not.toHaveBeenCalled();
    // The brackets are hidden, so the link reads as its target.
    expect(deleteCurrentLine(container)).toBe("#Belowtextend");

    fireEvent.keyDown(content, { key: "u" });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.mouseDown(container.querySelector(".cm-wikilink") as HTMLElement, { ctrlKey: true });
    expect(onFollow).not.toHaveBeenCalled();
    expect(deleteCurrentLine(container)).toBe("#Belowtextend");
  });

  it("hands the whole target on a tap on the alias", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc={`intro\n\n${DOC}`} onFollow={onFollow} />);
    const alias = container.querySelector(".cm-wikilink") as HTMLElement;

    expect(alias.textContent).toBe("Jorge");
    fireEvent.pointerDown(alias, { pointerType: "touch" });
    fireEvent.click(alias);

    expect(onFollow).toHaveBeenCalledWith(TARGET);
  });
});

describe("Editor following a link inside bold or another mark (#432)", () => {
  const ISSUE_LINE =
    '- [ ] Decide the scorer rules. **Read [[Scorer Rules]] first: one real example per rule, with a small "Power BI vs AI/BI" table.** **Output:** one answer per line, or "ok" to take every suggestion #internal ⏳ 2026-10-19 ➕ 2026-10-17 ⏲ 20m 🆔 kt-2726c0';
  const CASES = [
    ["bold in the issue's todo line (A1, A6)", ISSUE_LINE, "Scorer Rules", "Scorer Rules"],
    ["bold in a plain line (A1, A6)", "see **[[borges]]** now", "borges", "borges"],
    ["italic (A5)", "see *[[borges]]* now", "borges", "borges"],
    ["strikethrough (A5)", "see ~~[[borges]]~~ now", "borges", "borges"],
    ["highlight (A5)", "see ==[[borges]]== now", "borges", "borges"],
    ["bold, by its alias (I6)", "see **[[borges|Jorge]]** now", "Jorge", "borges|Jorge"],
  ];

  /**
   * The element holding the text, which is what a browser hands a click as its
   * target. Inside a mark that is a span nested in the link's own span, so a
   * test on `.cm-wikilink` would click somewhere no finger can.
   */
  function textIn(container: HTMLElement, text: string): HTMLElement {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.textContent?.includes(text)) return node.parentElement as HTMLElement;
    }
    throw new Error(`no text ${text}`);
  }

  afterEach(() => localStorage.clear());

  it.each(CASES)(
    "follows a link in %s on ctrl+click and cmd+click, vim on and off (A2, A3)",
    (_, doc, text, target) => {
      const onFollow = vi.fn();
      const { container } = render(<Editor initialDoc={`intro\n\n${doc}`} onFollow={onFollow} />);

      fireEvent.mouseDown(textIn(container, text), { ctrlKey: true });
      fireEvent.mouseDown(textIn(container, text), { metaKey: true });
      act(() => toggleVim());
      fireEvent.mouseDown(textIn(container, text), { ctrlKey: true });

      expect(onFollow.mock.calls).toEqual([[target], [target], [target]]);
    },
  );

  it.each(CASES)("follows a link in %s on a tap, vim on and off (A4)", (_, doc, text, target) => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc={`intro\n\n${doc}`} onFollow={onFollow} />);
    const tap = () => {
      fireEvent.pointerDown(textIn(container, text), { pointerType: "touch" });
      fireEvent.click(textIn(container, text));
    };

    tap();
    act(() => toggleVim());
    tap();

    expect(onFollow.mock.calls).toEqual([[target], [target]]);
  });

  it("opens a markdown link's address in bold on ctrl+click (I3)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(<Editor initialDoc="see **[mail](https://example.com/a)** now" />);

    fireEvent.mouseDown(textIn(container, "mail"), { ctrlKey: true });

    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener");
    open.mockRestore();
  });

  it("leaves a plain click on a link in bold to the cursor (I4)", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <Editor initialDoc="see **[[borges]]** now" onFollow={onFollow} />,
    );

    fireEvent.mouseDown(textIn(container, "borges"));

    expect(onFollow).not.toHaveBeenCalled();
  });

  it("leaves a tap on a link in bold the cursor sits in to the cursor (I5)", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <Editor initialDoc={"intro\n\nsee **[[borges]]** now"} onFollow={onFollow} />,
    );
    const content = container.querySelector(".cm-content") as HTMLElement;
    const tap = () => {
      fireEvent.pointerDown(textIn(container, "borges"), { pointerType: "touch" });
      fireEvent.click(textIn(container, "borges"));
    };

    // The first tap, from outside the link, shows the second one is turned
    // away by the cursor and not by the mark.
    tap();
    for (const key of ["G", "0", "f", "b"]) fireEvent.keyDown(content, { key });
    tap();

    expect(onFollow.mock.calls).toEqual([["borges"]]);
  });
});

describe("Editor wikilink completion", () => {
  it("completes the name before an alias and keeps the alias, in vim mode", async () => {
    // Preview off: it hides `[[bor|` until the cursor is in the link, and
    // would walk a caret set straight into it out the far side.
    const { container } = render(
      <Editor initialDoc="[[bor|Jo]]" paths={["reading/borges.md", "index.md"]} preview={false} />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    ) as EditorView;
    expect(getCM(view)).not.toBeNull();

    // Normal mode's block cursor is a selection, and a list only opens on a
    // bare caret, so `i` first: insert mode is where the name gets typed.
    act(() => view.focus());
    fireEvent.keyDown(view.contentDOM, { key: "i" });
    act(() => {
      view.dispatch({ selection: { anchor: "[[bor".length } });
      startCompletion(view);
    });
    // The list opens asynchronously, and accepting is refused for a moment
    // after it opens so a stray keystroke cannot pick from it.
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    await vi.waitFor(() => expect(acceptCompletion(view)).toBe(true));

    expect(view.state.doc.toString()).toBe("[[reading/borges|Jo]]");
  });

  it("completes the name before an alias with live preview on, in vim mode", async () => {
    const { container } = render(
      <Editor initialDoc="[[bor|Jo]]" paths={["reading/borges.md", "index.md"]} />,
    );
    const view = EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    ) as EditorView;
    expect(getCM(view)).not.toBeNull();

    // The way a person gets there: into insert mode, onto the link so live
    // preview shows its source, and only then into the name. The mode reaches
    // live preview a microtask after the key, so it is waited for.
    act(() => view.focus());
    fireEvent.keyDown(view.contentDOM, { key: "i" });
    await vi.waitFor(() => expect(view.state.field(vimModeField)).toBe("insert"));
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
    act(() => view.dispatch({ selection: { anchor: "[[bor".length } }));
    expect(view.state.selection.main.head).toBe("[[bor".length);

    act(() => {
      startCompletion(view);
    });
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    await vi.waitFor(() => expect(acceptCompletion(view)).toBe(true));

    expect(view.state.doc.toString()).toBe("[[reading/borges|Jo]]");
  });
});

describe("Editor embeds", () => {
  function source(container: HTMLElement) {
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);
    return view?.state.facet(embedSource);
  }

  function embeds(): EmbedSource {
    return { watch: vi.fn(() => () => {}), open: vi.fn() };
  }

  afterEach(() => localStorage.clear());

  it("tells nothing about the vault to a view handed no source", () => {
    const { container } = render(<Editor initialDoc="hello" />);

    expect(source(container)).toBeNull();
  });

  it("carries the source it was handed, the latest one, through a vim toggle", () => {
    const first = embeds();
    const second = embeds();
    const { container, rerender } = render(<Editor initialDoc="hello" embeds={first} />);
    rerender(<Editor initialDoc="hello" embeds={second} />);
    act(() => toggleVim());

    const listener = vi.fn();
    source(container)?.watch("a.md", listener);
    source(container)?.open("a.md", 3);

    expect(second.watch).toHaveBeenCalledWith("a.md", listener);
    expect(second.open).toHaveBeenCalledWith("a.md", 3);
    expect(first.watch).not.toHaveBeenCalled();
  });
});
