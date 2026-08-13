import { syntaxTree } from "@codemirror/language";
import type { ChangeSpec, EditorState, SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { alignTable, tableAt } from "@/lib/table";

export interface MarkSpec {
  open: string;
  close: string;
  /** The lezer node name the wrapped text parses to. */
  node: string;
}

export const BOLD: MarkSpec = { open: "**", close: "**", node: "StrongEmphasis" };
export const ITALIC: MarkSpec = { open: "*", close: "*", node: "Emphasis" };
export const STRIKE: MarkSpec = { open: "~~", close: "~~", node: "Strikethrough" };
export const HIGHLIGHT: MarkSpec = { open: "==", close: "==", node: "Highlight" };

/**
 * The marked node the cursor sits inside, or null.
 *
 * Walks up from the innermost node rather than searching the tree, so italics
 * nested inside bold answer for themselves and not for their parent.
 */
function enclosing(state: EditorState, at: number, node: string) {
  let found: SyntaxNode | null = syntaxTree(state).resolveInner(at, 0);

  while (found) {
    if (found.name === node) return { from: found.from, to: found.to };
    found = found.parent;
  }
  return null;
}

/**
 * Adds or removes one pair of marks around the cursor or the selection.
 *
 * With nothing selected it takes the word under the cursor, and on a blank line
 * it opens an empty pair and sits between the halves so you can type into it.
 * Returns whether it changed the document.
 */
export function toggleMark(view: EditorView, spec: MarkSpec): boolean {
  const { state } = view;
  const range = state.selection.main;
  const marked = enclosing(state, range.head, spec.node);

  if (marked) {
    view.dispatch({
      changes: [
        { from: marked.from, to: marked.from + spec.open.length },
        { from: marked.to - spec.close.length, to: marked.to },
      ],
    });
    return true;
  }

  const target: SelectionRange | null = range.empty ? state.wordAt(range.head) : range;
  const from = target?.from ?? range.head;
  const to = target?.to ?? range.head;

  view.dispatch({
    changes: [
      { from, insert: spec.open },
      { from: to, insert: spec.close },
    ],
    // Inside the marks either way. An empty pair is an invitation to type, and
    // a wrapped word has to stay where a second press can still see the mark,
    // or the key stops being a toggle.
    selection: { anchor: to + spec.open.length },
  });
  return true;
}

const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^#{1,6}\s/;
/** A bullet written with the markers this rewrites, and the space after it. */
const BULLET = /^(\s*)[*+](\s)/;

/**
 * Tidies the whole note: trailing whitespace, blank runs, headings and bullets.
 *
 * Line by line rather than through the syntax tree, because every rule here is
 * about a line's own shape and the tree would only make the same reading
 * longer. A table is the one block that is not about a line's own shape, and
 * `table.ts` reads it whole. The frontmatter is YAML and a fence holds whatever
 * it holds, so both are stepped over untouched.
 *
 * It writes a change per line rather than replacing the document, which is what
 * keeps the cursor where it was: CodeMirror maps it through the changes.
 * Returns whether anything moved.
 */
export function formatDocument(view: EditorView): boolean {
  const { doc } = view.state;
  const changes: ChangeSpec[] = [];
  let inFront = doc.line(1).text === "---";
  let inFence = false;
  let blanks = 0;
  let seen = 0;

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    seen++;

    if (inFront) {
      if (n > 1 && line.text === "---") inFront = false;
      continue;
    }
    if (FENCE.test(line.text)) {
      inFence = !inFence;
      blanks = 0;
      continue;
    }
    if (inFence) {
      blanks = 0;
      continue;
    }

    // Before the line rules, and taking the whole block rather than one line:
    // a column is as wide as the widest cell in it, which no single line knows.
    // `first === n` because the loop jumps to `last`, so it only ever meets a
    // table at its top. Saying so keeps a change from overlapping one already
    // pushed, which CodeMirror throws on.
    const table = tableAt(doc, n);
    if (table?.first === n) {
      const to = doc.line(table.last).to;
      const drawn = alignTable(doc, table);
      if (drawn !== doc.sliceString(line.from, to)) {
        changes.push({ from: line.from, to, insert: drawn });
      }
      n = table.last;
      blanks = 0;
      continue;
    }

    const text = line.text.replace(/\s+$/, "").replace(BULLET, "$1-$2");

    if (text === "") {
      blanks++;
      // The second blank in a row goes, and it takes the newline in front of it
      // rather than the one behind, so two dropped in a row cannot overlap. The
      // first line of a note is never the second blank, so `from - 1` is safe.
      if (blanks > 1) changes.push({ from: line.from - 1, to: line.to });
      else if (text !== line.text) changes.push({ from: line.from, to: line.to });
      continue;
    }

    const gap = HEADING.test(text) && blanks === 0 && seen > 1 ? "\n" : "";
    if (gap || text !== line.text) {
      changes.push({ from: line.from, to: line.to, insert: gap + text });
    }
    blanks = 0;
  }

  if (changes.length === 0) return false;
  view.dispatch({ changes });
  return true;
}
