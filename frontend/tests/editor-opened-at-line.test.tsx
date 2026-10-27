import { EditorView } from "@codemirror/view";
import { act, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { toggleVim } from "@/lib/editor/vim-setting";
import { deleteCurrentLine } from "./editor-fixture";

describe("Editor opened on a line", () => {
  const DOC = "one\ntwo\nthree\nfour";

  // A test that turns vim off leaves the choice in the store.
  afterEach(() => localStorage.clear());

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

  // The fences are the ones the highlighting and `frontmatter.py` take, so a
  // block they draw is a block the cursor starts below (#661).
  it("editor: A3 starts below a frontmatter whose opening fence has a trailing space", () => {
    const { container } = render(<Editor initialDoc={"--- \nid: x\n---\nbody"} />);

    expect(deleteCurrentLine(container)).toBe("--- id: x---");
  });

  it("editor: I5 starts below a frontmatter whose closing fence has a trailing space and tab", () => {
    const { container } = render(<Editor initialDoc={"---\nid: x\n--- \t\nbody"} />);

    expect(deleteCurrentLine(container)).toBe("---id: x--- \t");
  });

  it("editor: I5 starts below a frontmatter with CRLF line ends", () => {
    // The editor holds the lines without their `\r`, so the offset has to be
    // counted in its text and not in the string handed in.
    const { container } = render(<Editor initialDoc={"---\r\nid: x\r\n---\r\nbody"} />);

    expect(deleteCurrentLine(container)).toBe("---id: x---");
  });

  it("editor: I6 starts at the top when the opening fence has a space in front", () => {
    const { container } = render(<Editor initialDoc={" ---\nid: x\n---\nbody"} />);

    expect(deleteCurrentLine(container)).toBe("id: x---body");
  });

  it("editor: I6 starts at the top when the frontmatter never closes", () => {
    const { container } = render(<Editor initialDoc={"---\nid: x\nbody"} />);

    expect(deleteCurrentLine(container)).toBe("id: xbody");
  });

  it("editor: I7 starts below a frontmatter with a trailing-space fence with vim off", () => {
    act(() => toggleVim());
    const { container } = render(<Editor initialDoc={"--- \nid: x\n---\nbody"} />);
    const view = EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    ) as EditorView;

    expect(view.state.selection.main.head).toBe("--- \nid: x\n---\n".length);
  });
});
