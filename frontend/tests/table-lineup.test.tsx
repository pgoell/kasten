import { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { takeVaultText } from "@/lib/buffer-writes";
import { runExCommand } from "./editor-fixture";

/** A table with a short cell in its last row, and a line after it for the cursor to go to. */
const DOC = ["| a | longer |", "| - | - |", "| xx | b |", "", "after"].join("\n");
/** DOC with `c` typed after the `b`, the table not yet lined up. */
const TYPED = DOC.replace("| xx | b |", "| xx | bc |");
/** TYPED lined up, which is what the line-up writes. */
const LINED = ["| a   | longer |", "| --- | ------ |", "| xx  | bc     |", "", "after"].join("\n");

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

function viewIn(container: HTMLElement): EditorView {
  return EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView;
}

function content(container: HTMLElement): HTMLElement {
  return container.querySelector(".cm-content") as HTMLElement;
}

/** Puts the cursor where a click or a motion would. */
function cursorTo(view: EditorView, at: number): void {
  act(() => view.dispatch({ selection: { anchor: at } }));
}

/** Types `text` at `at` as the keyboard does, and leaves the cursor after it. */
function typeAt(view: EditorView, at: number, text: string): void {
  act(() =>
    view.dispatch({
      changes: { from: at, insert: text },
      selection: { anchor: at + text.length },
      userEvent: "input.type",
    }),
  );
}

/** Ctrl+s, which is the save key with vim on or off. */
function saveWithCtrlS(container: HTMLElement): void {
  fireEvent.keyDown(content(container), { key: "s", ctrlKey: true });
}

describe("the table line-up on save", () => {
  it("#792 A9 an edited table is lined up when the cursor leaves it", () => {
    localStorage.setItem("kasten.vim", "off");
    const { container } = render(<Editor initialDoc={DOC} preview={false} />);
    const view = viewIn(container);

    typeAt(view, DOC.indexOf("b |") + 1, "c");
    expect(view.state.doc.toString()).toBe(TYPED);
    cursorTo(view, DOC.length);

    expect(view.state.doc.toString()).toBe(LINED);
  });

  it("#792 A9 saving with ctrl+s lines up an edited table, the one under the cursor too", () => {
    localStorage.setItem("kasten.vim", "off");
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    typeAt(view, DOC.indexOf("b |") + 1, "c");
    saveWithCtrlS(container);

    expect(onSave).toHaveBeenCalledWith(LINED);
  });

  it("#792 A9 saving with :w lines up an edited table", () => {
    localStorage.setItem("kasten.vim", "on");
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    typeAt(view, DOC.indexOf("b |") + 1, "c");
    runExCommand(container, "w");

    expect(onSave).toHaveBeenCalledWith(LINED);
  });

  it("#792 A9 cells, escapes, dash colons, CJK and emoji survive the line-up byte for byte apart from padding", () => {
    localStorage.setItem("kasten.vim", "off");
    const source = [
      "| name | note | code | mark |",
      "| :-- | :-: | --: | --- |",
      "| 中文 | a \\| b | `x \\| y` | 🎉 |",
      "| k | v | w | |",
    ].join("\n");
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={source} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    typeAt(view, source.indexOf("| k |") + 3, "z");
    cursorTo(view, source.length);
    saveWithCtrlS(container);

    const saved = onSave.mock.calls[0]?.[0] as string;
    const lines = saved.split("\n");
    // Every line the same width, counted in code points as the line-up counts.
    expect(new Set(lines.map((line) => [...line].length)).size).toBe(1);
    // The cells, trimmed, are what they were, with the one typed into changed.
    // The dashes are stretched to the column, so only their run length moves.
    const dashes = (line: string) => cellsOf(line).map((cell) => cell.replace(/-+/g, "-"));
    expect(lines.map(dashes)).toEqual([
      ["name", "note", "code", "mark"],
      [":-", ":-:", "-:", "-"],
      ["中文", "a \\| b", "`x \\| y`", "🎉"],
      ["kz", "v", "w", ""],
    ]);
    // Apart from the padding and the dashes' run, the bytes are the bytes typed.
    const bare = (text: string) => text.replace(/ /g, "").replace(/-+/g, "-");
    expect(bare(saved)).toBe(bare(source.replace("| k |", "| kz |")));
  });

  it("#792 A9 a ragged table the reader did not edit stays byte-identical in the same note", () => {
    localStorage.setItem("kasten.vim", "off");
    const second = "| p | q |\n| - | - |\n| r | longerone |";
    const source = `${DOC}\n\n${second}`;
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={source} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    typeAt(view, source.indexOf("b |") + 1, "c");
    cursorTo(view, source.indexOf("p | q") + 1);
    saveWithCtrlS(container);

    const saved = onSave.mock.calls[0]?.[0] as string;
    expect(saved.startsWith(LINED)).toBe(true);
    expect(saved.endsWith(`\n\n${second}`)).toBe(true);
  });

  it("#792 A9 a note opened with a ragged table and saved without an edit is written byte-identical", () => {
    localStorage.setItem("kasten.vim", "off");
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    cursorTo(view, 0);
    cursorTo(view, DOC.length);
    saveWithCtrlS(container);

    expect(onSave).toHaveBeenCalledWith(DOC);
  });
});

/** The trimmed cells of one row, split on the walls a backslash does not escape. */
function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

describe("the table line-up leaves what it cannot read safely", () => {
  it("#792 I1 a pipe table inside a code fence is never lined up", () => {
    localStorage.setItem("kasten.vim", "on");
    const source = "```\n| a | longer |\n| - | - |\n| xx | b |\n```\n\nafter";
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={source} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    typeAt(view, source.indexOf("b |") + 1, "c");
    cursorTo(view, source.length);
    runExCommand(container, "w");

    expect(onSave).toHaveBeenCalledWith(source.replace("| xx | b |", "| xx | bc |"));
  });

  it("#792 I1 a pipe table inside a block quote is never lined up", () => {
    localStorage.setItem("kasten.vim", "on");
    const source = "> | a | longer |\n> | - | - |\n> | xx | b |\n\nafter";
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={source} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    typeAt(view, source.indexOf("b |") + 1, "c");
    cursorTo(view, source.length);
    runExCommand(container, "w");

    expect(onSave).toHaveBeenCalledWith(source.replace("| xx | b |", "| xx | bc |"));
  });

  it("#792 I1 a pipe table inside a list item is never lined up", () => {
    localStorage.setItem("kasten.vim", "on");
    const source = "- item\n\n  | a | longer |\n  | - | - |\n  | xx | b |\n\nafter";
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={source} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    typeAt(view, source.indexOf("b |") + 1, "c");
    cursorTo(view, source.length);
    runExCommand(container, "w");

    expect(onSave).toHaveBeenCalledWith(source.replace("| xx | b |", "| xx | bc |"));
  });

  it("#792 I1 a run of pipes with no row of dashes is never lined up", () => {
    localStorage.setItem("kasten.vim", "on");
    const source = "a | longer\nxx | b\n\nafter";
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={source} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    typeAt(view, source.indexOf("b") + 1, "c");
    cursorTo(view, source.length);
    runExCommand(container, "w");

    expect(onSave).toHaveBeenCalledWith("a | longer\nxx | bc\n\nafter");
  });
});

describe("the table line-up's undo", () => {
  it("#792 I2 the line-up is its own undo step, with vim on", () => {
    localStorage.setItem("kasten.vim", "on");
    const { container } = render(<Editor initialDoc={DOC} preview={false} />);
    const view = viewIn(container);

    typeAt(view, DOC.indexOf("b |") + 1, "c");
    cursorTo(view, DOC.length);
    expect(view.state.doc.toString()).toBe(LINED);

    // The first `u` takes the line-up out and keeps what was typed.
    fireEvent.keyDown(content(container), { key: "u" });
    expect(view.state.doc.toString()).toBe(TYPED);
    // The second takes the typing out.
    fireEvent.keyDown(content(container), { key: "u" });
    expect(view.state.doc.toString()).toBe(DOC);

    // Redo replays the typing, then the line-up.
    fireEvent.keyDown(content(container), { key: "r", ctrlKey: true });
    expect(view.state.doc.toString()).toBe(TYPED);
    fireEvent.keyDown(content(container), { key: "r", ctrlKey: true });
    expect(view.state.doc.toString()).toBe(LINED);
  });

  it("#792 I2 the line-up is its own undo step, with vim off", () => {
    localStorage.setItem("kasten.vim", "off");
    const { container } = render(<Editor initialDoc={DOC} preview={false} />);
    const view = viewIn(container);

    typeAt(view, DOC.indexOf("b |") + 1, "c");
    cursorTo(view, DOC.length);
    expect(view.state.doc.toString()).toBe(LINED);

    fireEvent.keyDown(content(container), { key: "z", ctrlKey: true });
    expect(view.state.doc.toString()).toBe(TYPED);
    fireEvent.keyDown(content(container), { key: "z", ctrlKey: true });
    expect(view.state.doc.toString()).toBe(DOC);

    // Redo is ctrl+y on Linux, which basicSetup's history keymap binds beside ctrl+shift+z.
    fireEvent.keyDown(content(container), { key: "y", ctrlKey: true });
    expect(view.state.doc.toString()).toBe(TYPED);
    fireEvent.keyDown(content(container), { key: "y", ctrlKey: true });
    expect(view.state.doc.toString()).toBe(LINED);
  });
});

describe("the table line-up keeps the cursor and skips what is square", () => {
  it("#792 I3 a line-up on save keeps the cursor on the same character in its cell", () => {
    localStorage.setItem("kasten.vim", "off");
    const source = "| name | x |\n| - | - |\n| a | longer |\n\nafter";
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={source} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    // Just after the `a` of the short cell, which is the cell the line-up widens.
    typeAt(view, source.indexOf("| a |") + 3, "q");
    saveWithCtrlS(container);

    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    // The cursor is still right after the typed `q`, in the cell it was typed into.
    expect(line.text.slice(0, head - line.from)).toBe("| aq");
    expect(onSave).toHaveBeenCalledWith(expect.stringContaining("| aq"));
  });

  it("#792 I3 a table already square is not rewritten when the cursor leaves it or on save", () => {
    localStorage.setItem("kasten.vim", "off");
    const square = "| a   | longer |\n| --- | ------ |\n| c   | d      |\n\nafter";
    const onChange = vi.fn();
    const onSave = vi.fn();
    const { container } = render(
      <Editor initialDoc={square} preview={false} onChange={onChange} onSave={onSave} />,
    );
    const view = viewIn(container);

    // The space after the `c` is typed over, so the cell is still as wide as the column.
    const at = square.indexOf("| c") + 3;
    act(() =>
      view.dispatch({
        changes: { from: at, to: at + 1, insert: "x" },
        userEvent: "input.type",
      }),
    );
    cursorTo(view, square.length);
    saveWithCtrlS(container);

    const typed = square.replace("| c   |", "| cx  |");
    // One change, the typing: the line-up wrote nothing.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(typed);
  });
});

describe("what is not the reader's typing is never lined up", () => {
  it("#792 I4 a reload from disk never marks a table as edited", () => {
    localStorage.setItem("kasten.vim", "off");
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} preview={false} onSave={onSave} />);
    const view = viewIn(container);
    const reloaded = DOC.replace("| xx | b |", "| xx | bq |");

    takeVaultText(view, reloaded);
    cursorTo(view, 0);
    cursorTo(view, reloaded.length);
    saveWithCtrlS(container);

    expect(onSave).toHaveBeenCalledWith(reloaded);
  });

  it("#792 I4 a change from another pane never marks a table as edited", () => {
    localStorage.setItem("kasten.vim", "off");
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    // The way a held note reaches an unfocused pane: no user event, off the undo stack.
    act(() =>
      view.dispatch({
        changes: { from: DOC.indexOf("b |") + 1, insert: "c" },
        annotations: Transaction.addToHistory.of(false),
      }),
    );
    cursorTo(view, 0);
    cursorTo(view, DOC.length);
    saveWithCtrlS(container);

    expect(onSave).toHaveBeenCalledWith(TYPED);
  });
});

describe("the table line-up in Read", () => {
  it("#792 I6 in Read, the cursor's row is marked, and the line-up on leaving still runs", () => {
    localStorage.setItem("kasten.vim", "off");
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={DOC} onSave={onSave} />);
    const view = viewIn(container);

    // The cursor starts in the table, so its source is what is drawn.
    expect(container.querySelector(".cm-table-cursor")?.textContent).toBe("| a | longer |");

    typeAt(view, DOC.indexOf("b |") + 1, "c");
    expect(container.querySelector(".cm-table-cursor")?.textContent).toBe("| xx | bc |");

    cursorTo(view, DOC.length);
    saveWithCtrlS(container);
    expect(onSave).toHaveBeenCalledWith(LINED);
  });
});

describe("a row that is not as wide as the head", () => {
  it("#792 I8 a row with fewer or more cells than the head keeps every cell through the line-up", () => {
    localStorage.setItem("kasten.vim", "off");
    const source = "| a | b | c |\n| - | - | - |\n| 1 |\n| x | y | z | w |\n\nafter";
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc={source} preview={false} onSave={onSave} />);
    const view = viewIn(container);

    typeAt(view, source.indexOf("| 1 |") + 3, "q");
    cursorTo(view, source.length);
    saveWithCtrlS(container);

    expect(onSave).toHaveBeenCalledWith(
      [
        "| a   | b   | c   |     |",
        "| --- | --- | --- | --- |",
        "| 1q  |     |     |     |",
        "| x   | y   | z   | w   |",
        "",
        "after",
      ].join("\n"),
    );
  });
});
