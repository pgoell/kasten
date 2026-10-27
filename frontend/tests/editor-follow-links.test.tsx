import { EditorView } from "@codemirror/view";
import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { toggleVim } from "@/lib/editor/vim-setting";
import { deleteCurrentLine, HIGHLIGHT, PASSAGE } from "./editor-fixture";
import { finishParsing, renderStarved } from "./parsing";

describe("Editor", () => {
  // Vim is kept in local storage, and a test that turns it off must not leave it so.
  afterEach(() => localStorage.clear());

  it("follows the wikilink under the cursor on gf", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc="see [[borges]] now" onFollow={onFollow} />);
    finishParsing(container);
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
    finishParsing(container);
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
    finishParsing(container);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "$" });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onFollow).toHaveBeenCalledWith("borges");
  });

  it("follows a link the line ends on when the first parse runs out of time (#618)", () => {
    const onFollow = vi.fn();
    const { container } = renderStarved(<Editor initialDoc="see [[borges]]" onFollow={onFollow} />);
    finishParsing(container);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "$" });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onFollow).toHaveBeenCalledWith("borges");
  });

  it("follows a link past the first parse on gf and on Enter, before the idle parse (#628)", () => {
    // The first parse stops 3000 characters in, and a synchronous test never
    // reaches the idle callback that parses the rest, so this is a note the
    // background parse has not reached the end of yet.
    const onFollow = vi.fn();
    const filler = "A paragraph that the parser has to walk through.\n\n".repeat(200);
    const { container } = render(
      <Editor initialDoc={`${filler}see [[borges]] now`} onFollow={onFollow} />,
    );
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "G" });
    fireEvent.keyDown(content, { key: "w" });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });
    // The handler opens nothing here, so the cursor is still in the link.
    fireEvent.keyDown(content, { key: "Enter", keyCode: 13 });

    expect(onFollow.mock.calls).toEqual([["borges"], ["borges"]]);
  });

  it("follows the wikilink under the cursor on Enter", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc="see [[borges]] now" onFollow={onFollow} />);
    finishParsing(container);
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
    finishParsing(container);

    fireEvent.mouseDown(container.querySelector(".cm-wikilink") as HTMLElement, { ctrlKey: true });

    expect(onFollow).toHaveBeenCalledWith("borges");
  });

  it("leaves a plain click on a wikilink to the cursor", () => {
    // Clicking a link to put the cursor in it is how it gets edited, so the
    // modifier is what tells the two apart.
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc="see [[borges]] now" onFollow={onFollow} />);
    finishParsing(container);

    fireEvent.mouseDown(container.querySelector(".cm-wikilink") as HTMLElement);

    expect(onFollow).not.toHaveBeenCalled();
  });

  it("opens a markdown link's address in a new tab on ctrl+click", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(
      <Editor initialDoc="see [mail](https://mail.google.com/mail/u/0/#all/1a) now" />,
    );
    finishParsing(container);

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
    finishParsing(container);

    fireEvent.mouseDown(container.querySelector(".cm-link") as HTMLElement, { ctrlKey: true });

    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("opens the page a markdown link names on gf, at the heading it names (A3)", () => {
    // The address the take writes for a path a wikilink cannot hold.
    const onFollow = vi.fn();
    const { container } = render(
      <Editor
        path="00 Daily/d.md"
        initialDoc="[Heading](../x/a%5D%5Db.html#s1) now"
        onFollow={onFollow}
      />,
    );
    finishParsing(container);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onFollow).toHaveBeenCalledWith("x/a]]b.html", { path: "x/a]]b.html", heading: "s1" });
  });

  it("opens the page a markdown link names on Enter, vim on (A3)", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <Editor
        path="00 Daily/d.md"
        initialDoc="[Heading](../x/a%5D%5Db.html#s1) now"
        onFollow={onFollow}
      />,
    );
    finishParsing(container);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "Enter", keyCode: 13 });

    expect(onFollow).toHaveBeenCalledWith("x/a]]b.html", { path: "x/a]]b.html", heading: "s1" });
  });

  it("opens the page a markdown link names on ctrl+click, vim off (A3)", () => {
    const onFollow = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(
      <Editor
        path="00 Daily/d.md"
        initialDoc="see [Heading](../x/a%5D%5Db.html#s1) now"
        onFollow={onFollow}
      />,
    );
    finishParsing(container);
    act(() => toggleVim());

    fireEvent.mouseDown(container.querySelector(".cm-link") as HTMLElement, { ctrlKey: true });

    expect(onFollow).toHaveBeenCalledWith("x/a]]b.html", { path: "x/a]]b.html", heading: "s1" });
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("opens the page a markdown link names on a tap, in kasten and not a new tab (A3)", () => {
    const onFollow = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(
      <Editor
        path="00 Daily/d.md"
        initialDoc="see [Heading](../x/a%5D%5Db.html#s1) now"
        onFollow={onFollow}
      />,
    );
    finishParsing(container);
    const link = container.querySelector(".cm-link") as HTMLElement;

    fireEvent.pointerDown(link, { pointerType: "touch" });
    fireEvent.click(link);

    expect(onFollow).toHaveBeenCalledWith("x/a]]b.html", { path: "x/a]]b.html", heading: "s1" });
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("opens the file a highlight's chapter line links to on gf, not the highlight (I7)", () => {
    const onFollow = vi.fn();
    const onOpenHighlight = vi.fn();
    const { container } = render(
      <Editor
        path="00 Daily/d.md"
        initialDoc={`> ${PASSAGE}\n\n[Storage](../x/a%5D%5Db.html#s1) ^hl-abc123`}
        onFollow={onFollow}
        onOpenHighlight={onOpenHighlight}
      />,
    );
    finishParsing(container);
    const content = container.querySelector(".cm-content") as HTMLElement;

    // The cursor goes to the chapter line's start directly, as the motions
    // that would find it are what this test is not about.
    const view = EditorView.findFromDOM(content) as EditorView;
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from } });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onFollow).toHaveBeenCalledWith("x/a]]b.html", { path: "x/a]]b.html", heading: "s1" });
    expect(onOpenHighlight).not.toHaveBeenCalled();
  });

  it("a link that climbs above the vault opens nothing", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <Editor path="d.md" initialDoc="[Heading](../x/a%5D%5Db.html#s1) now" onFollow={onFollow} />,
    );
    finishParsing(container);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onFollow).not.toHaveBeenCalled();
  });

  it("does not follow a markdown link to a web address on gf (I6)", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <Editor initialDoc="[mail](https://example.com/a) now" onFollow={onFollow} />,
    );
    finishParsing(container);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onFollow).not.toHaveBeenCalled();
  });

  it("opens a web address in a new tab on a tap, not in kasten (I6)", () => {
    const onFollow = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(
      <Editor initialDoc="see [mail](https://example.com/a) now" onFollow={onFollow} />,
    );
    finishParsing(container);
    const link = container.querySelector(".cm-link") as HTMLElement;

    fireEvent.pointerDown(link, { pointerType: "touch" });
    fireEvent.click(link);

    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener");
    expect(onFollow).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("does not follow a schemeless link that names no file, on gf, ctrl+click or a tap (I6)", () => {
    const onFollow = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(<Editor initialDoc="[x](notes/plan) now" onFollow={onFollow} />);
    finishParsing(container);
    const content = container.querySelector(".cm-content") as HTMLElement;
    const link = container.querySelector(".cm-link") as HTMLElement;

    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });
    fireEvent.mouseDown(link, { ctrlKey: true });
    fireEvent.pointerDown(link, { pointerType: "touch" });
    fireEvent.click(link);

    expect(onFollow).not.toHaveBeenCalled();
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
});
