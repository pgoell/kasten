import { fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { deleteCurrentLine } from "./editor-fixture";

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
