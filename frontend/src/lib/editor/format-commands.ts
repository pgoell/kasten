import { syntaxTree } from "@codemirror/language";
import type { ChangeSpec, EditorState, Line, SelectionRange, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { alignTable, tableAt } from "@/lib/editor/table";
import { belowFrontmatter } from "@/lib/frontmatter-language";

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
 * The marked node the cursor sits inside, or null. Walks up from the innermost node,
 * so italics inside bold answer for themselves, not their parent.
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
 * Adds or removes one pair of marks around the selection, or the word under the cursor.
 * On a blank line it opens an empty pair with the cursor between. Returns whether it changed the document.
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

/** Where the line-by-line tidy stands, and the changes it has gathered. */
interface Tidy {
  /** From `frontEnd`. */
  front: number;
  inFence: boolean;
  blanks: number;
  seen: number;
  changes: ChangeSpec[];
}

/**
 * Tidies the note line by line, one change per line, so CodeMirror maps the cursor through them.
 * Frontmatter and fences are stepped over; tables are left to table.ts. Returns whether anything moved.
 */
export function formatDocument(view: EditorView): boolean {
  const { doc } = view.state;
  const tidy: Tidy = {
    front: frontEnd(doc),
    inFence: false,
    blanks: 0,
    seen: 0,
    changes: [],
  };
  for (let n = 1; n <= doc.lines; n++) n = tidyLine(doc, n, tidy);

  if (tidy.changes.length === 0) return false;
  view.dispatch({ changes: tidy.changes });
  return true;
}

/** The line of the block's closing fence, or 0 with no block. */
function frontEnd(doc: Text): number {
  const below = belowFrontmatter(doc.toString());
  return below === 0 ? 0 : doc.lineAt(below - 1).number;
}

/** Tidies line `n` and returns the last line it covered, a table's last when it took one. */
function tidyLine(doc: Text, n: number, tidy: Tidy): number {
  const line = doc.line(n);
  tidy.seen++;

  if (n <= tidy.front) return n;
  if (FENCE.test(line.text)) {
    tidy.inFence = !tidy.inFence;
    tidy.blanks = 0;
    return n;
  }
  if (tidy.inFence) {
    tidy.blanks = 0;
    return n;
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
      tidy.changes.push({ from: line.from, to, insert: drawn });
    }
    tidy.blanks = 0;
    return table.last;
  }

  tidyText(line, tidy);
  return n;
}

function tidyText(line: Line, tidy: Tidy): void {
  const text = line.text.replace(/\s+$/, "").replace(BULLET, "$1-$2");

  if (text === "") {
    tidy.blanks++;
    // The second blank in a row goes, and it takes the newline in front of it
    // rather than the one behind, so two dropped in a row cannot overlap. The
    // first line of a note is never the second blank, so `from - 1` is safe.
    if (tidy.blanks > 1) tidy.changes.push({ from: line.from - 1, to: line.to });
    else if (text !== line.text) tidy.changes.push({ from: line.from, to: line.to });
    return;
  }

  const gap = HEADING.test(text) && tidy.blanks === 0 && tidy.seen > 1 ? "\n" : "";
  if (gap || text !== line.text) {
    tidy.changes.push({ from: line.from, to: line.to, insert: gap + text });
  }
  tidy.blanks = 0;
}
