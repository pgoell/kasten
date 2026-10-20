import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";

function viewIn(container: HTMLElement): EditorView {
  return EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView;
}

function press(container: HTMLElement, key: string): void {
  const content = container.querySelector(".cm-content") as HTMLElement;
  fireEvent.keyDown(content, key === "Enter" ? { key, keyCode: 13 } : { key });
}

/** Delete the cursor's line with `dd` and read back what is left, as `editor-fixture.tsx` does. */
function deleteCurrentLine(container: HTMLElement): string | null {
  press(container, "d");
  press(container, "d");
  return (container.querySelector(".cm-content") as HTMLElement).textContent;
}

/**
 * How far the parse has reached. A state keeps the tree it was made with, and
 * an empty transaction is what hands it the parse done since.
 */
function parsed(view: EditorView): number {
  act(() => view.dispatch({}));
  return syntaxTree(view.state).length;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("Enter off a link", () => {
  it("#638 A9 vim Enter on a prose line copies no whole note, and still moves down", () => {
    localStorage.setItem("kasten.vim", "on");
    const onOpenHighlight = vi.fn();
    const { container } = render(
      <Editor initialDoc={"plain words\n  second line"} onOpenHighlight={onOpenHighlight} />,
    );
    const { doc } = viewIn(container).state;
    const whole = vi.spyOn(doc, "toString");
    const slices = vi.spyOn(doc, "sliceString");

    press(container, "Enter");

    // Soft, so the motion below is checked on a build that does copy the note.
    expect.soft(whole).not.toHaveBeenCalled();
    const wholeSlices = slices.mock.calls.filter(
      ([from, to = doc.length]) => from === 0 && to >= doc.length,
    );
    expect.soft(wholeSlices).toEqual([]);
    expect(onOpenHighlight).not.toHaveBeenCalled();
    expect(deleteCurrentLine(container)).toBe("plain words");
  });

  it("#638 I7 vim Enter on a line holding no link does not wait on the parse of a large note", () => {
    localStorage.setItem("kasten.vim", "on");
    const onFollow = vi.fn();
    const filler = "A paragraph that the parser has to walk through.\n\n".repeat(200);
    const { container } = render(
      <Editor initialDoc={`see [[borges]]\n\n${filler}no link on this line`} onFollow={onFollow} />,
    );

    const view = viewIn(container);
    press(container, "G");
    const before = parsed(view);
    press(container, "Enter");

    // The background parse has not reached the end, and Enter left it there.
    expect(before).toBeLessThan(view.state.doc.length);
    expect.soft(parsed(view)).toBe(before);
    expect(onFollow).not.toHaveBeenCalled();
  });

  it("#638 I6 Enter with vim off breaks the line and follows nothing", () => {
    localStorage.setItem("kasten.vim", "off");
    const onFollow = vi.fn();
    const onChange = vi.fn();
    const { container } = render(
      <Editor initialDoc="see [[borges]] now" onFollow={onFollow} onChange={onChange} />,
    );
    const view = viewIn(container);
    act(() => view.dispatch({ selection: { anchor: "see [[bor".length } }));

    press(container, "Enter");

    expect(onFollow).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith("see [[bor\nges]] now");
  });
});
