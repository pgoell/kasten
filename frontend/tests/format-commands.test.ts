import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { BOLD, formatDocument, HIGHLIGHT, ITALIC, STRIKE, toggleMark } from "@/lib/format-commands";
import { Highlight } from "@/lib/markdown-highlight";

/** A view with the same markdown parser the editor uses, and nothing else. */
function open(doc: string, anchor: number, head = anchor) {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [markdown({ base: markdownLanguage, extensions: [Highlight] })],
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

  it("leaves the cursor inside the marks it just added", () => {
    const view = open("word", 0);

    toggleMark(view, BOLD);

    // Between the word and the closing `**`, not past it. Landing outside
    // would put the cursor where the next press cannot see the mark, so the
    // key would stop being a toggle.
    expect(view.state.selection.main.head).toBe(6);
  });

  it("returns the text to what it was when pressed twice", () => {
    const view = open("hello world", 7);

    toggleMark(view, BOLD);
    toggleMark(view, BOLD);

    expect(view.state.doc.toString()).toBe("hello world");
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

  it("wraps a highlight in two equals signs", () => {
    const view = open("word", 0);

    toggleMark(view, HIGHLIGHT);

    expect(view.state.doc.toString()).toBe("==word==");
  });

  it("strips a highlight that is already there", () => {
    const view = open("==word==", 3);

    toggleMark(view, HIGHLIGHT);

    expect(view.state.doc.toString()).toBe("word");
  });

  it("reports whether it changed anything", () => {
    const view = open("word", 0);

    expect(toggleMark(view, BOLD)).toBe(true);
  });
});

describe("formatDocument", () => {
  it("cuts the trailing whitespace off a line", () => {
    const view = open("hello   \nworld\t\n", 0);

    expect(formatDocument(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("hello\nworld\n");
  });

  it("collapses a run of blank lines to one", () => {
    const view = open("a\n\n\n\nb\n", 0);

    formatDocument(view);

    expect(view.state.doc.toString()).toBe("a\n\nb\n");
  });

  it("keeps the cursor on the line it was on", () => {
    const view = open("a\n\n\n\nb\n", 5);

    formatDocument(view);

    expect(view.state.selection.main.head).toBe(3);
  });

  it("puts a blank line in front of a heading that has none", () => {
    const view = open("text\n## Heading\n", 0);

    formatDocument(view);

    expect(view.state.doc.toString()).toBe("text\n\n## Heading\n");
  });

  it("leaves a heading on the first line where it is", () => {
    const view = open("# Title\n\ntext\n", 0);

    expect(formatDocument(view)).toBe(false);
  });

  it("writes every bullet as a dash", () => {
    const view = open("* one\n+ two\n  * three\n", 0);

    formatDocument(view);

    expect(view.state.doc.toString()).toBe("- one\n- two\n  - three\n");
  });

  it("leaves what a fence holds alone", () => {
    const view = open("```\n*  not a list   \n\n\n\nstill code\n```\n", 0);

    expect(formatDocument(view)).toBe(false);
  });

  it("leaves the frontmatter alone", () => {
    const view = open("---\nid: 1\n\n\nmodified: 2026-08-10  \n---\n\n# Title\n", 0);

    expect(formatDocument(view)).toBe(false);
  });
});
