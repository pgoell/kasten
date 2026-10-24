import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import {
  content,
  cursorTo,
  DOC,
  LINED,
  saveWithCtrlS,
  TYPED,
  typeAt,
  viewIn,
} from "./table-lineup-fixture";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("the table line-up takes only what the reader typed into", () => {
  it("#792 R1 Enter at the end of the last row does not line up the table", () => {
    localStorage.setItem("kasten.vim", "off");
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    // The Enter lands at the end of the last row: a new line, the table left as it is.
    const end = DOC.indexOf("| xx | b |") + "| xx | b |".length;
    act(() =>
      view.dispatch({
        changes: { from: end, insert: "\n" },
        selection: { anchor: end + 1 },
        userEvent: "input",
      }),
    );
    saveWithCtrlS(container);

    expect(onSave).toHaveBeenCalledWith(DOC.replace("| xx | b |", "| xx | b |\n"));
  });

  it("#792 R1 o at the end of the last row and dd above the head do not line up the table", () => {
    localStorage.setItem("kasten.vim", "on");
    const source = ["above", "| a | longer |", "| - | - |", "| xx | b |", "", "after"].join("\n");
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={source} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    cursorTo(view, source.indexOf("| xx | b |") + 2);
    fireEvent.keyDown(content(container), { key: "o" });
    fireEvent.keyDown(content(container), { key: "Escape" });
    cursorTo(view, 0);
    fireEvent.keyDown(content(container), { key: "d" });
    fireEvent.keyDown(content(container), { key: "d" });
    saveWithCtrlS(container);

    expect(onSave).toHaveBeenCalledWith(
      source.replace("above\n", "").replace("| xx | b |", "| xx | b |\n"),
    );
  });

  it("#792 R2 deleting one table does not line up the next", () => {
    localStorage.setItem("kasten.vim", "off");
    const first = "| a | b |\n| - | - |\n| c | d |\n\n";
    const second = "| e | longer |\n| - | - |\n| xx | y |\n\nafter";
    const onSave = vi.fn();
    const { container } = render(
      <Editor initialDoc={first + second} preview={false} onSave={onSave} />,
    );
    const view = viewIn(container);

    // What `dap` does to the first table and the blank line under it.
    act(() =>
      view.dispatch({
        changes: { from: 0, to: first.length },
        selection: { anchor: 0 },
        userEvent: "delete",
      }),
    );
    saveWithCtrlS(container);

    expect(onSave).toHaveBeenCalledWith(second);
  });

  it("#792 R3 type, u, leave keeps the table byte-identical", () => {
    localStorage.setItem("kasten.vim", "on");
    const { container } = render(<Editor initialDoc={DOC} preview={false} />);
    const view = viewIn(container);

    typeAt(view, DOC.indexOf("b |") + 1, "c");
    fireEvent.keyDown(content(container), { key: "u" });
    expect(view.state.doc.toString()).toBe(DOC);
    cursorTo(view, DOC.indexOf("xx"));
    cursorTo(view, DOC.length);

    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("#792 R3 leave by arrow key, ctrl+z, then save keeps the ragged table", () => {
    localStorage.setItem("kasten.vim", "off");
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    typeAt(view, DOC.indexOf("b |") + 1, "c");
    // The arrow key's move out of the table, which carries the reader's user event.
    act(() => view.dispatch({ selection: { anchor: DOC.length }, userEvent: "select" }));
    expect(view.state.doc.toString()).toBe(LINED);
    fireEvent.keyDown(content(container), { key: "z", ctrlKey: true });
    expect(view.state.doc.toString()).toBe(TYPED);
    saveWithCtrlS(container);

    expect(onSave).toHaveBeenCalledWith(TYPED);
  });

  it("#792 R4 a list line with a pipe under a table is left as it is", () => {
    localStorage.setItem("kasten.vim", "off");
    const source = ["| a | longer |", "| - | - |", "| xx | b |", "- note | x", "", "after"].join(
      "\n",
    );
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={source} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    typeAt(view, source.indexOf("b |") + 1, "c");
    cursorTo(view, source.length);
    saveWithCtrlS(container);

    expect(onSave).toHaveBeenCalledWith(
      ["| a   | longer |", "| --- | ------ |", "| xx  | bc     |", "- note | x", "", "after"].join(
        "\n",
      ),
    );
  });
});
