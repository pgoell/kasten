import { ChangeSet, Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { readClock } from "@/lib/clock";
import { periodicNote } from "@/lib/periodic";
import { cycleLine, formatTodo, newId, parseTodo, setStateOn, type TodoState } from "@/lib/todo";
import {
  appendUnderEdit,
  closedAmong,
  cycleLines,
  doneLine,
  doneLineEdits,
  type Edit,
} from "@/lib/todo-write";

/** Where the box ends on a line that has one, which is where the words start. */
const BOX = /^[ \t]*- \[.\] /;

/** The heading the done log lives under. `todo-write.ts` keeps its own copy. */
const DONE = "## Done";

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
 * The path of the note this view holds, or nothing for a view holding no note.
 *
 * Read to tell today's daily note from every other note. A todo living there
 * logs itself into this very buffer, which is the one write that cannot go
 * through the vault: it would land on text somebody is still typing.
 */
export const notePath = Facet.define<string, string | undefined>({
  combine: (paths) => paths[0],
});

/**
 * The log's half of a press, when the note holding the todo is today's own.
 *
 * Empty for every other note, where the route writes the log through the vault
 * instead, and empty for a press that touches neither end of done.
 */
function logEdits(doc: string, before: string, after: string, path: string | undefined): Edit[] {
  const now = parseTodo(after);
  const was = parseTodo(before);
  if (was?.state !== "done" && now?.state !== "done") return [];

  const today = readClock(new Date());
  if (path === undefined || path !== periodicNote("daily", new Date()).path) return [];

  if (now?.state === "done") {
    // Ticked twice with a retract in between leaves one line, not a pile.
    if (now.id !== undefined && doneLineEdits(doc, now.id).length > 0) return [];
    return [appendUnderEdit(doc, DONE, doneLine(now, path, path, today.date))];
  }

  return was?.id === undefined ? [] : doneLineEdits(doc, was.id);
}

/**
 * Cycle the line the cursor is on, in the buffer, so `u` undoes it.
 *
 * The clock and the id are read here rather than in `todo.ts`, which is what
 * keeps that module a function over strings and its tests free of both.
 *
 * The buffer is only half of a press for a todo living anywhere else: entering
 * or leaving done also moves a `- ✅` line in today's note, so the line is
 * reported on the way out and the route writes that half. A todo already in
 * today's note is the case the route cannot write, this being the buffer being
 * typed into, so both halves go in one transaction here and `u` takes back
 * both.
 *
 * `want` is the state a key named, and nothing where the key walks the cycle.
 * Everything past the line itself is the same either way: a parent takes its
 * parts into done however the press got there.
 */
export function cycleTodoAtCursor(view: EditorView, want?: TodoState): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const today = readClock(new Date()).date;
  const id = newId();
  const doc = state.doc.toString();
  const cycled =
    want === undefined ? cycleLine(line.text, today, id) : setStateOn(line.text, want, today, id);
  const cycleHandler = state.facet(todoCycled);
  const path = state.facet(notePath);

  // Every line of this note the press rewrites, the cascade and the dependents
  // among them. One map rather than a pass per rule, so no two of them can
  // claim a line and hand this an overlapping change.
  //
  // The resolver is built from this document alone, so a dependent in here
  // whose other blocker lives elsewhere stays at `[b]`. That is the
  // conservative answer and the right one: a line is opened only when every
  // blocker on it can be seen closed.
  const lines = doc.split("\n");
  const moved = cycleLines({
    lines,
    line: line.number,
    today,
    id,
    closed: closedAmong(lines.flatMap((text) => parseTodo(text) ?? [])),
    state: want,
  });

  const changes = ChangeSet.of(
    [
      ...[...moved].map(([at, insert]) => {
        const held = state.doc.line(at);
        return { from: held.from, to: held.to, insert };
      }),
      ...logEdits(doc, line.text, cycled, path),
    ],
    state.doc.length,
  );

  view.dispatch({
    changes,
    // Onto the first word. The box is drawn as a symbol and hidden with the
    // bullet, so a cursor left where it was would sit on a character that is
    // not on the screen, and `x` would cut it. The line's own start is what
    // maps, the log line being able to land above the todo as easily as below
    // it; the box is then an offset into the line the changes just wrote.
    selection: {
      anchor: changes.mapPos(line.from, -1) + (BOX.exec(cycled)?.[0].length ?? 0),
    },
  });

  cycleHandler?.({ before: line.text, after: cycled, line: line.number });
}

/**
 * Stamp an id on the todo under the cursor, so something else can name it.
 *
 * The spec's second stamp, the one entering done is not. A `⛔` is written by
 * hand and needs an id to name, and an open todo has none until this.
 */
export function stampIdAtCursor(view: EditorView): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const todo = parseTodo(line.text);
  // A second press leaves the id the first one wrote: an id names one todo for
  // as long as that todo exists.
  if (todo === null || todo.id !== undefined) return;

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: formatTodo({ ...todo, id: newId() }) },
  });
}
