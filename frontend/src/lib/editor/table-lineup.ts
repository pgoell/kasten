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
import { fromVault } from "@/lib/editor/buffer-writes";
import { lineUpChanges, type TableRun, tableAt } from "@/lib/editor/table";

/**
 * Lines up the tables the reader typed into, when the cursor leaves them and on save, not on every
 * keystroke, since the padding would move under the cursor. Other tables are left as they were.
 */

/** The user event the line-up's own edits carry, so they are not taken for typing. */
const LINE_UP = "format.table";

/**
 * Takes a table's mark out of the set. By id, because a line-up moves the lines
 * of every table after the one it lines up, so a position taken before it is
 * stale; `at` only tells a change in the same transaction which table it is.
 */
const forget = StateEffect.define<{ id: number; at: number }>();

/** The ids the marks are given, unique for the life of the page. */
let seq = 0;

/**
 * An edited table: its id, the position of its first line, and its text before the typing.
 * Undo or a typed-then-deleted character restores that text, which then has nothing to line up.
 */
interface Mark {
  id: number;
  at: number;
  before: string;
}

/** The text of a table's lines, as the document holds them. */
function textOf(doc: Text, run: TableRun): string {
  return doc.sliceString(doc.line(run.first).from, doc.line(run.last).to);
}

/**
 * The tables a change touches, measured before it. A deletion or replacement touches a table its
 * lines reach into; an insertion only when it lands inside them, not on an edge.
 */
function touchedBy(
  tr: Transaction,
  fromA: number,
  toA: number,
  fromB: number,
  toB: number,
): Mark[] {
  const before = tr.startState.doc;
  const inserted = tr.newDoc.sliceString(fromB, toB);
  const found: Mark[] = [];
  for (let n = before.lineAt(fromA).number; n <= before.lineAt(toA).number; n++) {
    const run = tableAt(before, n);
    if (run === null) continue;

    const from = before.line(run.first).from;
    const to = before.line(run.last).to;
    const hit =
      fromA === toA
        ? (from < fromA && fromA < to) ||
          (fromA === from && !inserted.endsWith("\n")) ||
          (fromA === to && !inserted.startsWith("\n"))
        : fromA < to && toA > from;
    if (!hit) continue;

    // Deleted whole, the table is gone and there is nothing to mark: its position
    // would otherwise map onto the table after it. A deletion over only part of it
    // is an edit of the table.
    if (fromA <= from && toA >= to) continue;
    const at = tr.changes.mapPos(from, -1, MapMode.TrackDel);
    if (at !== null) found.push({ id: ++seq, at, before: textOf(before, run) });
  }
  return found;
}

/**
 * The tables a change puts a character into, measured after it. A pasted row is text `touchedBy`
 * cannot see, so the mark's empty text counts as changed; an Enter at a row's end puts in no row.
 */
function openedBy(tr: Transaction, fromB: number, toB: number): Mark[] {
  const doc = tr.newDoc;
  if (doc.sliceString(fromB, toB).replace(/\n/g, "") === "") return [];
  const found: Mark[] = [];
  for (let n = doc.lineAt(fromB).number; n <= doc.lineAt(toB).number; n++) {
    const run = tableAt(doc, n);
    if (run === null) continue;
    found.push({ id: ++seq, at: doc.line(run.first).from, before: "" });
  }
  return found;
}

/**
 * The ids of the marks whose whole table the change deletes, measured before it. `TrackDel` does not
 * report a deletion starting on the position, so a `dap` from a table's first line is checked here.
 */
function lostIn(tr: Transaction, marks: Mark[]): Set<number> {
  const lost = new Set<number>();
  const doc = tr.startState.doc;
  tr.changes.iterChangedRanges((fromA, toA) => {
    for (const mark of marks) {
      const run = tableAt(doc, doc.lineAt(mark.at).number);
      if (run === null) continue;
      if (fromA <= mark.at && toA >= doc.line(run.last).to) lost.add(mark.id);
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
    const forgottenAt = new Set<number>();
    for (const effect of tr.effects) {
      if (effect.is(forget)) {
        forgotten.add(effect.value.id);
        forgottenAt.add(effect.value.at);
      }
    }

    const lost = lostIn(tr, marks);
    let next: Mark[] = [];
    for (const mark of marks) {
      if (lost.has(mark.id) || forgotten.has(mark.id)) continue;
      const at = tr.changes.mapPos(mark.at, -1, MapMode.TrackDel);
      if (at !== null) next.push({ id: mark.id, at, before: mark.before });
    }
    if (!isTyping(tr)) return next;

    // A table this transaction forgets is not marked again by it.
    const add = (mark: Mark) => {
      if (forgottenAt.has(mark.at) || next.some((each) => each.at === mark.at)) return;
      next = [...next, mark];
    };
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      for (const mark of touchedBy(tr, fromA, toA, fromB, toB)) add(mark);
      for (const mark of openedBy(tr, fromB, toB)) add(mark);
    });
    return next;
  },
});

/**
 * Whether a transaction is the reader's own typing. Vim's edits carry no user event, so the history decides:
 * the vault's text, a held note and the watched stamp stay off the undo stack. Undo and redo are not typing.
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
 * The run of the table opening at `first`, when the syntax tree reads it as a table of this note.
 * A pipe line in a fence, quote or list is text to the tree, so it is not lined up. Null if unparsed.
 */
function readable(state: EditorState, first: number): Readable | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 500);
  if (tree === null) return null;

  const line = state.doc.lineAt(first);
  // The tree starts a table after the indent, so the node is asked for there: a
  // head the reader left with a leading space is still a table's head.
  const start = line.from + line.text.length - line.text.trimStart().length;
  let node: SyntaxNode | null = tree.resolveInner(start, 1);
  while (node !== null && node.name !== "Table") node = node.parent;
  if (node === null || node.from !== start || node.parent?.name !== "Document") return null;

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
 * Lines up the edited table the cursor is leaving, as its own undo step, so `u` puts back the ragged text.
 * Appended with `sequential`, so its changes are against the document the cursor move made.
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
  const effects: StateEffect<{ id: number; at: number }>[] = [];

  const lost = lostIn(tr, marks);
  for (const mark of marks) {
    if (lost.has(mark.id)) continue;
    const at = tr.changes.mapPos(mark.at, -1, MapMode.TrackDel);
    if (at === null) continue;
    // No table on the mark's line any more, so the table is gone and so is the mark.
    const opened = tableAt(tr.startState.doc, tr.startState.doc.lineAt(mark.at).number);
    if (opened === null) {
      effects.push(forget.of({ id: mark.id, at }));
      continue;
    }
    // The tree refuses the table for now, as it does one that is mid-edit. The mark
    // and its text wait for a leave the tree accepts.
    const table = readable(tr.startState, mark.at);
    if (table === null) continue;
    if (was < table.run.first || was > table.run.last) continue;

    const next = tableAt(doc, doc.lineAt(at).number);
    if (next !== null && next.first === doc.lineAt(at).number) {
      const kept = cut(next, doc, tr.changes.mapPos(table.end, -1));
      if (now >= kept.first && now <= kept.last) continue;
      // Changed and changed back: the table is as it was, so there is nothing to line up.
      if (textOf(doc, next) !== mark.before) changes.push(...lineUpChanges(doc, kept));
    }
    effects.push(forget.of({ id: mark.id, at }));
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
  const done: Mark[] = [];
  for (const mark of marks) {
    const opened = tableAt(doc, doc.lineAt(mark.at).number);
    if (opened === null) {
      done.push(mark);
      continue;
    }
    // Refused by the tree for now: kept, as a leave keeps it, for a save the tree accepts.
    const table = readable(view.state, mark.at);
    if (table === null) continue;
    done.push(mark);
    if (textOf(doc, opened) !== mark.before) changes.push(...lineUpChanges(doc, table.run));
  }
  view.dispatch({
    changes,
    effects: done.map((mark) => forget.of({ id: mark.id, at: mark.at })),
    annotations: [Transaction.userEvent.of(LINE_UP), isolateHistory.of("full")],
  });
}

/** What the editor needs for the line-up: the set, and the leaving. */
export const tableLineup: Extension = [edited, lineUpOnLeave];
