import { EditorSelection, RangeSet, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { NotePreview } from "@/components/note/note-preview";
import { HIDDEN, nudgeOutOfHidden } from "@/lib/notes/live/live-preview-hidden";
import { parseCards } from "@/lib/review/srs";
import { content, liveHooks, mount, plain, renderEditor } from "./live-preview-fixture";

liveHooks();

describe("live preview", () => {
  it("hides heading marks in normal mode", () => {
    const { container } = renderEditor(<Editor initialDoc={"## Notes\n\nplain"} />);

    expect(content(container)).toContain("Notes");
    expect(content(container)).not.toContain("##");
  });

  it("reveals the cursor's line on entering insert mode", async () => {
    const { container } = renderEditor(<Editor initialDoc={"## Notes\n\nplain"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toContain("## Notes"));
  });

  it("re-hides the marks on escape back to normal", async () => {
    const { container } = renderEditor(<Editor initialDoc={"## Notes\n\nplain"} />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    // Waited for on the way in as well, so the re-hide is a round trip rather
    // than a reveal that never happened.
    fireEvent.keyDown(editor, { key: "i" });
    await waitFor(() => expect(content(container)).toContain("##"));

    fireEvent.keyDown(editor, { key: "Escape" });

    await waitFor(() => expect(content(container)).not.toContain("##"));
  });

  it("steps the cursor out of the marks that escape hides again", async () => {
    // Escape moves the cursor back one, into the `## ` it is about to hide.
    const { container } = renderEditor(<Editor initialDoc="## Notes" />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(editor, { key: "i" });
    await waitFor(() => expect(content(container)).toContain("##"));
    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(content(container)).not.toContain("##"));
    fireEvent.keyDown(editor, { key: "x" });

    expect(content(container)).toBe("otes");
  });

  it("renders inline emphasis with the marks hidden", () => {
    const { container } = renderEditor(
      <Editor initialDoc="**bold** and *italic* and `code` and ~~gone~~" />,
    );

    expect(content(container)).toBe("bold and italic and code and gone");
  });

  it("renders a highlight with its equals signs hidden", () => {
    const { container } = renderEditor(<Editor initialDoc="a ==marked== word" />);

    expect(content(container)).toBe("a marked word");
  });

  it("reveals the inline marks of the construct the cursor is in", async () => {
    const { container } = renderEditor(<Editor initialDoc="**bold**" />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("**bold**"));
  });

  it("reveals inline marks in visual mode", async () => {
    const { container } = renderEditor(<Editor initialDoc="**bold**" />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "v" });

    await waitFor(() => expect(content(container)).toBe("**bold**"));
  });

  it("leaves the constructs the cursor is not in rendered", async () => {
    const { container } = renderEditor(<Editor initialDoc="**bold** and *italic*" />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("**bold** and italic"));
  });

  it("returns to normal mode when escape leaves visual mode", async () => {
    // vim signals this mode change from inside its own dispatch, so answering
    // it synchronously re-enters the update, CodeMirror kills the plugin that
    // did it, and the editor is left with no vim at all.
    const { container } = renderEditor(<Editor initialDoc={"## Notes\nbeta"} />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(editor, { key: "v" });
    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => expect(content(container)).not.toContain("##"));

    // Still vim: `dd` is a command, not two characters of text.
    fireEvent.keyDown(editor, { key: "d" });
    fireEvent.keyDown(editor, { key: "d" });

    expect(content(container)).toBe("beta");
  });

  it("shows an imported cloze answer's entity colons as colons", () => {
    const [card] = parseCards("#flashcards/x\n\nx {{c1::a&#58;&#58;b}} y\n");
    const { container } = render(<NotePreview text={card?.back ?? ""} />);

    expect(content(container)).toContain("x a::b y");
    expect(content(container)).not.toContain("&#58;");
  });

  it("settles rather than bouncing between two touching hidden ranges", () => {
    // The heading mark ends at 3 and the bold mark starts there, so a cursor
    // pushed out of the first lands straight inside the second.
    const { container } = renderEditor(<Editor initialDoc="## **bold**" />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(editor, { key: "0" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(content(container)).toBe("old");
  });

  it("deletes a visible character, never a hidden mark", () => {
    const { container } = renderEditor(<Editor initialDoc="## Notes" />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    // `0` goes to the real column zero, which sits inside the hidden `##`.
    // Without the nudge, `x` deletes a hash nobody can see.
    fireEvent.keyDown(editor, { key: "0" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(content(container)).toBe("otes");
  });

  it("yanks the marks it hides along with the text", () => {
    // `yy` selects the line to read it, and walking that selection's start
    // out of the hidden `## ` yanked the heading without its hashes.
    const { container } = renderEditor(<Editor initialDoc={"## Notes\nbeta"} />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(editor, { key: "y" });
    fireEvent.keyDown(editor, { key: "y" });
    fireEvent.keyDown(editor, { key: "j" });
    fireEvent.keyDown(editor, { key: "p" });

    expect(
      EditorView.findFromDOM(
        container.querySelector(".cm-editor") as HTMLElement,
      )?.state.doc.toString(),
    ).toBe("## Notes\nbeta\n## Notes");
  });

  it("leaves other lines rendered while one is revealed", async () => {
    const { container } = renderEditor(<Editor initialDoc={"## One\n\n## Two"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toContain("## One"));
    expect(content(container)).not.toContain("## Two");
  });

  it("hides the backslash of an escape, which a card side opening with a fence carries", () => {
    const { container } = renderEditor(<Editor initialDoc={"\\```js\n\nplain"} />);

    expect(content(container)).toBe("```jsplain");
  });

  it("shows the escape's backslash on the cursor's line in insert mode", async () => {
    const { container } = renderEditor(<Editor initialDoc={"\\```js\n\nplain"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("\\```jsplain"));
  });

  it("draws an imported ruby as ruby, its reading over its base", () => {
    const { container } = renderEditor(
      <Editor initialDoc={"漢字::<ruby>漢字<rt>かんじ</rt></ruby>\n"} />,
    );

    expect(container.querySelector("ruby.cm-ruby rt")?.textContent).toBe("かんじ");
    expect(content(container)).not.toContain("<rt>");
  });

  it("draws ruby in a preview pane, which is how the review shows a card", () => {
    const { container } = render(<NotePreview text={"a <ruby>読<rt>よ</rt></ruby>む"} />);

    expect(container.querySelector("ruby.cm-ruby rt")?.textContent).toBe("よ");
    expect(content(container)).toBe("a 読よむ");
  });

  it("hands a ruby's source back on the cursor's line with vim off", () => {
    const view = mount("<ruby>漢字<rt>かんじ</rt></ruby>\n\nnext", plain(null));

    expect(view.dom.querySelector("ruby.cm-ruby")).toBeNull();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(view.dom.querySelector("ruby.cm-ruby rt")?.textContent).toBe("かんじ");
  });
});

describe("#968 the cursor steps out of hidden marks", () => {
  const doc = Text.of(["ab**cd**"]);

  it("lands before a mark it walks left into mid-line", () => {
    const hidden = RangeSet.of([HIDDEN.range(2, 4)]);
    const moved = nudgeOutOfHidden(
      EditorSelection.single(3),
      EditorSelection.single(4),
      hidden,
      doc,
    );
    expect(moved?.main.head).toBe(1);
  });

  it("goes on forward out of a mark at the line's start into the next", () => {
    const hidden = RangeSet.of([HIDDEN.range(0, 2), HIDDEN.range(2, 4)]);
    const moved = nudgeOutOfHidden(
      EditorSelection.single(1),
      EditorSelection.single(5),
      hidden,
      doc,
    );
    expect(moved?.main.head).toBe(4);
  });
});

describe("#1973 a vim motion reaches the hidden part of a link drawn short", () => {
  const press = (container: HTMLElement, keys: string[]) => {
    const editor = container.querySelector(".cm-content") as HTMLElement;
    for (const key of keys) fireEvent.keyDown(editor, { key });
  };
  const view = (container: HTMLElement) =>
    EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView;
  const LINK = "intro\n\n[[bor|Jo]]";
  const AT = LINK.indexOf("[[");

  for (const motion of [
    ["0", "f", "|"],
    ["$", "F", "|"],
  ]) {
    it(`enters insert mode before the bar after G ${motion.join(" ")} i`, async () => {
      const { container } = renderEditor(<Editor initialDoc={LINK} />);
      press(container, ["G", ...motion, "i"]);
      await waitFor(() => expect(content(container)).toContain("[[bor|Jo]]"));
      expect(view(container).state.selection.main.head).toBe(AT + 5);
    });
  }

  it("shows the link's source while the normal-mode cursor is on its hidden part, so x deletes what shows", async () => {
    const { container } = renderEditor(<Editor initialDoc={LINK} />);
    press(container, ["G", "0"]);
    await waitFor(() => expect(content(container)).toContain("[[bor|Jo]]"));
    press(container, ["f", "|", "x"]);
    expect(view(container).state.doc.toString()).toBe("intro\n\n[[borJo]]");
  });

  it("shows the link's source while the cursor rests on its closing brackets after $", async () => {
    const { container } = renderEditor(<Editor initialDoc={LINK} />);
    press(container, ["G", "$"]);
    await waitFor(() => expect(content(container)).toContain("[[bor|Jo]]"));
    press(container, ["x"]);
    expect(view(container).state.doc.toString()).toBe("intro\n\n[[bor|Jo]");
  });

  it("hides the link again once the cursor leaves its hidden part", async () => {
    const { container } = renderEditor(<Editor initialDoc={LINK} />);
    press(container, ["G", "0", "f", "|"]);
    await waitFor(() => expect(content(container)).toContain("[[bor|Jo]]"));
    press(container, ["l"]);
    await waitFor(() => expect(content(container)).toBe("introJo"));
    press(container, ["x"]);
    expect(view(container).state.doc.toString()).toBe("intro\n\n[[bor|o]]");
    press(container, ["F", "|"]);
    await waitFor(() => expect(content(container)).toContain("[[bor|o]]"));
    press(container, ["k"]);
    await waitFor(() => expect(content(container)).toBe("introo"));
  });

  it("keeps the cursor in the name when escape leaves insert mode there", async () => {
    const { container } = renderEditor(<Editor initialDoc={LINK} />);
    press(container, ["G", "0", "f", "|", "i"]);
    await waitFor(() => expect(view(container).state.selection.main.head).toBe(AT + 5));
    press(container, ["Escape"]);
    await waitFor(() => expect(view(container).state.selection.main.head).toBe(AT + 4));
    await waitFor(() => expect(content(container)).toContain("[[bor|Jo]]"));
  });

  it("reaches the folder of a link drawn as its last part", async () => {
    const { container } = renderEditor(<Editor initialDoc={"intro\n\n[[folder/note]]"} />);
    press(container, ["G", "0", "f", "/", "i"]);
    await waitFor(() => expect(view(container).state.selection.main.head).toBe(AT + 8));
  });

  it("still walks the cursor off a link that hides only its brackets", () => {
    const { container } = renderEditor(<Editor initialDoc={"intro\n\n[[note]]"} />);
    press(container, ["G", "0", "x"]);
    expect(view(container).state.doc.toString()).toBe("intro\n\n[[ote]]");
  });

  it("draws a link at a preview's start rendered", () => {
    const { container } = render(<NotePreview text={"[[bor|Jo]] after"} />);
    expect(content(container)).toBe("Jo after");
  });
});

describe("#2306 a vim motion reaches a markdown link's hidden address", () => {
  const press = (container: HTMLElement, keys: string[]) => {
    const editor = container.querySelector(".cm-content") as HTMLElement;
    for (const key of keys) fireEvent.keyDown(editor, { key });
  };
  const view = (container: HTMLElement) =>
    EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView;
  const LINK = "intro\n\n[text](https://example.com)";
  const AT = LINK.indexOf("[");

  it("enters insert mode before the ( after G $ F ( i, the link showing its source", async () => {
    const { container } = renderEditor(<Editor initialDoc={LINK} />);
    press(container, ["G", "$", "F", "(", "i"]);
    await waitFor(() => expect(content(container)).toContain("[text](https://example.com)"));
    expect(view(container).state.selection.main.head).toBe(AT + 6);
  });

  it("shows the link's source while the cursor rests on its ) after $, so x deletes it", async () => {
    const { container } = renderEditor(<Editor initialDoc={LINK} />);
    press(container, ["G", "$"]);
    await waitFor(() => expect(content(container)).toContain("[text](https://example.com)"));
    press(container, ["x"]);
    expect(view(container).state.doc.toString()).toBe("intro\n\n[text](https://example.com");
  });

  it("draws the link as its text again once the cursor leaves the address", async () => {
    const { container } = renderEditor(<Editor initialDoc={LINK} />);
    press(container, ["G", "$", "F", "("]);
    await waitFor(() => expect(content(container)).toContain("(https://example.com)"));
    press(container, ["F", "x"]);
    await waitFor(() => expect(content(container)).toBe("introtext"));
    press(container, ["$"]);
    await waitFor(() => expect(content(container)).toContain("(https://example.com)"));
    press(container, ["k"]);
    await waitFor(() => expect(content(container)).toBe("introtext"));
  });

  it("still walks the cursor off the opening [, the link staying drawn", () => {
    const { container } = renderEditor(<Editor initialDoc={LINK} />);
    press(container, ["G", "0", "x"]);
    expect(view(container).state.doc.toString()).toBe("intro\n\n[ext](https://example.com)");
    expect(content(container)).toBe("introext");
  });

  it("gives a reference link's hidden ][label] the same rule", async () => {
    const doc = "[ref]: https://example.com\n\n[text][ref]";
    const { container } = renderEditor(<Editor initialDoc={doc} />);
    press(container, ["G", "$", "F", "[", "i"]);
    await waitFor(() => expect(content(container)).toContain("[text][ref]"));
    expect(view(container).state.selection.main.head).toBe(doc.lastIndexOf("["));
  });

  it("walks the cursor off a shortcut reference link's lone ], which hides no address", () => {
    const doc = "[text]: https://example.com\n\n[text] after";
    const { container } = renderEditor(<Editor initialDoc={doc} />);
    press(container, ["G", "0", "e", "l"]);
    expect(view(container).state.selection.main.head).toBe(doc.lastIndexOf("]") + 1);
    expect(content(container)).toContain("text after");
  });

  it("leaves the link as source when escape steps back onto its ) at the line's end", async () => {
    const { container } = renderEditor(<Editor initialDoc={LINK} />);
    press(container, ["G", "A"]);
    await waitFor(() => expect(view(container).state.selection.main.head).toBe(LINK.length));
    press(container, ["Escape"]);
    await waitFor(() => expect(view(container).state.selection.main.head).toBe(LINK.length - 1));
    await waitFor(() => expect(content(container)).toContain("[text](https://example.com)"));
  });

  it("draws a markdown link in a preview as its text", () => {
    const { container } = render(<NotePreview text={"[text](https://example.com) after"} />);
    expect(content(container)).toBe("text after");
  });
});
