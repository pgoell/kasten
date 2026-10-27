import type { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { setPreview } from "@/lib/editor/note-view";
import { deleteCurrentLine } from "./editor-fixture";

const DOC = ["| a | longer |", "| - | - |", "| xx | b |", "", "after"].join("\n");

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

function viewIn(container: HTMLElement): EditorView {
  return EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView;
}

function content(container: HTMLElement): HTMLElement {
  return container.querySelector(".cm-content") as HTMLElement;
}

function cursorTo(view: EditorView, at: number): void {
  act(() => view.dispatch({ selection: { anchor: at } }));
}

/** The line the one class names, read back as the text on it. */
function linesWith(container: HTMLElement, name: string): string[] {
  return [...container.querySelectorAll(`.cm-line.${name}`)].map((line) => line.textContent ?? "");
}

describe("the table's source in Edit", () => {
  it("#792 A8 Edit with vim on marks a table's source, its head and the cursor's row", () => {
    localStorage.setItem("kasten.vim", "on");
    const { container } = render(<Editor initialDoc={DOC} preview={false} />);
    const view = viewIn(container);

    // The three lines of the table are marked, and the paragraph after them is not.
    expect(linesWith(container, "cm-table")).toEqual(["| a | longer |", "| - | - |", "| xx | b |"]);
    expect(linesWith(container, "cm-table-head")).toEqual(["| a | longer |"]);
    // The cursor starts on the head, so that row is the one marked as the cursor's.
    expect(linesWith(container, "cm-table-cursor")).toEqual(["| a | longer |"]);

    cursorTo(view, DOC.indexOf("xx"));
    expect(linesWith(container, "cm-table-cursor")).toEqual(["| xx | b |"]);
    // An untouched ragged table is drawn as it was written, which is what Edit shows.
    expect(content(container).textContent).toContain("| xx | b |");
  });

  it("#792 A8 Edit with vim off marks the source, and typing and undo work in it", () => {
    localStorage.setItem("kasten.vim", "off");
    const { container } = render(<Editor initialDoc={DOC} preview={false} />);
    const view = viewIn(container);

    expect(linesWith(container, "cm-table")).toHaveLength(3);
    act(() =>
      view.dispatch({
        changes: { from: DOC.indexOf("b |") + 1, insert: "c" },
        selection: { anchor: DOC.indexOf("b |") + 2 },
        userEvent: "input.type",
      }),
    );
    expect(view.state.doc.toString()).toContain("| xx | bc |");
    // The table is still a table after the edit, so its lines are still marked.
    expect(linesWith(container, "cm-table")).toHaveLength(3);

    fireEvent.keyDown(content(container), { key: "z", ctrlKey: true });
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("#792 A8 Edit with vim on, the normal keys work in a table", () => {
    localStorage.setItem("kasten.vim", "on");
    const { container } = render(<Editor initialDoc={DOC} preview={false} />);
    const view = viewIn(container);

    cursorTo(view, DOC.indexOf("xx"));
    deleteCurrentLine(container);

    expect(view.state.doc.toString()).not.toContain("| xx");
    expect(linesWith(container, "cm-table")).toEqual(["| a | longer |", "| - | - |"]);
  });
});

describe("going back to Read", () => {
  it("#792 A10 going back to Read puts the scroll snapshot in the reconfigure's transaction", () => {
    localStorage.setItem("kasten.vim", "off");
    const { container } = render(<Editor initialDoc={DOC} preview={false} />);
    const view = viewIn(container);

    // The snapshot is the one the view hands out, so the test can find it in the spec.
    const snapshot = view.scrollSnapshot();
    vi.spyOn(view, "scrollSnapshot").mockReturnValue(snapshot);
    const dispatch = vi.spyOn(view, "dispatch");

    setPreview(view, true);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const spec = dispatch.mock.calls[0]?.[0] as { effects: StateEffect<unknown>[] };
    expect(spec.effects).toHaveLength(2);
    expect(spec.effects[0]).toBe(snapshot);
  });
});
