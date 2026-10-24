import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import {
  type ChangeSpec,
  EditorState,
  type Extension,
  MapMode,
  StateEffect,
  StateField,
  type Text,
  Transaction,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { fromVault } from "@/lib/buffer-writes";
import { lineUpChanges, type TableRun, tableAt } from "@/lib/table";

/**
 * Tables the reader typed into, lined up once the reader is done with them.
 *
 * A table is lined up when the cursor leaves it and when the note is saved, not
 * on every keystroke: the padding would move under the cursor while typing. Only
 * the tables the reader's own edits touched are lined up, so a note that was
 * ragged when it opened is written as it was, and the other tables in it too.
 */

/** The user event the line-up's own edits carry, so they are not taken for typing. */
const LINE_UP = "format.table";

/** Takes a table's first line out of the set, once it has been lined up. */
const forget = StateEffect.define<number>();

/**
 * A table the reader typed into: the position of its first line, and its text as
 * it was before the typing.
 *
 * The text is how the line-up knows a table was changed and changed back. Undo,
 * or typing a character and deleting it again, leaves the table as it was, and
 * there is nothing to line up.
 */
interface Mark {
  at: number;
  before: string;
}

/** The text of a table's lines, as the document holds them. */
function textOf(doc: Text, run: TableRun): string {
  return doc.sliceString(doc.line(run.first).from, doc.line(run.last).to);
}

/**
 * The tables a change of the reader's touches, measured in the document before
 * it, with their first line mapped into the document after.
 *
 * A deletion or a replacement touches a table when it reaches into the table's
 * lines. An insertion touches one when it lands inside them, or on an edge without
 * making a line: an Enter at the end of the last row, or a line deleted just above
 * the head, leaves the table as it was.
 */
function touchedBy(
  tr: Transaction,
  fromA: number,
  toA: number,
  fromB: number,
  toB: number,
): Mark[] {
  const before = tr.startState;
  const inserted = tr.newDoc.sliceString(fromB, toB);
  const found: Mark[] = [];
  for (let n = before.doc.lineAt(fromA).number; n <= before.doc.lineAt(toA).number; n++) {
    const opened = tableAt(before.doc, n);
    if (opened === null) continue;
    const table = readable(before, before.doc.line(opened.first).from);
    if (table === null) continue;

    const { run } = table;
    const from = before.doc.line(run.first).from;
    const to = before.doc.line(run.last).to;
    const hit =
      fromA === toA
        ? (from < fromA && fromA < to) ||
          (fromA === from && !inserted.endsWith("\n")) ||
          (fromA === to && !inserted.startsWith("\n"))
        : fromA < to && toA > from;
    if (!hit) continue;

    // Deleted along with its first line, the table is gone and there is nothing to
    // mark: its position would otherwise map onto the table after it.
    if (fromA <= from && from < toA) continue;
    const at = tr.changes.mapPos(from, -1, MapMode.TrackDel);
    if (at !== null) found.push({ at, before: textOf(before.doc, run) });
  }
  return found;
}

/**
 * The marks whose first character the change deletes, by their position before
 * the change.
 *
 * `MapMode.TrackDel` does not report a deletion that starts on the position, so
 * a table cut out from its first line, a `dap` for one, is checked here.
 */
function lostIn(tr: Transaction, marks: Mark[]): Set<number> {
  const lost = new Set<number>();
  tr.changes.iterChangedRanges((fromA, toA) => {
    for (const mark of marks) {
      if (fromA <= mark.at && mark.at < toA) lost.add(mark.at);
    }
  });
  return lost;
}

/**
 * The tables the reader typed into, lined up once the reader is done with them.
 *
 * Each mark is mapped through every change and dropped when its first line is
 * deleted. A transaction that forgets a table does not mark it again.
 */
const edited = StateField.define<Mark[]>({
  create: () => [],
  update(marks, tr) {
    const forgotten = new Set<number>();
    for (const effect of tr.effects) {
      if (effect.is(forget)) forgotten.add(effect.value);
    }

    const lost = lostIn(tr, marks);
    let next: Mark[] = [];
    for (const mark of marks) {
      if (lost.has(mark.at)) continue;
      const at = tr.changes.mapPos(mark.at, -1, MapMode.TrackDel);
      if (at !== null && !forgotten.has(at)) next.push({ at, before: mark.before });
    }
    if (!isTyping(tr)) return next;

    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      for (const mark of touchedBy(tr, fromA, toA, fromB, toB)) {
        if (!forgotten.has(mark.at) && !next.some((each) => each.at === mark.at)) {
          next = [...next, mark];
        }
      }
    });
    return next;
  },
});

/**
 * Whether a transaction is the reader's own edit.
 *
 * Vim's edits carry no user event, so the history decides: the vault's text, a
 * held note put back and the watched stamp all say they stay off the undo stack,
 * which is also how none of them is ever typing. The line-up's own edit is
 * named by its user event.
 *
 * An undo or a redo is not typing either. Undoing the line-up puts the ragged
 * text back, and that text must stay ragged, or `u` could never keep it.
 */
function isTyping(tr: Transaction): boolean {
  return (
    tr.docChanged &&
    !tr.annotation(fromVault) &&
    tr.annotation(Transaction.addToHistory) !== false &&
    tr.annotation(Transaction.userEvent) !== LINE_UP &&
    !tr.isUserEvent("undo") &&
    !tr.isUserEvent("redo")
  );
}

/**
 * The run of the table that opens at `first`, when the syntax tree reads it as a
 * table of the note itself.
 *
 * A pipe line in a fence, a quote or a list item is text to the tree, and
 * lining it up would rewrite what the writer meant as code or as a list. The
 * lines alone cannot tell those apart, so the tree is asked. Null when the tree
 * has not parsed that far, which leaves the table as it is.
 */
function readable(state: EditorState, first: number): Readable | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 500);
  if (tree === null) return null;

  const line = state.doc.lineAt(first);
  let node: SyntaxNode | null = tree.resolveInner(line.from, 1);
  while (node !== null && node.name !== "Table") node = node.parent;
  if (node === null || node.from !== line.from || node.parent?.name !== "Document") return null;

  const run = tableAt(state.doc, line.number);
  if (run === null || run.first !== line.number) return null;
  return { run: cut(run, state.doc, node.to), end: node.to };
}

/** A table the tree reads, its run and where the tree ends it. */
interface Readable {
  run: TableRun;
  end: number;
}

/**
 * The run ended at the line the tree ends the table on.
 *
 * A pipe line under the table that the tree gives to a list item, a quote or a
 * heading is not a row, and lining it up would rewrite it as one.
 */
function cut(run: TableRun, doc: Text, end: number): TableRun {
  return { first: run.first, last: Math.min(run.last, doc.lineAt(end).number) };
}

/**
 * Lines up the edited table the cursor is leaving.
 *
 * The line-up is appended to the transaction that moved the cursor out, with
 * `sequential` so its changes are against the document that transaction made.
 * Its own undo step, so `u` puts back the ragged text and keeps what was typed.
 * A table that is already square gets no change at all, only the forgetting.
 */
const lineUpOnLeave = EditorState.transactionFilter.of((tr) => {
  const marks = tr.startState.field(edited);
  if (marks.length === 0) return tr;

  // The cursor is read from the state it was in, as the tree is, and the new
  // position from the document it lands in. Reading `tr.state` here would build
  // the new state from inside the filter that is making it.
  const was = tr.startState.doc.lineAt(tr.startState.selection.main.head).number;
  const now = tr.newDoc.lineAt(tr.newSelection.main.head).number;
  const doc = tr.newDoc;
  const changes: ChangeSpec[] = [];
  const effects: StateEffect<number>[] = [];

  const lost = lostIn(tr, marks);
  for (const mark of marks) {
    if (lost.has(mark.at)) continue;
    const at = tr.changes.mapPos(mark.at, -1, MapMode.TrackDel);
    if (at === null) continue;
    // A mark the tree refuses is forgotten, so the tree is not asked about it on
    // every later leave.
    const table = readable(tr.startState, mark.at);
    if (table === null) {
      effects.push(forget.of(at));
      continue;
    }
    if (was < table.run.first || was > table.run.last) continue;

    const line = doc.lineAt(at);
    const next = tableAt(doc, line.number);
    if (next !== null && next.first === line.number) {
      const kept = cut(next, doc, tr.changes.mapPos(table.end, -1));
      if (now >= kept.first && now <= kept.last) continue;
      // Changed and changed back: the table is as it was, so there is nothing to line up.
      if (textOf(doc, kept) !== mark.before) changes.push(...lineUpChanges(doc, kept));
    }
    effects.push(forget.of(at));
  }

  if (effects.length === 0) return tr;
  return [
    tr,
    {
      changes,
      sequential: true,
      effects,
      annotations: [Transaction.userEvent.of(LINE_UP), isolateHistory.of("full")],
    },
  ];
});

/**
 * Lines up every edited table, for `save`, so the text written is the table as
 * the reader sees it. Nothing to do when the extension is absent or nothing was
 * typed into a table.
 */
export function lineUpEdited(view: EditorView): void {
  const marks = view.state.field(edited, false);
  if (marks === undefined || marks.length === 0) return;

  const doc = view.state.doc;
  const changes: ChangeSpec[] = [];
  for (const mark of marks) {
    const table = readable(view.state, mark.at);
    if (table === null || textOf(doc, table.run) === mark.before) continue;
    changes.push(...lineUpChanges(doc, table.run));
  }
  view.dispatch({
    changes,
    effects: marks.map((mark) => forget.of(mark.at)),
    annotations: [Transaction.userEvent.of(LINE_UP), isolateHistory.of("full")],
  });
}

/** What the editor needs for the line-up: the set, and the leaving. */
export const tableLineup: Extension = [edited, lineUpOnLeave];
