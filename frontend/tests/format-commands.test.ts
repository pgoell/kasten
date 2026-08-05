import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { BOLD, ITALIC, STRIKE, toggleMark } from "@/lib/format-commands";

/** A view with the same markdown parser the editor uses, and nothing else. */
function open(doc: string, anchor: number, head = anchor) {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [markdown({ base: markdownLanguage })],
    }),
  });
}

describe("toggleMark", () => {
  it("wraps the word under the cursor when nothing is selected", () => {
    const view = open("hello world", 7);

    toggleMark(view, BOLD);

    expect(view.state.doc.toString()).toBe("hello **world**");
  });

  it("strips the marks when the cursor sits inside them", () => {
    const view = open("hello **world**", 10);

    toggleMark(view, BOLD);

    expect(view.state.doc.toString()).toBe("hello world");
  });

  it("wraps the selection when there is one", () => {
    const view = open("hello world", 0, 5);

    toggleMark(view, BOLD);

    expect(view.state.doc.toString()).toBe("**hello** world");
  });

  it("opens an empty pair and sits between it on a blank line", () => {
    const view = open("", 0);

    toggleMark(view, BOLD);

    expect(view.state.doc.toString()).toBe("****");
    expect(view.state.selection.main.head).toBe(2);
  });

  it("leaves the cursor after the word it just wrapped", () => {
    const view = open("word", 0);

    toggleMark(view, BOLD);

    expect(view.state.selection.main.head).toBe(8);
  });

  it("wraps italics in one asterisk", () => {
    const view = open("word", 0);

    toggleMark(view, ITALIC);

    expect(view.state.doc.toString()).toBe("*word*");
  });

  it("strips italics without touching the bold around them", () => {
    const view = open("**bold *and* more**", 8);

    toggleMark(view, ITALIC);

    expect(view.state.doc.toString()).toBe("**bold and more**");
  });

  it("wraps strikethrough in two tildes", () => {
    const view = open("word", 0);

    toggleMark(view, STRIKE);

    expect(view.state.doc.toString()).toBe("~~word~~");
  });

  it("strips strikethrough that is already there", () => {
    const view = open("~~word~~", 3);

    toggleMark(view, STRIKE);

    expect(view.state.doc.toString()).toBe("word");
  });

  it("reports whether it changed anything", () => {
    const view = open("word", 0);

    expect(toggleMark(view, BOLD)).toBe(true);
  });
});
