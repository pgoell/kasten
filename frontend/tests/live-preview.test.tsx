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

  it("leaves other lines rendered while one is revealed", () => {
    const { container } = render(<Editor initialDoc={"## One\n\n## Two"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    expect(content(container)).toContain("## One");
    expect(content(container)).not.toContain("## Two");
  });
});
