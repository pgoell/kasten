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
});
