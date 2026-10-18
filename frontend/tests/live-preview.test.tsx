/// <reference types="node" />

import { readFileSync } from "node:fs";
import { forceParsing } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension, StateEffect } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { act, fireEvent, type RenderResult, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { Editor } from "@/components/editor";
import { NotePreview } from "@/components/note-preview";
import { EMBED_DEPTH, type EmbedSource, embedSource } from "@/lib/embed";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { type PdfFile, type PdfRenderer, pdfRenderer } from "@/lib/pdf-view";
import { parseCards } from "@/lib/srs";
import { notePath } from "@/lib/todo-commands";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";

function content(container: HTMLElement): string {
  return (container.querySelector(".cm-content") as HTMLElement).textContent ?? "";
}

/**
 * Parses the whole note before a test reads the first draw.
 *
 * CodeMirror gives the parse at state creation 20ms of wall clock and leaves the
 * rest to an idle callback. On a loaded machine the tree, and so the drawing
 * built from it, can stop partway (#365). A partial first draw is fine in the
 * app; a test that counts bullets at once needs the whole tree.
 */
function parsed(view: EditorView): void {
  act(() => {
    forceParsing(view, view.state.doc.length, 5000);
  });
}

/** `render` for an `Editor`, its note parsed to the end. */
function renderEditor(ui: ReactElement): RenderResult {
  const result = render(ui);
  const dom = result.container.querySelector(".cm-editor") as HTMLElement;
  parsed(EditorView.findFromDOM(dom) as EditorView);
  return result;
}

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

  it("renders a link as its text alone", () => {
    const { container } = renderEditor(
      <Editor initialDoc="see [the docs](https://example.com) now" />,
    );

    expect(content(container)).toBe("see the docs now");
  });

  it("reveals the whole link with the cursor in it in insert mode", async () => {
    const { container } = renderEditor(
      <Editor initialDoc="see [the docs](https://example.com) now" />,
    );
    const editor = container.querySelector(".cm-content") as HTMLElement;

    // `w` off the first word lands on the link's `[`, which is hidden, so the
    // cursor settles on the first character of its text.
    fireEvent.keyDown(editor, { key: "w" });
    fireEvent.keyDown(editor, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("see [the docs](https://example.com) now"));
  });

  // The parser reads every `[text]` with no `(url)` as a link (#434, #435).
  // The line above keeps the cursor off the line under test.
  it.each([
    [
      "A8 a [!note] under a plain quote line",
      "> plain\n> [!note] not a callout",
      "[!note] not a callout",
    ],
    ["A9 a [text] on a quote line", "> see [text] here", "see [text] here"],
    ["I1 a [text] on a plain line", "see [text] here", "see [text] here"],
    ["I1 a [text][ref] full reference", "see [text][ref] here", "see [text][ref] here"],
  ])("keeps the brackets of %s", (_, doc, shown) => {
    const { container } = renderEditor(<Editor initialDoc={`intro\n\n${doc}`} />);

    expect(content(container)).toContain(shown);
    expect(container.querySelector(".cm-link")).toBeNull();
  });

  it("I1 keeps the brackets of a [text] in a table cell", () => {
    const lines = ["before", "", "| a |", "| - |", "| [text] |"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    const table = container.querySelector(".cm-table-grid") as HTMLTableElement;
    expect(table.querySelector("tbody td")?.textContent).toBe("[text]");
    expect(table.querySelector(".cm-link")).toBeNull();
  });

  it("B1 [a]() draws as a link, its marks hidden, in prose and in a cell", () => {
    // CommonMark reads empty parens as a link with an empty address.
    const lines = ["intro", "", "see [a]() here", "", "| x |", "| - |", "| [b]() |"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    expect(content(container)).toContain("see a here");
    expect(container.querySelector(".cm-line .cm-link")?.textContent).toBe("a");
    expect(container.querySelector(".cm-table-grid tbody .cm-link")?.textContent).toBe("b");
  });

  it("I3 draws a [text](url) link as its text in cm-link, as before", () => {
    const { container } = renderEditor(
      <Editor initialDoc={"intro\n\n> see [the docs](https://example.com) now"} />,
    );

    expect(content(container)).toContain("see the docs now");
    expect(container.querySelector(".cm-link")?.textContent).toBe("the docs");
  });

  it("leaves the constructs the cursor is not in rendered", async () => {
    const { container } = renderEditor(<Editor initialDoc="**bold** and *italic*" />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("**bold** and italic"));
  });

  it("renders a wikilink as the note it names", () => {
    const { container } = renderEditor(<Editor initialDoc="see [[reading/borges]] now" />);

    expect(content(container)).toBe("see reading/borges now");
    expect(container.querySelector(".cm-wikilink")?.textContent).toBe("reading/borges");
  });

  it("reveals the brackets with the cursor in the wikilink in insert mode", async () => {
    const { container } = renderEditor(<Editor initialDoc="see [[borges]] now" />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(editor, { key: "w" });
    fireEvent.keyDown(editor, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("see [[borges]] now"));
  });

  it("marks a link to a note the vault does not hold", () => {
    const { container } = renderEditor(
      <Editor initialDoc="[[borges]] and [[ficciones]]" paths={["reading/borges.md"]} />,
    );

    expect(container.querySelectorAll(".cm-wikilink")).toHaveLength(2);
    expect(container.querySelector(".cm-wikilink-dead")?.textContent).toBe("ficciones");
  });

  it("marks nothing dead where the vault is not known, as in a preview pane", () => {
    // No listing is not an empty listing: a view that was told nothing must not
    // call every link in the note broken.
    const { container } = renderEditor(<Editor initialDoc="[[borges]]" />);

    expect(container.querySelector(".cm-wikilink")).not.toBeNull();
    expect(container.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  it("draws a link with an alias as the alias", () => {
    const { container } = renderEditor(
      <Editor
        initialDoc="see [[reading/borges#The Aleph|the story]] now"
        paths={["reading/borges.md"]}
      />,
    );

    expect(content(container)).toBe("see the story now");
    expect(container.querySelector(".cm-wikilink")?.textContent).toBe("the story");
    expect(container.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  it("draws a link to a heading of its own note as alive", () => {
    const { container } = renderEditor(<Editor initialDoc="see [[#The Aleph]]" paths={["a.md"]} />);

    expect(container.querySelector(".cm-wikilink")?.textContent).toBe("#The Aleph");
    expect(container.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  it("marks an alias dead by the note behind it", () => {
    const { container } = renderEditor(
      <Editor initialDoc="[[borges|Jorge]] and [[cortazar|Julio]]" paths={["borges.md"]} />,
    );

    expect(container.querySelector(".cm-wikilink-dead")?.textContent).toBe("Julio");
  });

  it("shows the whole link again with the cursor in it in insert mode", async () => {
    const { container } = renderEditor(<Editor initialDoc="see [[borges|Jorge]] now" />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(editor, { key: "w" });
    fireEvent.keyDown(editor, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("see [[borges|Jorge]] now"));
  });

  it("brings a link back to life when the note it names arrives", () => {
    const { container, rerender } = renderEditor(<Editor initialDoc="[[borges]]" paths={[]} />);
    expect(container.querySelector(".cm-wikilink-dead")).not.toBeNull();

    rerender(<Editor initialDoc="[[borges]]" paths={["borges.md"]} />);

    expect(container.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  // The three below read the class rather than the text: markdown's own
  // shortcut reference link claims a `[bracketed]` run whatever is in it, and
  // hiding those brackets is what this file has always done. What is being
  // asked here is only whether a wikilink opened, and none of the three is one.
  it("makes no wikilink of a bracket pair with no note in it", () => {
    const { container } = renderEditor(<Editor initialDoc="[[]] and [[ ]]" />);

    expect(container.querySelector(".cm-wikilink")).toBeNull();
  });

  it("leaves an unclosed wikilink alone", () => {
    const { container } = renderEditor(<Editor initialDoc="[[borges and more" />);

    expect(content(container)).toBe("[[borges and more");
  });

  it("does not carry a wikilink across a line break", () => {
    const { container } = renderEditor(<Editor initialDoc={"[[borges\nand]] more"} />);

    expect(container.querySelector(".cm-wikilink")).toBeNull();
  });

  it("labels the name in front of a relation", () => {
    const { container } = renderEditor(<Editor initialDoc="depends-on:: [[borges]]" />);

    expect(container.querySelector(".cm-relation")?.textContent).toBe("depends-on::");
  });

  it("draws the relation's target as it draws any other wikilink", () => {
    const { container } = renderEditor(<Editor initialDoc="depends-on:: [[borges]]" />);

    expect(container.querySelector(".cm-wikilink")?.textContent).toBe("borges");
    expect(content(container)).toBe("depends-on:: borges");
  });

  it("labels nothing on a line that is not a relation", () => {
    const { container } = renderEditor(<Editor initialDoc="see [[borges]] and [[ficciones]]" />);

    expect(container.querySelector(".cm-relation")).toBeNull();
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

  it("renders blockquotes and list bullets", () => {
    const { container } = renderEditor(<Editor initialDoc={"> quoted\n\n- first\n- second"} />);

    expect(content(container)).toBe("quotedfirstsecond");
  });

  it("stops drawing the bullet on the line that shows its dash", async () => {
    const { container } = renderEditor(<Editor initialDoc={"- first\n- second"} />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    expect(container.querySelectorAll(".cm-bullet")).toHaveLength(2);

    fireEvent.keyDown(editor, { key: "i" });

    // The revealed line puts the real `- ` back on screen, and the drawn dot
    // beside it would be a second bullet on the same line.
    await waitFor(() => expect(container.querySelectorAll(".cm-bullet")).toHaveLength(1));
    expect(content(container)).toContain("- first");
  });

  it("draws every bullet once the parse that ran out of time is forced to the end", () => {
    // A clock that leaps a second each read spends the first parse's 20ms after
    // one step, the way a starved machine does (#365).
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 1000));
    const { container } = render(<Editor initialDoc={"- first\n- second"} />);
    clock.mockRestore();
    expect(container.querySelectorAll(".cm-bullet").length).toBeLessThan(2);

    parsed(
      EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView,
    );

    expect(container.querySelectorAll(".cm-bullet")).toHaveLength(2);
  });

  it("hides the whitespace that nests a list item", () => {
    const { container } = renderEditor(<Editor initialDoc={"- first\n  - nested"} />);

    expect(content(container)).toBe("firstnested");
  });

  it("indents a nested bullet past its parent", () => {
    // The spaces that nest the item are hidden with the dash, so the indent
    // has to be drawn or the nesting disappears from the render.
    const { container } = renderEditor(<Editor initialDoc={"- first\n  - nested"} />);
    const [parent, nested] = container.querySelectorAll<HTMLElement>(".cm-bullet");

    expect(parent?.style.paddingLeft).toBe("1.6em");
    expect(nested?.style.paddingLeft).toBe("3.2em");
  });

  it("draws each of the five todo states in place of its box", () => {
    // The symbol is a `::before` the way the bullet's dot is, and jsdom
    // computes neither, so the class that carries it is what is read here.
    for (const [box, state] of [
      [" ", "open"],
      ["/", "doing"],
      ["x", "done"],
      ["b", "blocked"],
      ["-", "rejected"],
    ]) {
      const { container, unmount } = renderEditor(<Editor initialDoc={`- [${box}] task`} />);

      expect(content(container)).toBe("task");
      expect(container.querySelector(`.cm-todo-${state}`)).not.toBeNull();
      unmount();
    }
  });

  it("draws a bullet holding a wikilink as a bullet, that being no todo", () => {
    const { container } = renderEditor(<Editor initialDoc="- [[borges]]" />);

    expect(container.querySelector("[class*='cm-todo']")).toBeNull();
    expect(container.querySelector(".cm-bullet")).not.toBeNull();
  });

  it("hands the box back on the line being edited", async () => {
    const { container } = renderEditor(<Editor initialDoc={"- [/] task"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    // The symbol goes with it, or the line carries the drawing and its source.
    await waitFor(() => expect(content(container)).toContain("- [/] "));
    expect(container.querySelector("[class*='cm-todo']")).toBeNull();
  });

  it("leaves a todo's box to the bullet, link brackets and all", async () => {
    // `- [/] task` parses `[/]` as a link. The box is the bullet's to draw, and
    // a revealed line showed the box back without its brackets while the link
    // rendering had them.
    const { container } = renderEditor(<Editor initialDoc={"- [/] task"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("- [/] task"));
  });

  it("keeps the cursor out of the box it hid", () => {
    // The hidden run on a todo is six characters rather than the bullet's two,
    // so the walk that keeps a cursor off them has further to go.
    const { container } = renderEditor(<Editor initialDoc="- [ ] task" />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(editor, { key: "0" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(content(container)).toBe("ask");
  });

  it("counts a parent's parts after its line, reaching the grandchildren", () => {
    const lines = [
      "- [/] parent",
      "  - [x] one",
      "  - [-] two",
      "  - [ ] three",
      "    - [x] four",
      "    - [ ] five",
    ];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    const counts = container.querySelectorAll(".cm-todo-progress");
    expect(counts).toHaveLength(2);
    // The parent's own count, and `three` carrying its two of its own.
    expect(counts[0]?.textContent).toBe("3/5");
    expect(counts[1]?.textContent).toBe("1/2");
  });

  it("counts nothing on a list of todos that nest under nothing", () => {
    const lines = ["- [ ] one", "- [x] two", "- [ ] three"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    expect(container.querySelectorAll(".cm-todo-progress")).toHaveLength(0);
  });

  it("colours a due date that has passed", () => {
    // Two dates nothing can reach, so the assertion holds on any day the suite
    // runs: one before every possible today and one after.
    const { container } = renderEditor(
      <Editor initialDoc={"- [ ] late 📅 1970-01-01\n- [ ] soon 📅 2999-01-01"} />,
    );

    const overdue = container.querySelectorAll(".cm-todo-overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.textContent).toBe("📅 1970-01-01");
  });

  it("colours a passed due date typed with the variation selector", () => {
    // Under a parent, so the tab nests the todo rather than opening a code block.
    const { container } = renderEditor(
      <Editor initialDoc={"- [ ] zork\n\t- [ ] call zork-qux 📅️ 1970-01-01 ^blk9"} />,
    );

    const overdue = container.querySelectorAll(".cm-todo-overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.textContent).toBe("📅️ 1970-01-01");
  });

  /**
   * The red marks on `doc`, the cursor on an `intro` line above it so no todo
   * shows its source. Mounted bare rather than through `Editor`, so vim is on
   * or off for certain and not left to the stored setting.
   */
  function overdueIn(doc: string, vimOn: boolean): string[] {
    const view = mount(
      `intro\n\n${doc}`,
      vimOn ? [vim(), livePreview(), vaultPaths.of([]), imagePaths.of([])] : plain(null),
    );
    return [...view.contentDOM.querySelectorAll(".cm-todo-overdue")].map(
      (m) => m.textContent ?? "",
    );
  }

  const VIM = [
    ["vim on", true],
    ["vim off", false],
  ] as const;

  it.each(
    VIM.flatMap(([mode, vimOn]) => [
      ["📆", mode, vimOn],
      ["🗓", mode, vimOn],
    ]),
  )("reds a passed 📆 or 🗓 due: %s, %s", (glyph, _, vimOn) => {
    expect(overdueIn(`- [ ] zork ${glyph} 1970-01-01`, vimOn)).toEqual([`${glyph} 1970-01-01`]);
  });

  it.each(
    VIM.flatMap(([mode, vimOn]) => [
      ["📆️", mode, vimOn],
      ["🗓️", mode, vimOn],
    ]),
  )("reds a selector-typed passed due: %s, %s", (glyph, _, vimOn) => {
    expect(overdueIn(`- [ ] zork ${glyph} 1970-01-01`, vimOn)).toEqual([`${glyph} 1970-01-01`]);
  });

  it.each(VIM)("leaves a due inside a code span uncoloured, %s", (_, vimOn) => {
    expect(overdueIn("- [ ] zork `📅 1970-01-01`", vimOn)).toEqual([]);
  });

  it("leaves a todo inside a fence uncoloured", () => {
    expect(overdueIn("```\n- [ ] zork 📅 1970-01-01\n```", false)).toEqual([]);
  });

  it("reds the due after a code span holding one, the span's not", () => {
    expect(overdueIn("- [ ] zork `📅 1970-01-01` 📅 1970-01-02", false)).toEqual(["📅 1970-01-02"]);
  });

  it.each([
    ["wikilink", "- [ ] zork [[note 📅 1970-01-01]]"],
    ["markdown link", "- [ ] zork [a 📅 1970-01-01](x)"],
  ])("leaves a due inside a %s uncoloured", (_, doc) => {
    expect(overdueIn(doc, false)).toEqual([]);
  });

  it.each([["📆"], ["🗓"]])("leaves a future %s due uncoloured", (glyph) => {
    expect(overdueIn(`- [ ] zork ${glyph} 2999-01-01`, false)).toEqual([]);
  });

  it("keeps the overdue colour on the line being edited", async () => {
    // Unlike the symbol, the red stands in for nothing: it is colour on text
    // that is on the screen whether the line shows its source or not.
    const { container } = renderEditor(<Editor initialDoc={"- [ ] late 📅 1970-01-01"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toContain("- [ ] "));
    expect(container.querySelectorAll(".cm-todo-overdue")).toHaveLength(1);
  });

  it("hides a fence's backticks and language, code and all", () => {
    const lines = ["```js", "const x = 1;", "```"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    expect(content(container)).toBe("const x = 1;");
  });

  it("hands the backticks back with the cursor in the block", async () => {
    // The whole block rather than the cursor's line, which is how every other
    // construct here works: a hidden fence line is a line the cursor cannot
    // reach, so a rule waiting for it there would never fire.
    const lines = ["```js", "const x = 1;", "```"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toBe(lines.join("")));
  });

  it("keeps the backticks of a fence with no code in it", () => {
    // Hiding both would leave no line on the screen to put the cursor back on,
    // and the block a third backtick writes starts out empty.
    const { container } = renderEditor(<Editor initialDoc={"```\n```"} />);

    expect(content(container)).toBe("``````");
    // Knocked back off the code, the way a revealed fence is.
    expect(container.querySelectorAll(".cm-code-fence")).toHaveLength(2);
  });

  it("keeps the backticks of an unclosed fence", () => {
    const { container } = renderEditor(<Editor initialDoc={"```js\nconst x = 1;"} />);

    expect(content(container)).toContain("```js");
  });

  it("draws a table as a table, alignment and cell marks included", () => {
    // A line above it, the cursor starting at the top of the note and a cursor
    // in a table being what shows its source.
    const lines = ["before", "", "| a | **b** | c |", "| :-- | :-: | --: |", "| 1 |  | 3 |"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    const table = container.querySelector(".cm-table-grid") as HTMLTableElement;
    expect(table).not.toBeNull();
    expect(table.querySelectorAll("th")).toHaveLength(3);
    // The middle body cell is empty and carries no node of its own, so a row
    // read off its cells rather than its walls would lose the column.
    const body = [...table.querySelectorAll("tbody td")].map((cell) => cell.textContent);
    expect(body).toEqual(["1", "", "3"]);
    expect(table.querySelector(".cm-strong")?.textContent).toBe("b");
    expect([...table.querySelectorAll("th")].map((cell) => cell.style.textAlign)).toEqual([
      "left",
      "center",
      "right",
    ]);
    // No pipe anywhere: the source is off the screen, widget and all.
    expect(content(container)).not.toContain("|");
  });

  it("draws a link with an alias in a cell as the alias", () => {
    // A bare bar would end the cell, so a table escapes it, as Obsidian does.
    const lines = ["before", "", "| who |", "| --- |", "| [[borges#Life\\|Jorge]] |"];
    const { container } = renderEditor(
      <Editor initialDoc={lines.join("\n")} paths={["borges.md"]} />,
    );

    const table = container.querySelector(".cm-table-grid") as HTMLTableElement;
    expect(table.querySelector("tbody .cm-wikilink")?.textContent).toBe("Jorge");
    expect(table.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  it("leaves the prose under a table out of it", () => {
    // GFM ends a table at a blank line, so a paragraph written straight under
    // one parses as rows of a single cell. The cursor starts on line one, so
    // the table is drawn only when the prose is not part of it.
    const lines = ["| a | b |", "| - | - |", "| 1 | 2 |", "after the table `code`"];
    const { container } = render(<NotePreview text={lines.join("\n")} />);

    const table = container.querySelector(".cm-table-grid") as HTMLTableElement;
    expect(table).not.toBeNull();
    expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(table.textContent).not.toContain("after the table");
    expect(content(container)).toContain("after the table");
    // The prose is still prose, marks hidden and inline code drawn.
    expect(content(container)).not.toContain("`");
    expect(container.querySelector(".cm-inline-code")?.textContent).toBe("code");
  });

  it("shows a table's source when the cursor is in it, whatever the mode", async () => {
    // The cursor starts at offset zero, which is inside a note that is nothing
    // but a table, so this one is revealed from the first render and in normal
    // mode. `j` and `k` step over the widget, so waiting for insert mode would
    // leave a table nothing could open.
    const lines = ["| a | b |", "| - | - |", "| 1 | 2 |"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    await waitFor(() => expect(content(container)).toContain("| a | b |"));
    expect(container.querySelector(".cm-table-grid")).toBeNull();
    expect(container.querySelectorAll(".cm-table")).toHaveLength(3);
  });

  it("draws a table in a pane with no cursor in it", () => {
    // The preview panes mount the same rendering read-only. Their selection
    // sits at offset zero because nothing has moved it, and a note that opens
    // with a table would otherwise be a pane full of pipes.
    const lines = ["| a | b |", "| - | - |", "| 1 | 2 |"];
    const { container } = render(<NotePreview text={lines.join("\n")} />);

    expect(container.querySelector(".cm-table-grid")).not.toBeNull();
    expect(content(container)).not.toContain("|");
  });

  it("shows an imported cloze answer's entity colons as colons", () => {
    const [card] = parseCards("#flashcards/x\n\nx {{c1::a&#58;&#58;b}} y\n");
    const { container } = render(<NotePreview text={card?.back ?? ""} />);

    expect(content(container)).toContain("x a::b y");
    expect(content(container)).not.toContain("&#58;");
  });

  it("draws a fenced block as one surface, top and bottom marked", () => {
    const lines = ["before", "```js", "const x = 1;", "const y = 2;", "```", "after"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    // Two rows on the screen, each backtick line having fallen into the line
    // of code beside it.
    expect(container.querySelectorAll(".cm-code-block")).toHaveLength(2);
    // The corners are rounded on the outside only, so the run reads as a box.
    expect(container.querySelectorAll(".cm-code-open")).toHaveLength(1);
    expect(container.querySelectorAll(".cm-code-close")).toHaveLength(1);
  });

  it("draws a divider in place of the three dashes", () => {
    const { container } = renderEditor(<Editor initialDoc={"above\n\n---\n\nbelow"} />);

    expect(container.querySelectorAll(".cm-rule")).toHaveLength(1);
    // Drawn rather than typed, so the dashes themselves are off the screen.
    expect(content(container)).toBe("abovebelow");
  });

  it("hands the dashes back on the line being edited", async () => {
    const { container } = renderEditor(<Editor initialDoc={"---\n\nbelow"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    // The drawn line goes with them, or the row carries a rule and its source.
    await waitFor(() => expect(content(container)).toContain("---"));
    expect(container.querySelectorAll(".cm-rule")).toHaveLength(0);
  });

  it("leaves a setext underline alone, that being a heading and not a rule", () => {
    const { container } = renderEditor(<Editor initialDoc={"Title\n---\n\nbody"} />);

    expect(container.querySelectorAll(".cm-rule")).toHaveLength(0);
  });

  it("leaves prose outside the fence alone", () => {
    const { container } = renderEditor(<Editor initialDoc={"prose\n```\ncode\n```"} />);
    const first = container.querySelector(".cm-line");

    expect(first?.textContent).toBe("prose");
    expect(first?.classList.contains("cm-code-block")).toBe(false);
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
  it("colours a tag and leaves its hash on screen", () => {
    const { container } = renderEditor(<Editor initialDoc="read this #reading/borges today" />);

    expect(container.querySelector(".cm-tag")?.textContent).toBe("#reading/borges");
    expect(content(container)).toBe("read this #reading/borges today");
  });

  it("keeps the tag colour while the line shows its source", async () => {
    const { container } = renderEditor(<Editor initialDoc="a #tag here" />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(container.querySelector(".cm-tag")?.textContent).toBe("#tag"));
  });

  it("reads no tag out of a hash that is not one", () => {
    // A heading's mark, a fragment inside a word, a shebang in a fenced block
    // and a bare number: four hashes a looser pattern would have coloured.
    const { container } = renderEditor(
      <Editor initialDoc={"# Notes\n\nissue#12 and #1\n\n```sh\n#!/bin/sh\n```"} />,
    );

    expect(container.querySelector(".cm-tag")).toBeNull();
  });

  it("leaves the fragment of a URL alone", () => {
    const { container } = renderEditor(
      <Editor initialDoc="see https://example.com/#anchor and [docs](https://example.com/#top)" />,
    );

    expect(container.querySelector(".cm-tag")).toBeNull();
  });

  it("leaves a note's frontmatter on screen instead of reading it as markdown", () => {
    // Without a parser for the block, the opening fence is a horizontal rule
    // and the closing one underlines the fields above it into a heading: every
    // note in the vault would open on three lines of dates drawn as a title.
    const { container } = renderEditor(<Editor initialDoc={"---\nid: 1\n---\n# Notes"} />);

    expect(content(container)).toBe("---id: 1---Notes");
  });
  it("draws a note's youtube ![](link) as a player", () => {
    const { container } = renderEditor(
      <Editor initialDoc={"notes\n\n![](https://youtu.be/iDulhoQ2pro)\n"} />,
    );

    const frame = container.querySelector("iframe.cm-video");
    expect(frame?.getAttribute("src")).toContain("/embed/iDulhoQ2pro");
    // The brackets and the address stand in for the frame, so neither is left
    // on the screen beside it.
    expect(content(container)).not.toContain("youtu.be");
  });

  it("opens the player where the note says the video got to", async () => {
    const { container } = renderEditor(
      <Editor
        initialDoc={"---\nwatching: {iDulhoQ2pro: 312}\n---\n\n![](https://youtu.be/iDulhoQ2pro)\n"}
      />,
    );

    // The first parse runs on a time budget, and under a loaded suite it can
    // stop short of the line under the frontmatter; the frame lands when the
    // parse catches up.
    await waitFor(() =>
      expect(container.querySelector("iframe.cm-video")?.getAttribute("src")).toContain(
        "start=312",
      ),
    );
  });

  it("leaves a picture a picture", () => {
    const { container } = renderEditor(<Editor initialDoc={"![shot](99 Misc/shot.png)\n"} />);

    expect(container.querySelector("iframe.cm-video")).toBeNull();
    expect(container.querySelector("img.cm-image")?.getAttribute("alt")).toBe("shot");
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

  it("draws a sound's ![](path) as a player rather than a broken picture", () => {
    const { container } = renderEditor(
      <Editor initialDoc={"word\n\n![](Flashcards/Japanese%20media/kana.MP3)\n"} />,
    );

    const audio = container.querySelector("audio.cm-audio");
    expect(audio?.getAttribute("src")).toBe("/api/assets/Flashcards/Japanese%20media/kana.MP3");
    expect(audio?.hasAttribute("controls")).toBe(true);
    // A deck of a thousand cards would otherwise fetch a thousand sounds.
    expect(audio?.getAttribute("preload")).toBe("none");
    expect(container.querySelector("img.cm-image")).toBeNull();
    expect(content(container)).not.toContain("kana");
  });
});

/**
 * A vault the embed reads out of a map, answering at once.
 *
 * The listeners are kept so a test can change a note under an embed that is
 * already on the screen, which is what a save from another pane does.
 */
function fakeVault(notes: Record<string, string>) {
  const texts = new Map(Object.entries(notes));
  const listeners = new Map<string, Set<(text: string | null) => void>>();
  const watched: string[] = [];
  const opened: [string, number | undefined][] = [];
  const source: EmbedSource = {
    watch(path, listener) {
      watched.push(path);
      const set = listeners.get(path) ?? new Set();
      listeners.set(path, set);
      set.add(listener);
      listener(texts.get(path) ?? null);
      return () => set.delete(listener);
    },
    open(path, line) {
      opened.push([path, line]);
    },
  };
  return {
    source,
    watched,
    opened,
    /** How many embeds are listening to the note right now. */
    listening: (path: string) => listeners.get(path)?.size ?? 0,
    push(path: string, text: string | null) {
      if (text === null) texts.delete(path);
      else texts.set(path, text);
      for (const listener of listeners.get(path) ?? []) listener(text);
    },
  };
}

const mounted: EditorView[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
});

/** An editor in the document, the way the app mounts one, with `extra` on. */
function mount(doc: string, extra: Extension[], anchor = 0): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor }, extensions: [noteLanguage(), extra] }),
    parent,
  });
  mounted.push(view);
  parsed(view);
  return view;
}

/** Vim off, so the cursor's line alone shows the source, on a known vault. */
function plain(source: EmbedSource | null, paths: string[] = ["b.md"]): Extension[] {
  return [
    vimKeys.of(false),
    livePreview(),
    vaultPaths.of(paths),
    imagePaths.of(["99 Misc/my shot.png"]),
    ...(source ? [embedSource.of(source)] : []),
  ];
}

/** The text of the note the embed draws, read off its nested view. */
function embedded(view: EditorView): string {
  return view.dom.querySelector(".cm-embed .cm-content")?.textContent ?? "";
}

/** The first line is prose so the cursor, at offset zero, is off the embed. */
const ABOVE = "intro\n\n";

describe("an embed", () => {
  it("draws the note's body in place, frontmatter left out", () => {
    const vault = fakeVault({ "b.md": "---\nid: b1\n---\nbody of b" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));

    expect(embedded(view)).toBe("body of b");
    expect(view.contentDOM.textContent).not.toContain("![[");
    expect(view.contentDOM.textContent).not.toContain("b1");
  });

  it("draws one section, through its lower headings, up to the next of its level", () => {
    const note = "# B\nintro of b\n## Two\ntwo body\n### Sub\nsub body\n## Three\nthree body";
    const vault = fakeVault({ "b.md": note });
    const view = mount(`${ABOVE}![[b# two ]]`, plain(vault.source));

    expect(embedded(view)).toContain("two body");
    expect(embedded(view)).toContain("sub body");
    expect(embedded(view)).not.toContain("intro of b");
    expect(embedded(view)).not.toContain("three body");
  });

  it("finds its note by the wikilink rule", () => {
    const vault = fakeVault({ "reading/borges.md": "the aleph" });
    const view = mount(`${ABOVE}![[Borges]]`, plain(vault.source, ["reading/borges.md"]));

    expect(vault.watched).toEqual(["reading/borges.md"]);
    expect(embedded(view)).toBe("the aleph");
  });

  it("draws the same embed under an alias", () => {
    const vault = fakeVault({ "b.md": "# B\ntop\n## Two\ntwo body" });

    expect(embedded(mount(`${ABOVE}![[b|see b]]`, plain(vault.source)))).toBe("BtopTwotwo body");
    expect(embedded(mount(`${ABOVE}![[b#Two|see b]]`, plain(vault.source)))).toBe(
      embedded(mount(`${ABOVE}![[b#Two]]`, plain(vault.source))),
    );
  });

  it("draws an image the vault holds as the picture", () => {
    const vault = fakeVault({});
    const view = mount(`${ABOVE}![[my shot.png]]`, plain(vault.source));

    expect(view.dom.querySelector("img.cm-image")?.getAttribute("src")).toBe(
      "/api/assets/99%20Misc/my%20shot.png",
    );
    expect(view.dom.querySelector(".cm-embed")).toBeNull();
    expect(vault.watched).toEqual([]);
  });

  it("loads an image whose name holds ?", () => {
    // `?` and not `#`: `![[plan #2.png]]` embeds the heading `2.png` of `plan `.
    // Ahead of `plain`'s own listing, the facet taking the first it is given.
    const view = mount(`${ABOVE}![[plan?.png]]`, [
      imagePaths.of(["99 Misc/plan?.png"]),
      ...plain(fakeVault({}).source),
    ]);

    expect(view.dom.querySelector("img.cm-image")?.getAttribute("src")).toBe(
      "/api/assets/99%20Misc/plan%3F.png",
    );
  });

  it("says so where the note or the heading is missing", () => {
    const vault = fakeVault({ "b.md": "# B\nbody" });

    const note = mount(`${ABOVE}![[nope]]`, plain(vault.source));
    expect(note.dom.querySelector(".cm-embed-missing")?.textContent).toBe("Not found: nope");

    const heading = mount(`${ABOVE}![[b#nope|alias]]`, plain(vault.source));
    expect(heading.dom.querySelector(".cm-embed-missing")?.textContent).toBe("Not found: b#nope");
  });

  it("goes missing when the source stops answering", () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));

    vault.push("b.md", null);

    expect(view.dom.querySelector(".cm-embed-missing")?.textContent).toBe("Not found: b");
    expect(view.dom.querySelector(".cm-embed .cm-content")).toBeNull();
  });

  it("redraws when its note changes, without remounting", () => {
    const vault = fakeVault({ "b.md": "first" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));
    const box = view.dom.querySelector(".cm-embed");

    view.dispatch({ changes: { from: 0, insert: "more " } });
    vault.push("b.md", "second");

    expect(view.dom.querySelector(".cm-embed")).toBe(box);
    expect(embedded(view)).toBe("second");
    expect(vault.watched).toEqual(["b.md"]);
  });

  it("opens its note on ctrl or cmd and a click, and not on a plain click", () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));
    const box = view.dom.querySelector(".cm-embed") as HTMLElement;

    fireEvent.mouseDown(box);
    fireEvent.click(box);
    expect(vault.opened).toEqual([]);

    fireEvent.mouseDown(box, { ctrlKey: true });
    fireEvent.mouseDown(box, { metaKey: true });
    expect(vault.opened).toEqual([
      ["b.md", undefined],
      ["b.md", undefined],
    ]);
  });

  it("opens a section at its heading's line, counted with the frontmatter", () => {
    const vault = fakeVault({ "b.md": "---\nid: b1\n---\n# B\n\n## Two\nbody" });
    const view = mount(`${ABOVE}![[b#two]]`, plain(vault.source));

    fireEvent.mouseDown(view.dom.querySelector(".cm-embed") as HTMLElement, { ctrlKey: true });

    expect(vault.opened).toEqual([["b.md", 6]]);
  });

  it("opens its note on a tap, and not on a touch the browser took for a scroll", () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));
    const box = view.dom.querySelector(".cm-embed") as HTMLElement;

    fireEvent.pointerDown(box, { pointerType: "touch" });
    fireEvent.pointerCancel(box, { pointerType: "touch" });
    fireEvent.click(box);
    fireEvent.pointerDown(box, { pointerType: "mouse" });
    fireEvent.click(box);
    expect(vault.opened).toEqual([]);

    fireEvent.pointerDown(box, { pointerType: "touch" });
    fireEvent.click(box);
    expect(vault.opened).toEqual([["b.md", undefined]]);
  });

  it("opens only the inner note on ctrl or cmd and a click inside a note embed", () => {
    const vault = fakeVault({ "b.md": "![[c]]", "c.md": "body of c" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source, ["b.md", "c.md"]));
    const inner = view.dom.querySelector(".cm-embed .cm-embed") as HTMLElement;

    fireEvent.mouseDown(inner, { ctrlKey: true });
    fireEvent.mouseDown(inner, { metaKey: true });

    expect(vault.opened).toEqual([
      ["c.md", undefined],
      ["c.md", undefined],
    ]);
  });

  it("opens only the inner note on a tap inside a note embed", () => {
    const vault = fakeVault({ "b.md": "![[c]]", "c.md": "body of c" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source, ["b.md", "c.md"]));
    const inner = view.dom.querySelector(".cm-embed .cm-embed") as HTMLElement;

    fireEvent.pointerDown(inner, { pointerType: "touch" });
    fireEvent.click(inner);

    expect(vault.opened).toEqual([["c.md", undefined]]);
  });

  it("opens only the inner note on ctrl and a click inside a note embed, vim on", () => {
    const vault = fakeVault({ "b.md": "![[c]]", "c.md": "body of c" });
    const view = mount(`${ABOVE}![[b]]`, [
      vim(),
      livePreview(),
      vaultPaths.of(["b.md", "c.md"]),
      imagePaths.of([]),
      embedSource.of(vault.source),
    ]);
    const inner = view.dom.querySelector(".cm-embed .cm-embed") as HTMLElement;

    fireEvent.mouseDown(inner, { ctrlKey: true });

    expect(vault.opened).toEqual([["c.md", undefined]]);
  });

  it("still opens the outer note on ctrl and a click outside the inner one", () => {
    const vault = fakeVault({ "b.md": "above c\n\n![[c]]", "c.md": "body of c" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source, ["b.md", "c.md"]));
    const outer = view.dom.querySelector(".cm-embed") as HTMLElement;

    fireEvent.mouseDown(outer, { ctrlKey: true });

    expect(vault.opened).toEqual([["b.md", undefined]]);
  });

  it("shows its source with the cursor on the line, vim off", () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));
    expect(view.dom.querySelector(".cm-embed")).not.toBeNull();

    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });

    expect(view.dom.querySelector(".cm-embed")).toBeNull();
    expect(view.contentDOM.textContent).toContain("![[b]]");
  });

  it("shows its source in insert mode on the line, vim on", async () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount("![[b]]\nplain", [
      vim(),
      livePreview(),
      vaultPaths.of(["b.md"]),
      imagePaths.of([]),
      embedSource.of(vault.source),
    ]);
    expect(view.dom.querySelector(".cm-embed")).not.toBeNull();

    fireEvent.keyDown(view.contentDOM, { key: "i" });

    await waitFor(() => expect(view.contentDOM.textContent).toContain("![[b]]"));
    expect(view.dom.querySelector(".cm-embed")).toBeNull();
  });

  it("keeps the cursor out of the source it hides", () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount(
      "![[b]]\nplain",
      [
        vim(),
        livePreview(),
        vaultPaths.of(["b.md"]),
        imagePaths.of([]),
        embedSource.of(vault.source),
      ],
      7,
    );

    view.dispatch({ selection: EditorSelection.cursor(2) });

    expect(view.state.selection.main.head).toBe("![[b]]".length);
  });

  it("stops at the depth cap where two notes embed each other", () => {
    const vault = fakeVault({ "a.md": "![[b]]", "b.md": "![[a]]" });
    const view = mount(`${ABOVE}![[a]]`, plain(vault.source, ["a.md", "b.md"]));

    expect(view.dom.querySelectorAll(".cm-embed")).toHaveLength(EMBED_DEPTH);
    expect(view.dom.querySelectorAll(".cm-embed-stub")).toHaveLength(1);
  });

  it("stops at the depth cap where a note embeds itself", () => {
    const vault = fakeVault({ "a.md": "![[a]]" });
    const view = mount(`${ABOVE}![[a]]`, plain(vault.source, ["a.md"]));

    expect(view.dom.querySelectorAll(".cm-embed")).toHaveLength(EMBED_DEPTH);
    expect(view.dom.querySelectorAll(".cm-embed-stub")).toHaveLength(1);
  });

  it("stays its source where nobody said how to read the vault", () => {
    const view = mount(`${ABOVE}![[b]]`, plain(null));

    expect(view.contentDOM.textContent).toContain("![[b]]");
    expect(view.dom.querySelector(".cm-embed, .cm-embed-missing, .cm-embed-stub")).toBeNull();
  });

  it("stays its source until the vault listing lands", () => {
    const vault = fakeVault({ "x/b.md": "body" });
    const view = mount(`${ABOVE}![[b]]`, [
      vimKeys.of(false),
      livePreview(),
      embedSource.of(vault.source),
    ]);

    expect(view.contentDOM.textContent).toContain("![[b]]");
    expect(view.dom.querySelector(".cm-embed, .cm-embed-missing, .cm-embed-stub")).toBeNull();
    expect(vault.watched).toEqual([]);
  });

  it("stays its source until the image listing lands", () => {
    const vault = fakeVault({});
    const view = mount(`${ABOVE}![[shot.png]]`, [
      vimKeys.of(false),
      livePreview(),
      vaultPaths.of(["b.md"]),
      embedSource.of(vault.source),
    ]);

    expect(view.contentDOM.textContent).toContain("![[shot.png]]");
    expect(vault.watched).toEqual([]);
  });

  it("draws a note without waiting on the image listing", () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount(`${ABOVE}![[b]]`, [
      vimKeys.of(false),
      livePreview(),
      vaultPaths.of(["b.md"]),
      embedSource.of(vault.source),
    ]);

    expect(view.dom.querySelector(".cm-embed")?.textContent).toBe("body");
  });

  it("draws the note read-only, rendered, and told what the vault holds", () => {
    const vault = fakeVault({ "b.md": "# B\nsee [[ghost]]" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));
    const nested = view.dom.querySelector(".cm-embed .cm-content") as HTMLElement;

    expect(nested.getAttribute("contenteditable")).toBe("false");
    expect(nested.textContent).toBe("Bsee ghost");
    expect(nested.querySelector(".cm-wikilink-dead")?.textContent).toBe("ghost");
  });

  it("stops listening when it leaves the screen", () => {
    const vault = fakeVault({ "b.md": "body", "c.md": "other" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source, ["b.md", "c.md"]));

    view.dispatch({
      changes: { from: view.state.doc.length - 3, to: view.state.doc.length - 2, insert: "c" },
    });
    expect(vault.listening("b.md")).toBe(0);
    expect(vault.listening("c.md")).toBe(1);

    mounted.splice(mounted.indexOf(view), 1);
    view.destroy();
    expect(vault.listening("c.md")).toBe(0);
  });
});

/** Pdfs by URL and page count; a URL not listed fails to load. */
function fakePdfs(files: Record<string, number>) {
  const opened: string[] = [];
  /** Each page drawn, as its number and the scale it was drawn at. */
  const drawn: [number, number][] = [];
  let freed = 0;
  const renderer: PdfRenderer = {
    open(url) {
      opened.push(url);
      const pages = files[url];
      const file: PdfFile | undefined =
        pages === undefined
          ? undefined
          : {
              pages,
              page: async (number) => ({
                width: 600,
                height: 800,
                draw: async (_canvas, scale) => {
                  drawn.push([number, scale]);
                },
              }),
            };
      return {
        file: file === undefined ? Promise.reject(new Error("Invalid PDF")) : Promise.resolve(file),
        destroy: () => {
          freed += 1;
        },
      };
    },
  };
  return { renderer, opened, drawn, freed: () => freed };
}

/** A `ResizeObserver` that reports nothing until a test says a box changed size. */
class FakeResizer {
  static all: FakeResizer[] = [];
  readonly observed = new Set<Element>();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizer.all.push(this);
  }

  observe(target: Element) {
    this.observed.add(target);
  }

  disconnect() {
    this.observed.clear();
  }

  static resize(target: Element) {
    for (const observer of FakeResizer.all) {
      if (!observer.observed.has(target)) continue;
      const entry = { target } as ResizeObserverEntry;
      observer.callback([entry], observer as unknown as ResizeObserver);
    }
  }
}

/** An `IntersectionObserver` that sees nothing until a test says a slot came into view. */
class FakeObserver {
  static all: FakeObserver[] = [];
  readonly observed = new Set<Element>();
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeObserver.all.push(this);
  }

  observe(target: Element) {
    this.observed.add(target);
  }

  unobserve(target: Element) {
    this.observed.delete(target);
  }

  disconnect() {
    this.observed.clear();
  }

  static reveal(target: Element, isIntersecting = true) {
    for (const observer of FakeObserver.all) {
      if (!observer.observed.has(target)) continue;
      const entry = { isIntersecting, target } as IntersectionObserverEntry;
      observer.callback([entry], observer as unknown as IntersectionObserver);
    }
  }

  static hide(target: Element) {
    FakeObserver.reveal(target, false);
  }
}

const PLAN = "/api/assets/docs/plan.pdf";

/** Vim off on a vault holding `docs/plan.pdf`, drawn by `pdfs`. */
function withPdfs(source: EmbedSource, pdfs: ReturnType<typeof fakePdfs>): Extension[] {
  return [pdfRenderer.of(pdfs.renderer), ...plain(source, ["b.md", "docs/plan.pdf"])];
}

/** The page slots of the first pdf box, once the pdf has landed. */
async function slotsOf(view: EditorView): Promise<HTMLElement[]> {
  await waitFor(() => expect(view.dom.querySelector(".cm-pdf-page")).not.toBeNull());
  return [...view.dom.querySelectorAll<HTMLElement>(".cm-embed-pdf .cm-pdf-page")];
}

describe("a pdf embed", () => {
  beforeEach(() => {
    FakeObserver.all = [];
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    FakeResizer.all = [];
    vi.stubGlobal("ResizeObserver", FakeResizer);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws the pdf's pages in place in a viewer box", async () => {
    const pdfs = fakePdfs({ [PLAN]: 3 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, pdfs));

    const slots = await slotsOf(view);
    expect(slots).toHaveLength(3);
    FakeObserver.reveal(slots[0] as HTMLElement);

    await waitFor(() => expect(slots[0]?.querySelector("canvas")).not.toBeNull());
    expect(view.contentDOM.textContent).not.toContain("![[");
  });

  it("finds docs/plan.pdf by the wikilink rule", () => {
    const vault = fakeVault({});
    const pdfs = fakePdfs({ [PLAN]: 1 });
    mount(`${ABOVE}![[Plan.pdf]]`, withPdfs(vault.source, pdfs));

    expect(pdfs.opened).toEqual([PLAN]);
    expect(vault.watched).toEqual([]);
  });

  it("keeps the pdf in a fixed-height box that scrolls", () => {
    const css = readFileSync("src/styles/app.css", "utf8");

    expect(css).toMatch(/\.cm-embed-pdf\s*{[^}]*\bheight:\s*\d/s);
    expect(css).toMatch(/\.cm-embed-pdf\s*{[^}]*overflow-y:\s*auto/s);
  });

  it("draws pages as they come into view, not all at once", async () => {
    const pdfs = fakePdfs({ [PLAN]: 3 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, pdfs));
    const slots = await slotsOf(view);
    expect(pdfs.drawn).toEqual([]);

    FakeObserver.reveal(slots[1] as HTMLElement);

    await waitFor(() => expect(pdfs.drawn.map(([page]) => page)).toEqual([2]));
  });

  it("opens the pdf on ctrl or cmd and a click", () => {
    const vault = fakeVault({});
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(vault.source, fakePdfs({ [PLAN]: 1 })));
    const box = view.dom.querySelector(".cm-embed-pdf") as HTMLElement;

    fireEvent.mouseDown(box, { ctrlKey: true });
    fireEvent.mouseDown(box, { metaKey: true });

    expect(vault.opened).toEqual([
      ["docs/plan.pdf", undefined],
      ["docs/plan.pdf", undefined],
    ]);
  });

  it("does nothing on a plain click", () => {
    const vault = fakeVault({});
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(vault.source, fakePdfs({ [PLAN]: 1 })));
    const box = view.dom.querySelector(".cm-embed-pdf") as HTMLElement;

    fireEvent.pointerDown(box, { pointerType: "mouse" });
    fireEvent.mouseDown(box);
    fireEvent.click(box);

    expect(vault.opened).toEqual([]);
  });

  it("opens the pdf on a tap, and fits its pages to a phone-width box", async () => {
    const vault = fakeVault({});
    const pdfs = fakePdfs({ [PLAN]: 1 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(vault.source, pdfs));
    const box = view.dom.querySelector(".cm-embed-pdf") as HTMLElement;

    fireEvent.pointerDown(box, { pointerType: "touch" });
    fireEvent.click(box);
    expect(vault.opened).toEqual([["docs/plan.pdf", undefined]]);

    Object.defineProperty(box, "clientWidth", { value: 360 });
    const [slot] = await slotsOf(view);
    FakeObserver.reveal(slot as HTMLElement);
    await waitFor(() => expect(pdfs.drawn).toEqual([[1, (360 / 600) * window.devicePixelRatio]]));
    await waitFor(() => expect(slot?.querySelector("canvas")?.style.width).toBe("100%"));
  });

  it("reads Not found where the vault holds no such pdf", () => {
    const vault = fakeVault({});
    const pdfs = fakePdfs({});
    const view = mount(`${ABOVE}![[x.pdf]]`, withPdfs(vault.source, pdfs));

    expect(view.dom.querySelector(".cm-embed-missing")?.textContent).toBe("Not found: x.pdf");
    expect(vault.watched).toEqual([]);
    expect(pdfs.opened).toEqual([]);
  });

  it("reads an error in the box where the pdf will not load", async () => {
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, fakePdfs({})));

    await waitFor(() =>
      expect(view.dom.querySelector(".cm-embed-pdf")?.textContent).toBe("Could not read plan.pdf"),
    );
  });

  it("frees its pdf when it leaves the screen, and not on a keystroke", async () => {
    const pdfs = fakePdfs({ [PLAN]: 1 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, pdfs));
    const box = view.dom.querySelector(".cm-embed-pdf");

    view.dispatch({ changes: { from: 0, insert: "more " } });
    expect(view.dom.querySelector(".cm-embed-pdf")).toBe(box);
    expect(pdfs.freed()).toBe(0);

    view.dispatch({ changes: { from: view.state.doc.length - 2, insert: "x" } });
    expect(view.dom.querySelector(".cm-embed-pdf")).toBeNull();
    expect(pdfs.freed()).toBe(1);
  });

  it("frees a page's drawing when it leaves view, and draws it again on return", async () => {
    const pdfs = fakePdfs({ [PLAN]: 2 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, pdfs));
    const [slot] = (await slotsOf(view)) as [HTMLElement];

    FakeObserver.reveal(slot);
    await waitFor(() => expect(slot.querySelector("canvas")).not.toBeNull());
    const canvas = slot.querySelector("canvas") as HTMLCanvasElement;

    FakeObserver.hide(slot);
    expect(slot.querySelector("canvas")).toBeNull();
    expect(canvas.width).toBe(0);
    // The slot keeps the page's shape, so the box does not jump.
    expect(slot.style.aspectRatio).toBe("600 / 800");

    FakeObserver.reveal(slot);
    await waitFor(() => expect(slot.querySelector("canvas")).not.toBeNull());
    expect(pdfs.drawn).toEqual([
      [1, window.devicePixelRatio],
      [1, window.devicePixelRatio],
    ]);
  });

  it("frees every page's drawing when it leaves the screen", async () => {
    const pdfs = fakePdfs({ [PLAN]: 1 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, pdfs));
    const [slot] = (await slotsOf(view)) as [HTMLElement];
    FakeObserver.reveal(slot);
    await waitFor(() => expect(slot.querySelector("canvas")).not.toBeNull());
    const canvas = slot.querySelector("canvas") as HTMLCanvasElement;

    view.dispatch({ changes: { from: view.state.doc.length - 2, insert: "x" } });

    expect(canvas.width).toBe(0);
  });

  it("opens only the pdf, not the note around it, from inside a note embed", () => {
    const vault = fakeVault({ "b.md": "![[plan.pdf]]" });
    const view = mount(`${ABOVE}![[b]]`, withPdfs(vault.source, fakePdfs({ [PLAN]: 1 })));
    const box = view.dom.querySelector(".cm-embed .cm-embed-pdf") as HTMLElement;

    fireEvent.mouseDown(box, { ctrlKey: true });
    fireEvent.pointerDown(box, { pointerType: "touch" });
    fireEvent.click(box);

    expect(vault.opened).toEqual([
      ["docs/plan.pdf", undefined],
      ["docs/plan.pdf", undefined],
    ]);
  });

  it("shows its source with the cursor on the line, vim off", () => {
    const pdfs = fakePdfs({ [PLAN]: 1 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, pdfs));
    expect(view.dom.querySelector(".cm-embed-pdf")).not.toBeNull();

    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });

    expect(view.dom.querySelector(".cm-embed-pdf")).toBeNull();
    expect(view.contentDOM.textContent).toContain("![[plan.pdf]]");
  });

  it("keeps the cursor out of the source it hides, vim on", () => {
    const pdfs = fakePdfs({ [PLAN]: 1 });
    const doc = "![[plan.pdf]]\nplain";
    const view = mount(
      doc,
      [
        vim(),
        livePreview(),
        vaultPaths.of(["docs/plan.pdf"]),
        imagePaths.of([]),
        embedSource.of(fakeVault({}).source),
        pdfRenderer.of(pdfs.renderer),
      ],
      doc.indexOf("plain"),
    );
    expect(view.dom.querySelector(".cm-embed-pdf")).not.toBeNull();

    view.dispatch({ selection: EditorSelection.cursor(2) });

    expect(view.state.selection.main.head).toBe("![[plan.pdf]]".length);
  });

  describe("at a #page", () => {
    beforeEach(() => {
      // jsdom lays nothing out, so every offsetTop is 0. Here a slot sits 800
      // below the one before it, as a 600 by 800 page would.
      vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return [...(this.parentElement?.children ?? [])].indexOf(this) * 800;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Vim on, the cursor on the line above, on the vault `withPdfs` holds. */
    function withPdfsVim(source: EmbedSource, pdfs: ReturnType<typeof fakePdfs>): Extension[] {
      return [
        vim(),
        livePreview(),
        vaultPaths.of(["b.md", "docs/plan.pdf"]),
        imagePaths.of([]),
        embedSource.of(source),
        pdfRenderer.of(pdfs.renderer),
      ];
    }

    const modes = [
      ["vim off", withPdfs],
      ["vim on", withPdfsVim],
    ] as const;

    /** The pdf box, with a scrollTop that reads back what was set, which jsdom's does not. */
    function boxOf(view: EditorView): HTMLElement {
      const box = view.dom.querySelector(".cm-embed-pdf") as HTMLElement;
      Object.defineProperty(box, "scrollTop", { value: 0, writable: true, configurable: true });
      return box;
    }

    it.each(modes)("A1 draws page 3 at the top of the box, %s", async (_, extra) => {
      const pdfs = fakePdfs({ [PLAN]: 3 });
      const view = mount(`${ABOVE}![[plan.pdf#page=3]]`, extra(fakeVault({}).source, pdfs));
      const box = boxOf(view);

      const slots = await slotsOf(view);
      expect(box.scrollTop).toBe(1600);
      FakeObserver.reveal(slots[2] as HTMLElement);

      await waitFor(() => expect(pdfs.drawn.map(([page]) => page)).toEqual([3]));
    });

    it.each(modes)(
      "A2 opens the pdf at page 3 on ctrl or cmd and a click, %s",
      async (_, extra) => {
        const vault = fakeVault({});
        const view = mount(
          `${ABOVE}![[plan.pdf#page=3]]`,
          extra(vault.source, fakePdfs({ [PLAN]: 3 })),
        );
        const box = boxOf(view);
        await slotsOf(view);

        fireEvent.mouseDown(box, { ctrlKey: true });
        fireEvent.mouseDown(box, { metaKey: true });

        expect(vault.opened).toEqual([
          ["docs/plan.pdf", 3],
          ["docs/plan.pdf", 3],
        ]);
      },
    );

    it.each(modes)(
      "A3 opens the pdf at page 3 on a tap, in a phone-width box, %s",
      async (_, extra) => {
        const vault = fakeVault({});
        const pdfs = fakePdfs({ [PLAN]: 3 });
        const view = mount(`${ABOVE}![[plan.pdf#page=3]]`, extra(vault.source, pdfs));
        const box = boxOf(view);
        Object.defineProperty(box, "clientWidth", { value: 360 });

        const slots = await slotsOf(view);
        fireEvent.pointerDown(box, { pointerType: "touch" });
        fireEvent.click(box);
        expect(vault.opened).toEqual([["docs/plan.pdf", 3]]);

        expect(box.scrollTop).toBe(1600);
        FakeObserver.reveal(slots[2] as HTMLElement);
        await waitFor(() =>
          expect(pdfs.drawn).toEqual([[3, (360 / 600) * window.devicePixelRatio]]),
        );
      },
    );

    it("A1 keeps page 3 at the top when the box changes width, or is hidden and shown", async () => {
      const view = mount(
        `${ABOVE}![[plan.pdf#page=3]]`,
        withPdfs(fakeVault({}).source, fakePdfs({ [PLAN]: 3 })),
      );
      const box = boxOf(view);
      // How tall a page is, and so how far each slot sits below the last.
      let tall = 800;
      const index = (slot: HTMLElement) => [...(slot.parentElement?.children ?? [])].indexOf(slot);
      vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return index(this) * tall;
      });
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => tall);
      Object.defineProperty(box, "scrollHeight", { get: () => 3 * tall });
      Object.defineProperty(box, "clientHeight", { value: 512 });
      await slotsOf(view);
      expect(box.scrollTop).toBe(1600);

      // Half as wide, so every page is half as tall, and the browser leaves
      // the scroll in pixels, which is now somewhere else.
      tall = 400;
      box.scrollTop = 9;
      FakeResizer.resize(box);
      expect(box.scrollTop).toBe(800);

      // Scrolled by hand to halfway down page 2, then as wide as before.
      box.scrollTop = 600;
      fireEvent.scroll(box);
      tall = 800;
      FakeResizer.resize(box);
      expect(box.scrollTop).toBe(1200);

      // Hidden, the box has no layout and the browser drops its scroll.
      tall = 0;
      box.scrollTop = 0;
      fireEvent.scroll(box);
      FakeResizer.resize(box);
      tall = 800;
      FakeResizer.resize(box);
      expect(box.scrollTop).toBe(1200);
    });

    it("B2 keeps page 3 when a scroll at 0 arrives before the resize on showing again", async () => {
      const view = mount(
        `${ABOVE}![[plan.pdf#page=3]]`,
        withPdfs(fakeVault({}).source, fakePdfs({ [PLAN]: 3 })),
      );
      const box = boxOf(view);
      let tall = 800;
      const index = (slot: HTMLElement) => [...(slot.parentElement?.children ?? [])].indexOf(slot);
      vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return index(this) * tall;
      });
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => tall);
      let high = 512;
      Object.defineProperty(box, "scrollHeight", { get: () => 3 * tall });
      Object.defineProperty(box, "clientHeight", { get: () => high });
      await slotsOf(view);
      expect(box.scrollTop).toBe(1600);

      // Hidden: no layout, and the browser drops the scroll.
      tall = 0;
      high = 0;
      box.scrollTop = 0;
      FakeResizer.resize(box);

      // Shown again, laid out with the scroll still at 0, and a browser that
      // runs its scroll steps before the resize observers says so first.
      tall = 800;
      high = 512;
      fireEvent.scroll(box);
      FakeResizer.resize(box);
      expect(box.scrollTop).toBe(1600);
    });

    it("A1 keeps the last page at the top through a scroll the browser cut short", async () => {
      const view = mount(
        `${ABOVE}![[plan.pdf#page=3]]`,
        withPdfs(fakeVault({}).source, fakePdfs({ [PLAN]: 3 })),
      );
      const box = boxOf(view);
      let tall = 400;
      const index = (slot: HTMLElement) => [...(slot.parentElement?.children ?? [])].indexOf(slot);
      vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return index(this) * tall;
      });
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => tall);
      Object.defineProperty(box, "scrollHeight", { get: () => 3 * tall });
      Object.defineProperty(box, "clientHeight", { value: 512 });
      await slotsOf(view);

      // A phone held upright: the last page is shorter than the box, so the
      // browser stops the scroll at its end, inside page 2, and says so.
      box.scrollTop = 3 * 400 - 512;
      fireEvent.scroll(box);

      // Turned, the pages are taller than the box, and page 3 fits at its top.
      tall = 800;
      FakeResizer.resize(box);
      expect(box.scrollTop).toBe(1600);
    });

    it.each(["#page=9", "#page=0", "#page=-1", "#page=abc", "#page=2.5", "#page=", "#", "#intro"])(
      "A4 draws and opens page 1 for %s",
      async (fragment) => {
        const vault = fakeVault({});
        const view = mount(
          `${ABOVE}![[plan.pdf${fragment}]]`,
          withPdfs(vault.source, fakePdfs({ [PLAN]: 3 })),
        );
        const box = boxOf(view);

        await slotsOf(view);
        fireEvent.mouseDown(box, { ctrlKey: true });

        expect(box.scrollTop).toBe(0);
        expect(vault.opened).toEqual([["docs/plan.pdf", undefined]]);
      },
    );

    it("I1 redraws at page 4 when the source says 4, and not on a keystroke elsewhere", async () => {
      const pdfs = fakePdfs({ [PLAN]: 4 });
      const view = mount(`${ABOVE}![[plan.pdf#page=3]]`, withPdfs(fakeVault({}).source, pdfs));
      const first = boxOf(view);
      await slotsOf(view);
      expect(first.scrollTop).toBe(1600);

      const at = view.state.doc.toString().indexOf("page=3") + 5;
      view.dispatch({ changes: { from: at, to: at + 1, insert: "4" } });
      const second = boxOf(view);
      expect(second).not.toBe(first);
      expect(pdfs.opened).toHaveLength(2);
      await waitFor(() => expect(second.querySelectorAll(".cm-pdf-page")).toHaveLength(4));
      expect(second.scrollTop).toBe(2400);

      view.dispatch({ changes: { from: 0, insert: "more " } });
      expect(view.dom.querySelector(".cm-embed-pdf")).toBe(second);
      expect(pdfs.opened).toHaveLength(2);
    });

    it.each(["![[plan.pdf#page=3|the plan]]", "![[Plan.pdf#page=3]]"])(
      "I2 draws and opens %s at page 3",
      async (embed) => {
        const vault = fakeVault({});
        const view = mount(`${ABOVE}${embed}`, withPdfs(vault.source, fakePdfs({ [PLAN]: 3 })));
        const box = boxOf(view);

        await slotsOf(view);
        fireEvent.mouseDown(box, { ctrlKey: true });

        expect(box.scrollTop).toBe(1600);
        expect(vault.opened).toEqual([["docs/plan.pdf", 3]]);
      },
    );

    it.each([
      ["#page=3", 3],
      ["#page=9", 9],
      ["#page=abc", undefined],
    ])("I3 opens %s before the pdf lands at %s", (fragment, page) => {
      const vault = fakeVault({});
      const view = mount(
        `${ABOVE}![[plan.pdf${fragment}]]`,
        withPdfs(vault.source, fakePdfs({ [PLAN]: 3 })),
      );
      const box = view.dom.querySelector(".cm-embed-pdf") as HTMLElement;

      fireEvent.mouseDown(box, { ctrlKey: true });

      expect(box.querySelector(".cm-pdf-page")).toBeNull();
      expect(vault.opened).toEqual([["docs/plan.pdf", page]]);
    });
  });
});

describe("a nested cloze", () => {
  const NESTED = "{{c1::a {{c2::b::h2}}::h1}}";

  /** The text drawn for the document's last line. */
  function lastLine(view: EditorView): string {
    return [...view.contentDOM.querySelectorAll(".cm-line")].at(-1)?.textContent ?? "";
  }

  it("A7 live preview shows a nested cloze as typed", () => {
    const view = mount(`intro\n\n${NESTED}`, plain(null));

    expect(lastLine(view)).toBe(NESTED);
  });

  it("A8 a nested cloze line stays intact with vim on and off", async () => {
    const on = mount(`intro\n\n${NESTED}`, [
      vim(),
      livePreview(),
      vaultPaths.of([]),
      imagePaths.of([]),
    ]);
    // jsdom sends no text input, so vim's keys carry the cursor to the end of
    // the line and the character goes in as a dispatch, the way typing lands.
    fireEvent.keyDown(on.contentDOM, { key: "G" });
    fireEvent.keyDown(on.contentDOM, { key: "A" });
    const end = on.state.selection.main.head;
    expect(end).toBe(on.state.doc.length);
    on.dispatch({ changes: { from: end, insert: "!" }, userEvent: "input.type" });
    fireEvent.keyDown(on.contentDOM, { key: "Escape" });

    expect(on.state.doc.toString()).toBe(`intro\n\n${NESTED}!`);
    await waitFor(() => expect(lastLine(on)).toBe(`${NESTED}!`));

    const off = mount(`intro\n\n${NESTED}`, plain(null));
    off.dispatch({ selection: EditorSelection.cursor(off.state.doc.length) });
    off.dispatch({
      changes: { from: off.state.doc.length, insert: "!" },
      userEvent: "input.type",
    });

    expect(off.state.doc.toString()).toBe(`intro\n\n${NESTED}!`);
    expect(lastLine(off)).toBe(`${NESTED}!`);
  });
});

describe("a [text] with no (url) (#441)", () => {
  const VIM = [
    ["vim on", true],
    ["vim off", false],
  ] as const;

  /** With the app's highlighter, which is what gave the brackets a link's look. */
  function lit(vimOn: boolean): Extension[] {
    return [
      oneDark,
      ...(vimOn ? [vim(), livePreview(), vaultPaths.of([]), imagePaths.of([])] : plain(null)),
    ];
  }

  /**
   * The classes the highlighter gives a link's text, its brackets and a
   * reference's label, read off a bare one rather than named, the names being
   * generated.
   */
  function linkLook(): string[] {
    const view = mount("[a][r]", [oneDark]);
    const spans = [...view.contentDOM.querySelectorAll("span")];
    return [...new Set(spans.flatMap((span) => [...span.classList]))];
  }

  /** The elements of `line` wearing that look outside the mark that takes it off. */
  function linkLooking(line: Element): Element[] {
    const look = linkLook();
    // A link's text, its brackets and its label: three, or the probe read nothing.
    expect(look).toHaveLength(3);
    return [...line.querySelectorAll("*")].filter(
      (el) =>
        look.some((name) => el.classList.contains(name)) &&
        el.closest(".cm-plain-brackets") === null,
    );
  }

  function lineOf(view: EditorView, n: number): Element {
    return view.contentDOM.querySelectorAll(".cm-line")[n] as Element;
  }

  it.each(VIM)("draws see [text] here as plain text, the cursor elsewhere: %s", (_, vimOn) => {
    const line = lineOf(mount("intro\n\nsee [text] here", lit(vimOn)), 2);

    expect(line.textContent).toBe("see [text] here");
    expect(linkLooking(line)).toEqual([]);
  });

  it.each(VIM)("draws [text] as plain text with the cursor on it: %s", (_, vimOn) => {
    const doc = "intro\n\nsee [text] here";
    const line = lineOf(mount(doc, lit(vimOn), doc.indexOf("text")), 2);

    expect(line.textContent).toBe("see [text] here");
    expect(linkLooking(line)).toEqual([]);
  });

  it.each(VIM)("keeps bold and a heading on a [text], the link look gone: %s", (_, vimOn) => {
    const view = mount("intro\n\n**x [b] y**\n\n# a [h] z", lit(vimOn));
    const bold = lineOf(view, 2);
    const heading = lineOf(view, 4);
    // The heading's colour is a highlight class on the same spans, read off a
    // bare heading the way the link's look is.
    const spans = mount("# h", [oneDark]).contentDOM.querySelectorAll("span");
    const headingClass = spans[spans.length - 1]?.className;

    expect(bold.textContent).toBe("x [b] y");
    expect(linkLooking(bold)).toEqual([]);
    expect(bold.querySelector(".cm-plain-brackets")?.closest(".cm-strong")).not.toBeNull();
    expect(heading.textContent).toBe("a [h] z");
    expect(heading.classList.contains("cm-heading-1")).toBe(true);
    expect(linkLooking(heading)).toEqual([]);
    expect(heading.querySelector(".cm-plain-brackets span")?.classList).toContain(headingClass);
  });

  it.each(VIM)("draws a [text][ref] as plain text, the [ref] too: %s", (_, vimOn) => {
    const line = lineOf(mount("intro\n\nsee [text][ref] here", lit(vimOn)), 2);

    expect(line.textContent).toBe("see [text][ref] here");
    expect(linkLooking(line)).toEqual([]);
  });

  it.each(VIM)("draws a [x] at the head of a quote line as plain text (#435): %s", (_, vimOn) => {
    const line = lineOf(mount("intro\n\n> [x] done", lit(vimOn)), 2);

    expect(line.textContent).toContain("[x] done");
    expect(linkLooking(line)).toEqual([]);
  });

  it("resets the highlighter's spans under the mark, not kasten's marks inside it", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const selector = /([^}/]*\.cm-plain-brackets[^{]*){[^}]*color:\s*inherit/s
      .exec(css)?.[1]
      ?.trim();
    const line = lineOf(mount("intro\n\nsee [**b** `c` ~~s~~ [[n]] #t] here", lit(false)), 2);
    const look = linkLook();
    const inside = [...line.querySelectorAll(".cm-plain-brackets span")];
    const marks = inside.filter((el) => [...el.classList].some((name) => name.startsWith("cm-")));
    const looking = inside.filter((el) => look.some((name) => el.classList.contains(name)));

    expect(selector).toBeDefined();
    // Bold, code, strikethrough, the wikilink and the tag.
    expect(marks).toHaveLength(5);
    expect(marks.filter((el) => el.matches(selector as string))).toEqual([]);
    expect(looking.length).toBeGreaterThan(0);
    expect(looking.filter((el) => !el.matches(selector as string))).toEqual([]);
  });

  it("leaves a real link its look", () => {
    const line = lineOf(mount("intro\n\nsee [a](https://example.com) here", lit(false)), 2);

    expect(line.querySelector(".cm-link")?.textContent).toBe("a");
    expect(line.querySelector(".cm-plain-brackets")).toBeNull();
  });
});

describe("an escape the import writes (#342, #343)", () => {
  /** The text drawn for the document's last line, the cursor on the first. */
  function drawnLast(line: string, vimOn: boolean): string {
    const view = mount(
      `intro\n\n${line}`,
      vimOn ? [vim(), livePreview(), vaultPaths.of([]), imagePaths.of([])] : plain(null),
    );
    return [...view.contentDOM.querySelectorAll(".cm-line")].at(-1)?.textContent ?? "";
  }

  it.each([
    ["vim on", true],
    ["vim off", false],
  ])("A1 shows a code span holding &#58; as &#58; off the line, %s", (_, vimOn) => {
    expect(drawnLast("`&#58;`", vimOn)).toBe("&#58;");
  });

  it.each([
    ["vim on", true],
    ["vim off", false],
  ])("A3 shows a\\\\-b as a\\-b off the line, %s", (_, vimOn) => {
    expect(drawnLast("a\\\\-b", vimOn)).toBe("a\\-b");
  });

  it("A3 review draws a card side a\\\\-b as a\\-b", () => {
    const { container } = render(<NotePreview text={"a\\\\-b"} />);

    expect(content(container)).toBe("a\\-b");
  });

  it("A4 review draws the answer ==a\\\\::b== as a\\::b", () => {
    const { container } = render(<NotePreview text={"==a\\\\::b=="} />);

    expect(content(container)).toBe("a\\::b");
  });
});

describe("an image in a table cell (#504)", () => {
  /** A line above the table, so the cursor at offset zero is off it. */
  function table(...rows: string[]): string {
    return ["intro", "", ...rows].join("\n");
  }

  function lit(vimOn: boolean): Extension[] {
    return vimOn ? [vim(), livePreview(), vaultPaths.of([]), imagePaths.of([])] : plain(null);
  }

  function cells(view: EditorView, selector = "tbody td"): HTMLElement[] {
    return [...view.dom.querySelectorAll<HTMLElement>(`.cm-table-grid ${selector}`)];
  }

  it.each([
    ["A1", "vim off", false],
    ["A2", "vim on", true],
  ] as const)("%s draws ![](path) in a cell as its picture, %s", (_, __, vimOn) => {
    const doc = table("| a | b |", "| --- | --- |", "| ![](p.png) | ![](ftp://x/a.png) |");
    const view = mount(doc, lit(vimOn));

    const [drawn, refused] = cells(view);
    expect(drawn?.querySelector("img.cm-image")?.getAttribute("src")).toBe("/api/assets/p.png");
    // An address `imageSource` cannot load stays its source, as it does outside a table.
    expect(refused?.querySelector("img")).toBeNull();
    expect(refused?.textContent).toBe("![](ftp://x/a.png)");

    act(() => view.dispatch({ selection: { anchor: doc.indexOf("p.png") } }));
    expect(view.dom.querySelector(".cm-table-grid")).toBeNull();
    expect(view.contentDOM.textContent).toContain("| ![](p.png) | ![](ftp://x/a.png) |");
  });

  it("A3 draws two percent-encoded images side by side in a note in a subfolder", () => {
    const pbi = "99%20Misc/02%20Assets/01%20Images/aibi-judge-01-pbi.png";
    const aibi = "99%20Misc/02%20Assets/01%20Images/aibi-judge-01-aibi.png";
    const view = mount(
      table("| Power BI | AI/BI |", "|---|---|", `| ![](${pbi}) | ![](${aibi}) |`),
      [...plain(null), notePath.of("02 Projects/AIBI Migration Plugin/Judge Labels 2026-10-18.md")],
    );

    const row = view.dom.querySelector(".cm-table-grid tbody tr") as HTMLElement;
    expect([...row.querySelectorAll("img.cm-image")].map((img) => img.getAttribute("src"))).toEqual(
      [`/api/assets/${pbi}`, `/api/assets/${aibi}`],
    );
  });

  it("I2 asks for a measurement when a picture in a cell loads", () => {
    const view = mount(table("| a |", "| --- |", "| ![](p.png) |"), plain(null));
    const measure = vi.spyOn(view, "requestMeasure");

    const image = view.dom.querySelector(".cm-table-grid img.cm-image") as HTMLImageElement;
    expect(image.referrerPolicy).toBe("no-referrer");
    image.dispatchEvent(new Event("load"));
    expect(measure).toHaveBeenCalled();
  });

  it("I3 keeps the text and marks beside a picture in a cell, alt carried", () => {
    const view = mount(table("| a |", "| --- |", "| a ![x](p.png) **b** |"), plain(null));

    const [cell] = cells(view);
    expect(cell?.firstChild?.textContent).toBe("a ");
    expect(cell?.querySelector("img.cm-image")?.getAttribute("alt")).toBe("x");
    expect(cell?.querySelector(".cm-strong")?.textContent).toBe("b");
  });

  it("I4 leaves a sound and a video in a cell as source, a picture beside them drawn", () => {
    const view = mount(
      table(
        "| a | b | c |",
        "| - | - | - |",
        "| ![](word.mp3) | ![](https://youtu.be/iDulhoQ2pro) | ![](p.png) |",
      ),
      plain(null),
    );

    const [sound, video, picture] = cells(view);
    expect(sound?.textContent).toBe("![](word.mp3)");
    expect(video?.textContent).toBe("![](https://youtu.be/iDulhoQ2pro)");
    expect(view.dom.querySelectorAll(".cm-table-grid img")).toHaveLength(1);
    expect(picture?.querySelector("img")?.getAttribute("src")).toBe("/api/assets/p.png");
  });

  it("I5 draws a picture in a header cell", () => {
    const view = mount(table("| ![h](p.png) |", "| --- |", "| a |"), plain(null));

    const [head] = cells(view, "thead th");
    expect(head?.querySelector("img.cm-image")?.getAttribute("alt")).toBe("h");
  });
});

describe("an embed or a wrapped image in a table cell (#507, #508)", () => {
  const SHOT = "/api/assets/99%20Misc/my%20shot.png";

  /** A line above the table, so the cursor at offset zero is off it. */
  function table(...cells: string[]): string {
    const row = (cell: (text: string) => string) =>
      `|${cells.map((c) => ` ${cell(c)} |`).join("")}`;
    return ["intro", "", row(() => "h"), row(() => "-"), row((c) => c)].join("\n");
  }

  function lit(vimOn: boolean): Extension[] {
    return vimOn
      ? [vim(), livePreview(), vaultPaths.of(["b.md"]), imagePaths.of(["99 Misc/my shot.png"])]
      : plain(null);
  }

  function cells(view: EditorView): HTMLElement[] {
    return [...view.dom.querySelectorAll<HTMLElement>(".cm-table-grid tbody td")];
  }

  it("A1 draws ![[x.png]] in a cell as the picture the vault holds", () => {
    const view = mount(table("![[my shot.png]]"), plain(null));

    const [cell] = cells(view);
    expect(cell?.querySelector("img.cm-image")?.getAttribute("src")).toBe(SHOT);
    expect(cell?.textContent).toBe("");
  });

  it("A2 draws ![[x.png\\|200]] in a cell at width 200", () => {
    // The bar escaped, as a table needs it to be.
    const view = mount(table("![[my shot.png\\|200]]"), plain(null));

    const image = cells(view)[0]?.querySelector("img.cm-image");
    expect(image?.getAttribute("src")).toBe(SHOT);
    expect(image?.getAttribute("width")).toBe("200");
    expect(image?.getAttribute("alt")).toBe("");
  });

  it("A3 draws a picture wrapped in a link in a cell", () => {
    const view = mount(table("[![](p.png)](https://example.com)"), plain(null));

    const [cell] = cells(view);
    expect(cell?.querySelector("img.cm-image")?.getAttribute("src")).toBe("/api/assets/p.png");
    expect(cell?.textContent).toBe("");
  });

  it.each([["**![](p.png)**"], ["*![](p.png)*"]])(
    "A4 draws a picture wrapped in emphasis in a cell, %s",
    (source) => {
      const view = mount(table(source), plain(null));

      const [cell] = cells(view);
      expect(cell?.querySelector("img.cm-image")?.getAttribute("src")).toBe("/api/assets/p.png");
      expect(cell?.textContent).toBe("");
    },
  );

  it("A4 draws bold text around a picture in a cell as bold text and the picture", () => {
    const view = mount(table("**word ![](p.png) more**"), plain(null));

    const [cell] = cells(view);
    expect(cell?.querySelector("img.cm-image")?.getAttribute("src")).toBe("/api/assets/p.png");
    expect([...(cell?.querySelectorAll(".cm-strong") ?? [])].map((s) => s.textContent)).toEqual([
      "word ",
      " more",
    ]);
  });

  it.each([
    ["vim off", false],
    ["vim on", true],
  ] as const)("A6 draws the embedded, linked and emphasized pictures of a cell, %s", (_, vimOn) => {
    const doc = table(
      "![[my shot.png]]",
      "![[my shot.png\\|200]]",
      "[![](p.png)](https://example.com)",
      "**![](p.png)**",
      "*![](p.png)*",
    );
    const view = mount(doc, lit(vimOn));

    expect(
      cells(view).map((cell) => cell.querySelector("img.cm-image")?.getAttribute("src")),
    ).toEqual([SHOT, SHOT, "/api/assets/p.png", "/api/assets/p.png", "/api/assets/p.png"]);
  });

  it("I1 shows every cell's source again, marks included, with the cursor in the table", () => {
    const row = "| ![[my shot.png\\|200]] | [![](p.png)](https://example.com) | **![](p.png)** |";
    const doc = ["intro", "", "| a | b | c |", "| - | - | - |", row].join("\n");
    const view = mount(doc, plain(null));
    expect(view.dom.querySelector(".cm-table-grid")).not.toBeNull();

    act(() => view.dispatch({ selection: { anchor: doc.indexOf("p.png") } }));
    expect(view.dom.querySelector(".cm-table-grid")).toBeNull();
    expect(view.dom.querySelector("img")).toBeNull();
    expect(view.contentDOM.textContent).toContain(row);
  });

  it("I2 leaves ![[missing.png]] and a note embed ![[note]] in a cell as source", () => {
    const view = mount(table("![[missing.png]]", "![[b]]"), plain(null));

    expect(cells(view).map((cell) => cell.textContent)).toEqual(["![[missing.png]]", "![[b]]"]);
    expect(view.dom.querySelector(".cm-table-grid img")).toBeNull();
  });

  it("I3 reads an embed's alias in a cell as Obsidian does: words are alt, 200x100 a size", () => {
    const view = mount(
      table("![[my shot.png\\|some words]]", "![[my shot.png\\|200x100]]"),
      plain(null),
    );

    const [words, sized] = cells(view).map((cell) => cell.querySelector("img.cm-image"));
    expect(words?.getAttribute("alt")).toBe("some words");
    expect(words?.hasAttribute("width")).toBe(false);
    expect(words?.hasAttribute("height")).toBe(false);
    expect(sized?.getAttribute("width")).toBe("200");
    expect(sized?.getAttribute("height")).toBe("100");
  });

  it("I4 draws ![[x.png|200]] at width 200 outside a table too", () => {
    const view = mount(`${ABOVE}![[my shot.png|200]]`, plain(null));

    const image = view.dom.querySelector("img.cm-image");
    expect(image?.getAttribute("src")).toBe(SHOT);
    expect(image?.getAttribute("width")).toBe("200");
  });

  it("I5 still draws a link and emphasis around text in a cell", () => {
    const view = mount(table("[site](https://example.com)", "**bold**", "*soft*"), plain(null));

    const [link, bold, soft] = cells(view);
    expect(link?.querySelector(".cm-link")?.textContent).toBe("site");
    expect(bold?.querySelector(".cm-strong")?.textContent).toBe("bold");
    expect(soft?.querySelector(".cm-emphasis")?.textContent).toBe("soft");
    expect(cells(view).map((cell) => cell.textContent)).toEqual(["site", "bold", "soft"]);
  });

  it("I8 draws ![[x.png]] in a cell once the image listing lands", () => {
    const view = mount(table("![[my shot.png]]"), [
      vimKeys.of(false),
      livePreview(),
      vaultPaths.of([]),
    ]);
    expect(cells(view)[0]?.textContent).toBe("![[my shot.png]]");

    act(() =>
      view.dispatch({
        effects: StateEffect.appendConfig.of(imagePaths.of(["99 Misc/my shot.png"])),
      }),
    );
    expect(cells(view)[0]?.querySelector("img.cm-image")?.getAttribute("src")).toBe(SHOT);
  });
});
