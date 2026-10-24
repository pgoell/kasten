import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { readMode } from "@/lib/note-head";
import { isRow } from "@/lib/table";

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

/** The lines of each table in the note, first and last, both inside it. */
function tables(state: EditorState): { first: number; last: number }[] {
  const found: { first: number; last: number }[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return;
      const first = state.doc.lineAt(node.from).number;
      const end = state.doc.lineAt(node.to).number;
      // The same stop as live preview's, so the two agree on where a table ends
      // when a paragraph is written straight under it.
      let last = first;
      while (last < end && isRow(state.doc.line(last + 1).text)) last++;
      found.push({ first, last });
      return false;
    },
  });
  return found;
}

function build(state: EditorState): DecorationSet {
  const found = tables(state);
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
      this.decorations = build(view.state);
    }

    update(update: ViewUpdate) {
      // A parse that finishes later changes the tables without a change to the
      // text, so the tree is compared as well as the document.
      if (
        update.docChanged ||
        update.selectionSet ||
        update.startState.facet(readMode) !== update.state.facet(readMode) ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = build(update.state);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export const tableSource: Extension = tableSourcePlugin;
