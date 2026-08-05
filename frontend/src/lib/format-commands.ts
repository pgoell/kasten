import { syntaxTree } from "@codemirror/language";
import type { EditorState, SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

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
