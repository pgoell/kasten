import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { runExCommand } from "./editor-fixture";
import { content, cursorTo, DOC, saveWithCtrlS, typeAt, viewIn } from "./table-lineup-fixture";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

const HEAD = "| a   | longer |";
const RULE = "| --- | ------ |";

describe("the table line-up takes what a paste, a yank or a rebuilt table changes", () => {
  it("#792 R8 a row pasted under a table is lined up on save", () => {
    localStorage.setItem("kasten.vim", "off");
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    // The blank line under the last row: a row pasted there joins the table.
    const blank = DOC.indexOf("\n\nafter") + 1;
    act(() =>
      view.dispatch({
        changes: { from: blank, insert: "| yyy | z |" },
        userEvent: "input.paste",
      }),
    );
    saveWithCtrlS(container);

    expect(onSave).toHaveBeenCalledWith(
      [HEAD, RULE, "| xx  | b      |", "| yyy | z      |", "after"].join("\n"),
    );
  });

  it("#792 R8 yyp on the last row lines the table up on leave", () => {
    localStorage.setItem("kasten.vim", "on");
    const { container } = render(<Editor initialDoc={DOC} preview={false} />);
    const view = viewIn(container);

    cursorTo(view, DOC.indexOf("| xx | b |") + 2);
    fireEvent.keyDown(content(container), { key: "y" });
    fireEvent.keyDown(content(container), { key: "y" });
    fireEvent.keyDown(content(container), { key: "p" });
    cursorTo(view, view.state.doc.length);

    expect(view.state.doc.toString()).toBe(
      [HEAD, RULE, "| xx  | b      |", "| xx  | b      |", "", "after"].join("\n"),
    );
  });

  it("#792 R8 a table made invalid and valid again by typing is lined up on leave", () => {
    localStorage.setItem("kasten.vim", "off");
    const { container } = render(<Editor initialDoc={DOC} preview={false} />);
    const view = viewIn(container);

    // A third head cell, which the dashes do not match yet: the tree refuses the table.
    typeAt(view, DOC.indexOf("| a | longer |") + "| a | longer |".length, " x |");
    cursorTo(view, view.state.doc.length);
    // The dashes catch up, and the reader leaves the table again.
    const rule = view.state.doc.toString().indexOf("| - | - |") + "| - | - |".length;
    typeAt(view, rule, " - |");
    cursorTo(view, view.state.doc.length);

    expect(view.state.doc.toString()).toBe(
      [
        "| a   | longer | x   |",
        "| --- | ------ | --- |",
        "| xx  | b      |     |",
        "",
        "after",
      ].join("\n"),
    );
  });

  it("#792 R8 x on the head's first pipe still lines the table up", () => {
    localStorage.setItem("kasten.vim", "on");
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    typeAt(view, DOC.indexOf("b |") + 1, "c");
    // `x` on the head's leading pipe: the table loses a wall, not its place.
    cursorTo(view, 0);
    fireEvent.keyDown(content(container), { key: "x" });
    cursorTo(view, view.state.doc.length);
    runExCommand(container, "w");

    // The head's own indent is worn by every line, as alignTable does for any table.
    expect(onSave).toHaveBeenCalledWith(
      [" | a   | longer |", " | --- | ------ |", " | xx  | bc     |", "", "after"].join("\n"),
    );
  });

  it("#792 R8 two edited tables lined up on save leave no mark", () => {
    localStorage.setItem("kasten.vim", "off");
    const first = "| a | longer |\n| - | - |\n| xx | b |";
    const second = "| p | longer |\n| - | - |\n| yy | q |";
    const source = `${first}\n\n${second}\n\nafter`;
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={source} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    // Two typings with no move of the cursor, so both tables are still edited at save.
    act(() =>
      view.dispatch({
        changes: { from: source.indexOf("b |") + 1, insert: "c" },
        userEvent: "input.type",
      }),
    );
    act(() =>
      view.dispatch({
        changes: { from: view.state.doc.toString().indexOf("q |") + 1, insert: "c" },
        userEvent: "input.type",
      }),
    );
    saveWithCtrlS(container);
    expect(onSave).toHaveBeenLastCalledWith(
      [
        "| a   | longer |",
        RULE,
        "| xx  | bc     |",
        "",
        "| p   | longer |",
        RULE,
        "| yy  | qc     |",
        "",
        "after",
      ].join("\n"),
    );

    // Undo takes out the line-up of both, and the second table is then left alone.
    fireEvent.keyDown(content(container), { key: "z", ctrlKey: true });
    cursorTo(view, view.state.doc.toString().indexOf("yy"));
    cursorTo(view, view.state.doc.length);
    saveWithCtrlS(container);

    expect(onSave).toHaveBeenLastCalledWith(
      source.replace("| xx | b |", "| xx | bc |").replace("| yy | q |", "| yy | qc |"),
    );
  });
});
