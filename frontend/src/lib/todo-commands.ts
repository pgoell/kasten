import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { readClock } from "@/lib/clock";
import { cycleLine, newId } from "@/lib/todo";

/** Where the box ends on a line that has one, which is where the words start. */
const BOX = /^[ \t]*- \[.\] /;

/** One press of the cycle, as the line read on either side of it. */
export interface TodoCycle {
  before: string;
  after: string;
  /** Which line it is, counting from one, the way a `SearchHit` counts. */
  line: number;
}

export type CycleHandler = (cycle: TodoCycle) => void;

/**
 * Carries the callback that follows a press into the vault.
 *
 * A facet for the reason `saveHandler` is one: vim registers this key once for
 * the whole module and cannot close over one view's props. Not a member of
 * `editorCommands` either, because that table is the one a leader sequence
 * names a command in and every member of it takes nothing.
 */
export const todoCycled = Facet.define<CycleHandler, CycleHandler | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * Cycle the line the cursor is on, in the buffer, so `u` undoes it.
 *
 * The clock and the id are read here rather than in `todo.ts`, which is what
 * keeps that module a function over strings and its tests free of both.
 *
 * The buffer is only half of a press. Entering or leaving done also moves a
 * `- ✅` line in another note, which no buffer edit can reach, so the line is
 * reported on the way out and the route writes that half. `u` puts the line
 * back and leaves the log entry where it is: undo is CodeMirror's history of
 * this document, and the log is not in it.
 */
export function cycleTodoAtCursor(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const cycled = cycleLine(line.text, readClock(new Date()).date, newId());
  const cycleHandler = view.state.facet(todoCycled);

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: cycled },
    // Onto the first word. The box is drawn as a symbol and hidden with the
    // bullet, so a cursor left where it was would sit on a character that is
    // not on the screen, and `x` would cut it.
    selection: { anchor: line.from + (BOX.exec(cycled)?.[0].length ?? 0) },
  });

  cycleHandler?.({ before: line.text, after: cycled, line: line.number });
}
