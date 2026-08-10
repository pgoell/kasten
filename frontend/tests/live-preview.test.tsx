import { fireEvent, render, waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";

function content(container: HTMLElement): string {
  return (container.querySelector(".cm-content") as HTMLElement).textContent ?? "";
}

describe("live preview", () => {
  it("hides heading marks in normal mode", () => {
    const { container } = render(<Editor initialDoc={"## Notes\n\nplain"} />);

    expect(content(container)).toContain("Notes");
    expect(content(container)).not.toContain("##");
  });

  it("reveals the cursor's line on entering insert mode", async () => {
    const { container } = render(<Editor initialDoc={"## Notes\n\nplain"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toContain("## Notes"));
  });

  it("re-hides the marks on escape back to normal", async () => {
    const { container } = render(<Editor initialDoc={"## Notes\n\nplain"} />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    // Waited for on the way in as well, so the re-hide is a round trip rather
    // than a reveal that never happened.
    fireEvent.keyDown(editor, { key: "i" });
    await waitFor(() => expect(content(container)).toContain("##"));

    fireEvent.keyDown(editor, { key: "Escape" });

    await waitFor(() => expect(content(container)).not.toContain("##"));
  });

  it("renders inline emphasis with the marks hidden", () => {
    const { container } = render(
      <Editor initialDoc="**bold** and *italic* and `code` and ~~gone~~" />,
    );

    expect(content(container)).toBe("bold and italic and code and gone");
  });

  it("renders a highlight with its equals signs hidden", () => {
    const { container } = render(<Editor initialDoc="a ==marked== word" />);

    expect(content(container)).toBe("a marked word");
  });

  it("reveals inline marks on the cursor's line in insert mode", async () => {
    const { container } = render(<Editor initialDoc="**bold**" />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("**bold**"));
  });

  it("reveals inline marks in visual mode", async () => {
    const { container } = render(<Editor initialDoc="**bold**" />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "v" });

    await waitFor(() => expect(content(container)).toBe("**bold**"));
  });

  it("renders a link as its text alone", () => {
    const { container } = render(<Editor initialDoc="see [the docs](https://example.com) now" />);

    expect(content(container)).toBe("see the docs now");
  });

  it("reveals the whole link on the cursor's line in insert mode", async () => {
    const { container } = render(<Editor initialDoc="see [the docs](https://example.com) now" />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("see [the docs](https://example.com) now"));
  });

  it("renders a wikilink as the note it names", () => {
    const { container } = render(<Editor initialDoc="see [[reading/borges]] now" />);

    expect(content(container)).toBe("see reading/borges now");
    expect(container.querySelector(".cm-wikilink")?.textContent).toBe("reading/borges");
  });

  it("reveals the brackets on the cursor's line in insert mode", async () => {
    const { container } = render(<Editor initialDoc="see [[borges]] now" />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("see [[borges]] now"));
  });

  it("marks a link to a note the vault does not hold", () => {
    const { container } = render(
      <Editor initialDoc="[[borges]] and [[ficciones]]" paths={["reading/borges.md"]} />,
    );

    expect(container.querySelectorAll(".cm-wikilink")).toHaveLength(2);
    expect(container.querySelector(".cm-wikilink-dead")?.textContent).toBe("ficciones");
  });

  it("marks nothing dead where the vault is not known, as in a preview pane", () => {
    // No listing is not an empty listing: a view that was told nothing must not
    // call every link in the note broken.
    const { container } = render(<Editor initialDoc="[[borges]]" />);

    expect(container.querySelector(".cm-wikilink")).not.toBeNull();
    expect(container.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  it("brings a link back to life when the note it names arrives", () => {
    const { container, rerender } = render(<Editor initialDoc="[[borges]]" paths={[]} />);
    expect(container.querySelector(".cm-wikilink-dead")).not.toBeNull();

    rerender(<Editor initialDoc="[[borges]]" paths={["borges.md"]} />);

    expect(container.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  // The three below read the class rather than the text: markdown's own
  // shortcut reference link claims a `[bracketed]` run whatever is in it, and
  // hiding those brackets is what this file has always done. What is being
  // asked here is only whether a wikilink opened, and none of the three is one.
  it("makes no wikilink of a bracket pair with no note in it", () => {
    const { container } = render(<Editor initialDoc="[[]] and [[ ]]" />);

    expect(container.querySelector(".cm-wikilink")).toBeNull();
  });

  it("leaves an unclosed wikilink alone", () => {
    const { container } = render(<Editor initialDoc="[[borges and more" />);

    expect(content(container)).toBe("[[borges and more");
  });

  it("does not carry a wikilink across a line break", () => {
    const { container } = render(<Editor initialDoc={"[[borges\nand]] more"} />);

    expect(container.querySelector(".cm-wikilink")).toBeNull();
  });

  it("returns to normal mode when escape leaves visual mode", async () => {
    // vim signals this mode change from inside its own dispatch, so answering
    // it synchronously re-enters the update, CodeMirror kills the plugin that
    // did it, and the editor is left with no vim at all.
    const { container } = render(<Editor initialDoc={"## Notes\nbeta"} />);
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
    const { container } = render(<Editor initialDoc={"> quoted\n\n- first\n- second"} />);

    expect(content(container)).toBe("quotedfirstsecond");
  });

  it("stops drawing the bullet on the line that shows its dash", async () => {
    const { container } = render(<Editor initialDoc={"- first\n- second"} />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    expect(container.querySelectorAll(".cm-bullet")).toHaveLength(2);

    fireEvent.keyDown(editor, { key: "i" });

    // The revealed line puts the real `- ` back on screen, and the drawn dot
    // beside it would be a second bullet on the same line.
    await waitFor(() => expect(container.querySelectorAll(".cm-bullet")).toHaveLength(1));
    expect(content(container)).toContain("- first");
  });

  it("hides the whitespace that nests a list item", () => {
    const { container } = render(<Editor initialDoc={"- first\n  - nested"} />);

    expect(content(container)).toBe("firstnested");
  });

  it("indents a nested bullet past its parent", () => {
    // The spaces that nest the item are hidden with the dash, so the indent
    // has to be drawn or the nesting disappears from the render.
    const { container } = render(<Editor initialDoc={"- first\n  - nested"} />);
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
      const { container, unmount } = render(<Editor initialDoc={`- [${box}] task`} />);

      expect(content(container)).toBe("task");
      expect(container.querySelector(`.cm-todo-${state}`)).not.toBeNull();
      unmount();
    }
  });

  it("draws a bullet holding a wikilink as a bullet, that being no todo", () => {
    const { container } = render(<Editor initialDoc="- [[borges]]" />);

    expect(container.querySelector("[class*='cm-todo']")).toBeNull();
    expect(container.querySelector(".cm-bullet")).not.toBeNull();
  });

  it("hands the box back on the line being edited", async () => {
    const { container } = render(<Editor initialDoc={"- [/] task"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    // The symbol goes with it, or the line carries the drawing and its source.
    await waitFor(() => expect(content(container)).toContain("- [/] "));
    expect(container.querySelector("[class*='cm-todo']")).toBeNull();
  });

  it("keeps the cursor out of the box it hid", () => {
    // The hidden run on a todo is six characters rather than the bullet's two,
    // so the walk that keeps a cursor off them has further to go.
    const { container } = render(<Editor initialDoc="- [ ] task" />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(editor, { key: "0" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(content(container)).toBe("ask");
  });

  it("colours a due date that has passed", () => {
    // Two dates nothing can reach, so the assertion holds on any day the suite
    // runs: one before every possible today and one after.
    const { container } = render(
      <Editor initialDoc={"- [ ] late 📅 1970-01-01\n- [ ] soon 📅 2999-01-01"} />,
    );

    const overdue = container.querySelectorAll(".cm-todo-overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.textContent).toBe("📅 1970-01-01");
  });

  it("keeps the overdue colour on the line being edited", async () => {
    // Unlike the symbol, the red stands in for nothing: it is colour on text
    // that is on the screen whether the line shows its source or not.
    const { container } = render(<Editor initialDoc={"- [ ] late 📅 1970-01-01"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toContain("- [ ] "));
    expect(container.querySelectorAll(".cm-todo-overdue")).toHaveLength(1);
  });

  it("leaves the text of tables and code fences untouched", () => {
    // A fence is drawn as a block but nothing in it is hidden: the language and
    // the backticks are part of what you came to read. A table gets neither,
    // needing widget decorations that live preview does not have yet.
    const lines = ["```js", "const x = 1;", "```", "| a | b |", "| - | - |", "| 1 | 2 |"];
    const { container } = render(<Editor initialDoc={lines.join("\n")} />);

    expect(content(container)).toBe(lines.join(""));
  });

  it("draws a fenced block as one surface, top and bottom marked", () => {
    const lines = ["before", "```js", "const x = 1;", "const y = 2;", "```", "after"];
    const { container } = render(<Editor initialDoc={lines.join("\n")} />);

    // Every line of the fence, the two backtick lines included.
    expect(container.querySelectorAll(".cm-code-block")).toHaveLength(4);
    // The corners are rounded on the outside only, so the run reads as a box.
    expect(container.querySelectorAll(".cm-code-open")).toHaveLength(1);
    expect(container.querySelectorAll(".cm-code-close")).toHaveLength(1);
  });

  it("draws a divider in place of the three dashes", () => {
    const { container } = render(<Editor initialDoc={"above\n\n---\n\nbelow"} />);

    expect(container.querySelectorAll(".cm-rule")).toHaveLength(1);
    // Drawn rather than typed, so the dashes themselves are off the screen.
    expect(content(container)).toBe("abovebelow");
  });

  it("hands the dashes back on the line being edited", async () => {
    const { container } = render(<Editor initialDoc={"---\n\nbelow"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    // The drawn line goes with them, or the row carries a rule and its source.
    await waitFor(() => expect(content(container)).toContain("---"));
    expect(container.querySelectorAll(".cm-rule")).toHaveLength(0);
  });

  it("leaves a setext underline alone, that being a heading and not a rule", () => {
    const { container } = render(<Editor initialDoc={"Title\n---\n\nbody"} />);

    expect(container.querySelectorAll(".cm-rule")).toHaveLength(0);
  });

  it("leaves prose outside the fence alone", () => {
    const { container } = render(<Editor initialDoc={"prose\n```\ncode\n```"} />);
    const first = container.querySelector(".cm-line");

    expect(first?.textContent).toBe("prose");
    expect(first?.classList.contains("cm-code-block")).toBe(false);
  });

  it("settles rather than bouncing between two touching hidden ranges", () => {
    // The heading mark ends at 3 and the bold mark starts there, so a cursor
    // pushed out of the first lands straight inside the second.
    const { container } = render(<Editor initialDoc="## **bold**" />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(editor, { key: "0" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(content(container)).toBe("old");
  });

  it("deletes a visible character, never a hidden mark", () => {
    const { container } = render(<Editor initialDoc="## Notes" />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    // `0` goes to the real column zero, which sits inside the hidden `##`.
    // Without the nudge, `x` deletes a hash nobody can see.
    fireEvent.keyDown(editor, { key: "0" });
    fireEvent.keyDown(editor, { key: "x" });

    expect(content(container)).toBe("otes");
  });

  it("leaves other lines rendered while one is revealed", async () => {
    const { container } = render(<Editor initialDoc={"## One\n\n## Two"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toContain("## One"));
    expect(content(container)).not.toContain("## Two");
  });
  it("leaves a note's frontmatter on screen instead of reading it as markdown", () => {
    // Without a parser for the block, the opening fence is a horizontal rule
    // and the closing one underlines the fields above it into a heading: every
    // note in the vault would open on three lines of dates drawn as a title.
    const { container } = render(<Editor initialDoc={"---\nid: 1\n---\n# Notes"} />);

    expect(content(container)).toBe("---id: 1---Notes");
  });
});
