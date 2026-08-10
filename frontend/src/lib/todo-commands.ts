import type { EditorView } from "@codemirror/view";
import { readClock } from "@/lib/clock";
import { cycleLine, newId } from "@/lib/todo";

/** Where the box ends on a line that has one, which is where the words start. */
const BOX = /^[ \t]*- \[.\] /;

/**
 * Cycle the line the cursor is on, in the buffer, so `u` undoes it.
 *
 * The clock and the id are read here rather than in `todo.ts`, which is what
 * keeps that module a function over strings and its tests free of both.
 */
export function cycleTodoAtCursor(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const cycled = cycleLine(line.text, readClock(new Date()).date, newId());

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: cycled },
    // Onto the first word. The box is drawn as a symbol and hidden with the
    // bullet, so a cursor left where it was would sit on a character that is
    // not on the screen, and `x` would cut it.
    selection: { anchor: line.from + (BOX.exec(cycled)?.[0].length ?? 0) },
  });
}
