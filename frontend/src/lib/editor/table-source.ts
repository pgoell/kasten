import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { isRow } from "@/lib/editor/table";
import { readMode } from "@/lib/note/note-head";

/**
 * A table's source, marked where live preview does not draw it.
 *
 * Read draws a table as a grid, and live preview marks the source only while the
 * cursor is in the table. Edit has live preview off, so nothing marks the lines,
 * and the same classes give Edit the same face. The cursor's row is marked in
 * both modes, so the reader can see which row is theirs.
 *
 * Its own plugin and not part of live preview, which sits in the preview
 * compartment and is gone when preview is off.
 */

/**
 * The lines of each table in the ranges, first and last, both inside the table.
 *
 * Only the ranges on screen are walked. A note of many tables would otherwise
 * ask the tree for all of them on every keystroke, and the lines off screen are
 * drawn when they scroll in.
 */
function tables(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): { first: number; last: number }[] {
  const found: { first: number; last: number }[] = [];
  const seen = new Set<number>();
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Table") return;
        const first = state.doc.lineAt(node.from).number;
        // A table reaching into two ranges is found by both.
        if (seen.has(first)) return false;
        seen.add(first);
        const end = state.doc.lineAt(node.to).number;
        // The same stop as live preview's, so the two agree on where a table ends
        // when a paragraph is written straight under it.
        let last = first;
        while (last < end && isRow(state.doc.line(last + 1).text)) last++;
        found.push({ first, last });
        return false;
      },
    });
  }
  return found;
}

function build(state: EditorState, ranges: readonly { from: number; to: number }[]): DecorationSet {
  const found = tables(state, ranges);
  const marks = new Map<number, string[]>();
  const add = (line: number, name: string) => marks.set(line, [...(marks.get(line) ?? []), name]);

  // Edit only: in Read the grid is drawn, and live preview marks the source.
  if (!state.facet(readMode)) {
    for (const { first, last } of found) {
      for (let line = first; line <= last; line++) {
        add(line, "cm-table");
        if (line === first) add(line, "cm-table-head");
      }
    }
  }

  const cursor = state.doc.lineAt(state.selection.main.head).number;
  if (found.some(({ first, last }) => cursor >= first && cursor <= last)) {
    add(cursor, "cm-table-cursor");
  }

  return Decoration.set(
    [...marks].map(([line, names]) =>
      Decoration.line({ class: names.join(" ") }).range(state.doc.line(line).from),
    ),
    true,
  );
}

const tableSourcePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view.state, view.visibleRanges);
    }

    update(update: ViewUpdate) {
      // A parse that finishes later changes the tables without a change to the
      // text, so the tree is compared as well as the document. A scroll brings
      // new lines into the ranges that are walked.
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.facet(readMode) !== update.state.facet(readMode) ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = build(update.state, update.view.visibleRanges);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export const tableSource: Extension = tableSourcePlugin;
