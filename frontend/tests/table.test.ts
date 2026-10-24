import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { type ChangeSpec, EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { formatDocument } from "@/lib/format-commands";
import { alignTable, lineUpChanges, moveCell, type TableRun, tableAt } from "@/lib/table";

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
});

describe("tableAt", () => {
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
