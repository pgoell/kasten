import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { toggleVim } from "@/lib/vim-setting";
import { deleteCurrentLine } from "./editor-fixture";
import { finishParsing } from "./parsing";

describe("Editor following a link with an alias or a heading", () => {
  // The whole target, heading and alias and all: the route is what splits it,
  // and a heading cut off here could never be jumped to.
  const DOC = "see [[borges#Life|Jorge]] now";
  const TARGET = "borges#Life|Jorge";

  afterEach(() => localStorage.clear());

  it("hands the whole target on gf", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} onFollow={onFollow} />);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "w" });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });

    expect(onFollow).toHaveBeenCalledWith(TARGET);
  });

  it("hands the whole target on ctrl+click on the alias, vim on or off", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} onFollow={onFollow} />);
    finishParsing(container);
    const alias = () => container.querySelector(".cm-wikilink") as HTMLElement;

    expect(alias().textContent).toBe("Jorge");
    fireEvent.mouseDown(alias(), { ctrlKey: true });
    act(() => toggleVim());
    fireEvent.mouseDown(alias(), { ctrlKey: true });

    expect(onFollow.mock.calls).toEqual([[TARGET], [TARGET]]);
  });

  it("jumps to a heading of its own note itself, on gf and on ctrl+click", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <Editor initialDoc={"[[#Below]]\ntext\n## Below\nend"} onFollow={onFollow} />,
    );
    finishParsing(container);
    const content = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "f" });
    expect(onFollow).not.toHaveBeenCalled();
    // The brackets are hidden, so the link reads as its target.
    expect(deleteCurrentLine(container)).toBe("#Belowtextend");

    fireEvent.keyDown(content, { key: "u" });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.keyDown(content, { key: "g" });
    fireEvent.mouseDown(container.querySelector(".cm-wikilink") as HTMLElement, { ctrlKey: true });
    expect(onFollow).not.toHaveBeenCalled();
    expect(deleteCurrentLine(container)).toBe("#Belowtextend");
  });

  it("hands the whole target on a tap on the alias", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc={`intro\n\n${DOC}`} onFollow={onFollow} />);
    finishParsing(container);
    const alias = container.querySelector(".cm-wikilink") as HTMLElement;

    expect(alias.textContent).toBe("Jorge");
    fireEvent.pointerDown(alias, { pointerType: "touch" });
    fireEvent.click(alias);

    expect(onFollow).toHaveBeenCalledWith(TARGET);
  });
});
