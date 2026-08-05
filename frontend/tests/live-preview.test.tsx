import { fireEvent, render } from "@testing-library/react";
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

  it("reveals the cursor's line on entering insert mode", () => {
    const { container } = render(<Editor initialDoc={"## Notes\n\nplain"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    expect(content(container)).toContain("## Notes");
  });

  it("re-hides the marks on escape back to normal", () => {
    const { container } = render(<Editor initialDoc={"## Notes\n\nplain"} />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(editor, { key: "i" });
    fireEvent.keyDown(editor, { key: "Escape" });

    expect(content(container)).not.toContain("##");
  });

  it("renders inline emphasis with the marks hidden", () => {
    const { container } = render(
      <Editor initialDoc="**bold** and *italic* and `code` and ~~gone~~" />,
    );

    expect(content(container)).toBe("bold and italic and code and gone");
  });

  it("reveals inline marks on the cursor's line in insert mode", () => {
    const { container } = render(<Editor initialDoc="**bold**" />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    expect(content(container)).toBe("**bold**");
  });

  it("reveals inline marks in visual mode", () => {
    const { container } = render(<Editor initialDoc="**bold**" />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "v" });

    expect(content(container)).toBe("**bold**");
  });

  it("renders a link as its text alone", () => {
    const { container } = render(<Editor initialDoc="see [the docs](https://example.com) now" />);

    expect(content(container)).toBe("see the docs now");
  });

  it("reveals the whole link on the cursor's line in insert mode", () => {
    const { container } = render(<Editor initialDoc="see [the docs](https://example.com) now" />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    expect(content(container)).toBe("see [the docs](https://example.com) now");
  });

  it("renders blockquotes and list bullets", () => {
    const { container } = render(<Editor initialDoc={"> quoted\n\n- first\n- second"} />);

    expect(content(container)).toBe("quotedfirstsecond");
  });

  it("leaves tables and code fences untouched", () => {
    // The boundary of what this feature covers. Both need widget decorations,
    // which is a mechanism live preview deliberately does not have yet.
    const lines = ["```js", "const x = 1;", "```", "| a | b |", "| - | - |", "| 1 | 2 |"];
    const { container } = render(<Editor initialDoc={lines.join("\n")} />);

    expect(content(container)).toBe(lines.join(""));
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

  it("leaves other lines rendered while one is revealed", () => {
    const { container } = render(<Editor initialDoc={"## One\n\n## Two"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    expect(content(container)).toContain("## One");
    expect(content(container)).not.toContain("## Two");
  });
});
