import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { type ChangeSpec, EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { formatDocument } from "@/lib/editor/format-commands";
import { alignTable, lineUpChanges, moveCell, type TableRun, tableAt } from "@/lib/editor/table";

/** The run around the given line, drawn back out, or null. */
function align(source: string, line = 1): string | null {
  const doc = Text.of(source.split("\n"));
  const run = tableAt(doc, line);
  return run === null ? null : alignTable(doc, run);
}

function open(doc: string, anchor: number) {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [markdown({ base: markdownLanguage })],
    }),
  });
}

/** The character under the cursor: a cell's first character is what a walk is checked by. */
function charAtCursor(view: EditorView): string {
  const { head } = view.state.selection.main;
  return view.state.doc.sliceString(head, head + 1);
}

describe("alignTable", () => {
  it("pads every column to its widest cell", () => {
    expect(align("| a | longer |\n| - | - |\n| xx | b |")).toBe(
      ["| a   | longer |", "| --- | ------ |", "| xx  | b      |"].join("\n"),
    );
  });

  it("writes the walls a row left out", () => {
    expect(align("a | b\n--- | ---\n1 | 2")).toBe(
      ["| a   | b   |", "| --- | --- |", "| 1   | 2   |"].join("\n"),
    );
  });

  it("keeps the alignment the dashes asked for, and obeys it", () => {
    expect(align("| left | mid | right |\n| :- | :-: | -: |\n| a | b | c |")).toBe(
      ["| left | mid | right |", "| :--- | :-: | ----: |", "| a    |  b  |     c |"].join("\n"),
    );
  });

  it("grows a column for a row wider than the dashes", () => {
    expect(align("| a |\n| --- |\n| b | c |")).toBe(
      ["| a   |     |", "| --- | --- |", "| b   | c   |"].join("\n"),
    );
  });

  it("keeps the indent the table opens with", () => {
    expect(align("  | a | b |\n  | - | - |")).toBe("  | a   | b   |\n  | --- | --- |");
  });

  it("leaves an escaped wall inside a cell alone", () => {
    expect(align("| a \\| b | c |\n| - | - |")).toBe("| a \\| b | c   |\n| ------ | --- |");
  });

  it("#792 R5 a cell's no-break and ideographic spaces survive a line-up", () => {
    expect(align("|  x　 | y |\n| - | - |\n| z | w |")).toBe(
      ["|  x　 | y   |", "| --- | --- |", "| z   | w   |"].join("\n"),
    );
  });
});

describe("tableAt", () => {
  it("#792 R8 a row of dashes with a no-break space is still a divider", () => {
    const doc = Text.of(["| a | b |", "|  - | - |", "| 1 | 2 |"]);

    expect(tableAt(doc, 1)).toEqual({ first: 1, last: 3 });
  });

  it("finds the table from any line in it", () => {
    const doc = Text.of(["intro", "| a | b |", "| - | - |", "| 1 | 2 |", "after"]);

    expect(tableAt(doc, 2)).toEqual({ first: 2, last: 4 });
    expect(tableAt(doc, 4)).toEqual({ first: 2, last: 4 });
  });

  it("refuses a run of pipes with no dashes under the head", () => {
    expect(align("| a | b |\n| c | d |")).toBeNull();
  });

  it("leaves the prose above a table out of it", () => {
    const doc = Text.of(["one | two", "| a | b |", "| - | - |"]);

    expect(tableAt(doc, 1)).toBeNull();
    expect(tableAt(doc, 2)).toEqual({ first: 2, last: 3 });
  });
});

describe("moveCell", () => {
  const table = "| a | bb |\n| --- | --- |\n| 1 | 2 |";

  it("lines the table up and lands on the next cell", () => {
    const view = open(table, 2);

    expect(moveCell(view, 1)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      ["| a   | bb  |", "| --- | --- |", "| 1   | 2   |"].join("\n"),
    );
    // The head row's second cell, past `| a   | `.
    expect(view.state.selection.main.head).toBe(8);
  });

  it("steps over the dashes on its way into the body", () => {
    const view = open(table, 6);

    expect(moveCell(view, 1)).toBe(true);
    // The first cell of the row under the dashes.
    expect(view.state.selection.main.head).toBe(30);
  });

  it("walks back over the dashes too", () => {
    const view = open(table, 28);
    expect(moveCell(view, -1)).toBe(true);
    expect(view.state.selection.main.head).toBe(8);
  });

  it("writes a row when there is none to land in", () => {
    const view = open(table, 32);

    expect(moveCell(view, 1)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      ["| a   | bb  |", "| --- | --- |", "| 1   | 2   |", "|     |     |"].join("\n"),
    );
    expect(view.state.selection.main.head).toBe(44);
  });

  it("moves without editing when the table is already square", () => {
    const square = ["| a   | bb  |", "| --- | --- |", "| 1   | 2   |"].join("\n");
    const view = open(square, 2);

    moveCell(view, 1);

    expect(view.state.doc.toString()).toBe(square);
    // Nothing to undo: the press was a move, not an edit.
    expect(view.state.selection.main.head).toBe(8);
  });

  it("declines outside a table, and in the first cell going back", () => {
    expect(moveCell(open("plain text", 3), 1)).toBe(false);
    expect(moveCell(open(table, 2), -1)).toBe(false);
  });

  it("#921 A1 Tab from a walks to c on the row under an emoji row", () => {
    const view = open("| a | b |\n|---|---|\n| 😀 | x |\n| c | d |", 2);

    // From a: b, then the emoji cell, then x, then the first cell of the row under.
    for (let step = 0; step < 4; step++) expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("c");
  });

  it("#921 A2 Shift-Tab lands on the cell's first character below an emoji row", () => {
    const source = [
      "| a   | b   |",
      "| --- | --- |",
      "| 😀  | x   |",
      "| c   | d   |",
      "| e   | f   |",
    ].join("\n");
    const view = open(source, source.indexOf("| e") + 2);

    expect(moveCell(view, -1)).toBe(true);
    // Back across the row boundary, to the last cell of the row above.
    expect(charAtCursor(view)).toBe("d");
    expect(moveCell(view, -1)).toBe(true);
    expect(charAtCursor(view)).toBe("c");
  });

  it("#921 A3 a table Tab drew is one the line-up leaves alone", () => {
    const view = open("| a | b |\n|---|---|\n| 😀 | x |\n| c | d |", 2);

    moveCell(view, 1);

    const run = tableAt(view.state.doc, 1);
    expect(run).not.toBeNull();
    expect(lineUpChanges(view.state.doc, run as TableRun)).toEqual([]);
  });

  it("#921 I1 Tab within the emoji row lands on the next cell", () => {
    const source = "| a   | b   |\n| --- | --- |\n| 😀  | x   |\n| c   | d   |";
    const view = open(source, source.indexOf("😀"));

    expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("x");
  });

  it("#921 I2 offsets from several astral characters and a ZWJ sequence add up", () => {
    const source = [
      "| a   | 🎉  |",
      "| --- | --- |",
      "| 😀  | x   |",
      "| c   | 👩‍💻 |",
      "| k   | z   |",
    ].join("\n");
    const view = open(source, 2);

    // a, 🎉, 😀, x, c, the ZWJ cell: six presses reach the first cell of the last row.
    for (let step = 0; step < 6; step++) expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("k");
    expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("z");
  });

  it("#921 I3 CJK and combining marks rows land on the cell's first character", () => {
    const view = open("| 中文 | x |\n|---|---|\n| é | y |\n| k | z |", 2);

    expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("x");
    expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("e");
    expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("y");
  });

  it("#921 I4 Tab past the last row of an emoji table lands in the new row", () => {
    const source = "| a   | b   |\n| --- | --- |\n| 😀  | x   |";
    const view = open(source, source.indexOf("x"));

    expect(moveCell(view, 1)).toBe(true);
    const doc = view.state.doc;
    const line = doc.lineAt(view.state.selection.main.head);
    expect(line.number).toBe(doc.lines);
    expect(view.state.selection.main.head).toBe(line.from + 2);
  });

  it("#925 A1 Tab in a right-aligned column lands on the next cell's text", () => {
    const view = open("| a | b |\n|--:|--:|\n| xyz | q |", 2);

    expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("b");
  });

  it("#925 A2 Tab in a centered column lands on the next cell's text", () => {
    const view = open("| a | b |\n|:-:|:-:|\n| xyz | q |", 2);

    expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("b");
  });

  it("#925 A3 Shift-Tab into a right-aligned cell lands on its text", () => {
    const source = "| a | b |\n|--:|--:|\n| xyz | q |";
    const view = open(source, source.indexOf("b"));

    expect(moveCell(view, -1)).toBe(true);
    expect(charAtCursor(view)).toBe("a");
  });

  it("#925 A3 Shift-Tab into a centered cell lands on its text", () => {
    const source = "| a | b |\n|:-:|:-:|\n| xyz | q |";
    const view = open(source, source.indexOf("b"));

    expect(moveCell(view, -1)).toBe(true);
    expect(charAtCursor(view)).toBe("a");
  });

  it("#925 A4 Tab into an empty right-aligned cell lands at its start", () => {
    const view = open("| a | b |\n|--:|--:|\n|  | q |", 6);

    expect(moveCell(view, 1)).toBe(true);
    // The cell is all padding once drawn, so counting its spaces would land past it.
    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from + 2);
  });

  it("#925 A4 Tab into an empty centered cell lands at its start", () => {
    const view = open("| a | b |\n|:-:|:-:|\n|  | q |", 6);

    expect(moveCell(view, 1)).toBe(true);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).from + 2);
  });

  it("#925 A5 an emoji above the target in a right-aligned column, Tab lands on the text", () => {
    const view = open("| a | b |\n|--:|--:|\n| 😀 | x |\n| yz | q |", 2);

    // From a: b, then the emoji cell, then x, then the cell under it.
    for (let step = 0; step < 4; step++) expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("y");
  });

  it("#925 A5 an emoji above the target in a centered column, Tab lands on the text", () => {
    const view = open("| a | b |\n|:-:|:-:|\n| 😀 | x |\n| y | q |", 2);

    for (let step = 0; step < 4; step++) expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("y");
  });

  it("#925 A5 an emoji target in a right-aligned column, Tab lands on the emoji", () => {
    const view = open("| a | b |\n|--:|--:|\n| x | 😀 |", 2);

    for (let step = 0; step < 3; step++) expect(moveCell(view, 1)).toBe(true);
    const { head } = view.state.selection.main;
    expect(view.state.doc.sliceString(head, head + 2)).toBe("😀");
  });

  it("#925 A5 an emoji target in a centered column, Tab lands on the emoji", () => {
    const view = open("| a | b |\n|:-:|:-:|\n| x | 😀 |", 2);

    for (let step = 0; step < 3; step++) expect(moveCell(view, 1)).toBe(true);
    const { head } = view.state.selection.main;
    expect(view.state.doc.sliceString(head, head + 2)).toBe("😀");
  });

  it("#925 I1 Tab in a left-aligned or unaligned column lands on the text as before", () => {
    const view = open("| a | b |\n|:--|---|\n| xyz | q |", 2);

    expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("b");
    expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("x");
    expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe("q");
  });

  it("#925 I2 Tab past the last row of a right-aligned table writes a row and lands at its first cell", () => {
    const source = "| a | b |\n|--:|--:|\n| xyz | q |";
    const view = open(source, source.indexOf("q"));

    expect(moveCell(view, 1)).toBe(true);
    const doc = view.state.doc;
    expect(doc.line(4).text).toBe("|     |     |");
    expect(view.state.selection.main.head).toBe(doc.line(4).from + 2);
  });

  it("#925 I3 Tab into a right-aligned cell that starts with a no-break space lands on that space", () => {
    const view = open("| a | b |\n|--:|--:|\n|  x | q |", 2);

    expect(moveCell(view, 1)).toBe(true);
    expect(moveCell(view, 1)).toBe(true);
    expect(charAtCursor(view)).toBe(" ");
  });
});

describe("formatDocument", () => {
  it("lines up every table in the note and leaves the rest of it alone", () => {
    const view = open("# head\n\n| a | bb |\n| - | - |\n| ccc | d |\n\ntail  \n", 0);

    expect(formatDocument(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      ["# head", "", "| a   | bb  |", "| --- | --- |", "| ccc | d   |", "", "tail", ""].join("\n"),
    );
  });

  it("leaves a table inside a fence untouched", () => {
    const source = "```md\n| a | bb |\n| - | - |\n```\n";
    const view = open(source, 0);

    expect(formatDocument(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
  });
});

describe("lineUpChanges", () => {
  /** The table around line one, with the line-up's changes applied. */
  function lined(source: string): { state: EditorState; changes: ChangeSpec[] } {
    const state = EditorState.create({ doc: source });
    const run = tableAt(state.doc, 1);
    expect(run).not.toBeNull();
    const changes = lineUpChanges(state.doc, run as TableRun);
    return { state, changes };
  }

  it("#792 A9 lineUpChanges sets a ragged table to the lines alignTable draws", () => {
    const { state, changes } = lined("| a | longer |\n| - | - |\n| xx | b |");

    expect(state.update({ changes }).state.doc.toString()).toBe(
      ["| a   | longer |", "| --- | ------ |", "| xx  | b      |"].join("\n"),
    );
  });

  it("#792 A9 lineUpChanges only puts in or takes out spaces where only spaces differ", () => {
    const { state, changes } = lined("| ab| c|\n|---|---|\n| d | e |");

    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes as { from: number; to?: number; insert?: string }[]) {
      expect(state.doc.sliceString(change.from, change.to ?? change.from).trim()).toBe("");
      expect((change.insert ?? "").trim()).toBe("");
    }
  });

  it("#792 A9 lineUpChanges keeps a cell's escaped wall and the text around the change", () => {
    const source = "a \\| b | c\n| - | - |\n| d | e |";
    const { state, changes } = lined(source);

    expect(state.update({ changes }).state.doc.toString()).toContain("a \\| b");
    expect(state.update({ changes }).state.doc.toString()).toBe(
      ["| a \\| b | c   |", "| ------ | --- |", "| d      | e   |"].join("\n"),
    );
  });

  it("#792 A9 lineUpChanges gives no change to a table already square", () => {
    const { changes } = lined("| a   | bb  |\n| --- | --- |\n| ccc | d   |");

    expect(changes).toEqual([]);
  });
});
