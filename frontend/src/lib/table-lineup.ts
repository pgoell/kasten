import { isolateHistory } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import {
  type ChangeSpec,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
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
 * The first line of each edited table, as a position in the document.
 *
 * Mapped through every change, and a table is found again from its line, so a
 * table that moves with its text stays the one that was typed into.
 */
const edited = StateField.define<number[]>({
  create: () => [],
  update(marks, tr) {
    let next = marks.map((mark) => tr.changes.mapPos(mark, -1));
    for (const effect of tr.effects) {
      if (effect.is(forget)) next = next.filter((mark) => mark !== effect.value);
    }
    if (!isTyping(tr)) return next;

    const doc = tr.newDoc;
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      for (let n = doc.lineAt(fromB).number; n <= doc.lineAt(toB).number; n++) {
        const run = tableAt(doc, n);
        if (run === null) continue;
        const mark = doc.line(run.first).from;
        if (!next.includes(mark)) next = [...next, mark];
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
function readable(state: EditorState, first: number): TableRun | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 500);
  if (tree === null) return null;

  const line = state.doc.lineAt(first);
  let node: SyntaxNode | null = tree.resolveInner(line.from, 1);
  while (node !== null && node.name !== "Table") node = node.parent;
  if (node === null || node.from !== line.from || node.parent?.name !== "Document") return null;

  const run = tableAt(state.doc, line.number);
  return run !== null && run.first === line.number ? run : null;
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

  for (const mark of marks) {
    const run = readable(tr.startState, mark);
    if (run === null || was < run.first || was > run.last) continue;

    const at = tr.changes.mapPos(mark, -1);
    const line = doc.lineAt(at);
    const next = tableAt(doc, line.number);
    if (next !== null && next.first === line.number && now >= next.first && now <= next.last) {
      continue;
    }
    if (next !== null && next.first === line.number) changes.push(...lineUpChanges(doc, next));
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

  const changes: ChangeSpec[] = [];
  for (const mark of marks) {
    const run = readable(view.state, mark);
    if (run !== null) changes.push(...lineUpChanges(view.state.doc, run));
  }
  view.dispatch({
    changes,
    effects: marks.map((mark) => forget.of(mark)),
    annotations: [Transaction.userEvent.of(LINE_UP), isolateHistory.of("full")],
  });
}

/** What the editor needs for the line-up: the set, and the leaving. */
export const tableLineup: Extension = [edited, lineUpOnLeave];
