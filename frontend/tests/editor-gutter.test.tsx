import { render } from "@testing-library/react";
import { Editor } from "@/components/editor";

describe("Editor gutter", () => {
  const DOC = "one\ntwo\nthree\nfour";

  /**
   * What the gutter shows, top to bottom.
   *
   * The first element is the spacer holding the column open, hidden rather
   * than a line of the note, so it is dropped.
   */
  function gutter(container: HTMLElement) {
    return [...container.querySelectorAll<HTMLElement>(".cm-lineNumbers .cm-gutterElement")]
      .filter((n) => n.style.visibility !== "hidden")
      .map((n) => n.textContent ?? "");
  }

  it("counts the distance from the cursor, and names the line it sits on", () => {
    const { container } = render(<Editor initialDoc={DOC} startLine={2} />);

    expect(gutter(container)).toEqual(["1", "2", "1", "2"]);
  });

  it("counts from the top when the cursor sits on the first line", () => {
    const { container } = render(<Editor initialDoc={DOC} />);

    expect(gutter(container)).toEqual(["1", "1", "2", "3"]);
  });

  it("recounts when the cursor moves", () => {
    const { container, rerender } = render(<Editor initialDoc={DOC} startLine={2} />);

    rerender(<Editor initialDoc={DOC} startLine={4} />);

    expect(gutter(container)).toEqual(["3", "2", "1", "4"]);
  });
});
