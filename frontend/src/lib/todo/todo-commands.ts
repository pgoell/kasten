import { ChangeSet, Facet, type Line } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { readClock } from "@/lib/clock";
import { noticeHandler } from "@/lib/image";
import { appendUnderEdit, type Edit } from "@/lib/note-section";
import { periodicNote } from "@/lib/periodic";
import { nameAt, newId, parseTodo, patchLine, type TodoState } from "@/lib/todo/todo";
import { agentPress } from "@/lib/todo/todo-agent";
import { type Closed, closedAmong } from "@/lib/todo/todo-blocked";
import { cycleLines, doneLine, doneLineEdits, pressedLine, twinnedIn } from "@/lib/todo/todo-write";

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
  /**
   * The whole buffer before the press. The route asks it whether the id stands
   * on another todo line too: the disk can be an autosave behind the buffer.
   */
  doc: string;
}

export type CycleHandler = (cycle: TodoCycle) => void;

/**
 * Carries the callback a press uses to reach the vault. A facet, not an `editorCommands`
 * member, since vim registers the key once for every view and cannot close over props.
 */
export const todoCycled = Facet.define<CycleHandler, CycleHandler | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * The path of the note this view holds, or nothing. Tells today's daily note apart, since a
 * todo there logs into this buffer, the one write that cannot go through the vault.
 */
export const notePath = Facet.define<string, string | undefined>({
  combine: (paths) => paths[0],
});

/**
 * Whether an id stands on a todo line in another note, as far as the page's
 * listing of the vault says. The press is synchronous and cannot ask the vault,
 * and a listing it does not hold answers no: the route asks the vault afresh
 * before it writes anything beyond the buffer.
 */
export const idElsewhere = Facet.define<
  (id: string) => boolean,
  ((id: string) => boolean) | undefined
>({
  combine: (answers) => answers[0],
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
 * Cycle the cursor's line in the buffer, so `u` undoes it. A todo in today's note has both
 * halves go in this transaction; one elsewhere leaves the second half to the route.
 */
export function cycleTodoAtCursor(view: EditorView, want?: TodoState): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const today = readClock(new Date()).date;
  const id = newId();
  const cycled = pressedLine(line.text, today, id, want);
  // A key aimed at the state the line is in already. Writing the same line back
  // would still move the cursor, fill the undo history and log the todo again.
  if (cycled === null) return;
  const doc = state.doc.toString();
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
  // An id another todo line carries too, in here or in another note: the press
  // moves its own line and what hangs off it, no log line and no dependent, and
  // the route refuses the rest and says why.
  const carried = parseTodo(line.text)?.id;
  const elsewhere = state.facet(idElsewhere);
  const shared =
    twinnedIn(lines, line.number) || (carried !== undefined && elsewhere?.(carried) === true);
  // A blocker this note carries and another note carries too is twinned, which
  // this document alone cannot see.
  const here = closedAmong(lines.flatMap((text) => parseTodo(text) ?? []));
  const closed: Closed = (blocker) => {
    const answer = here(blocker);
    return answer !== undefined && elsewhere?.(blocker) === true ? "twinned" : answer;
  };
  const moved = cycleLines({
    lines,
    line: line.number,
    today,
    id,
    closed,
    state: want,
    shared,
  });

  const changes = ChangeSet.of(
    [
      ...[...moved].map(([at, insert]) => {
        const held = state.doc.line(at);
        return { from: held.from, to: held.to, insert };
      }),
      ...(shared ? [] : logEdits(doc, line.text, cycled, path)),
    ],
    state.doc.length,
  );

  const named = want === "waiting" ? nameAt(cycled) : null;

  view.dispatch({
    changes,
    // Onto the first word. The box is drawn as a symbol and hidden with the
    // bullet, so a cursor left where it was would sit on a character that is
    // not on the screen, and `x` would cut it. The line's own start is what
    // maps, the log line being able to land above the todo as easily as below
    // it; the box is then an offset into the line the changes just wrote.
    //
    // A line just set to waiting names nobody yet, and there the cursor goes
    // onto the last digit of the date instead, so `a` types the name.
    selection: {
      anchor:
        changes.mapPos(line.from, -1) +
        (named === null ? (BOX.exec(cycled)?.[0].length ?? 0) : named - 1),
    },
  });

  cycleHandler?.({ before: line.text, after: cycled, line: line.number, doc });
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

  replaceLine(view, line, patchLine(line.text, { ...todo, id: newId() }));
}

/**
 * Write `patched` over `line`, replacing only the span that differs, so the
 * cursor and the rest of the line map through the change untouched and one `u`
 * takes it back.
 */
function replaceLine(view: EditorView, line: Line, patched: string): void {
  let start = 0;
  while (start < patched.length && patched[start] === line.text[start]) start += 1;
  let end = 0;
  while (
    end < patched.length - start &&
    end < line.text.length - start &&
    patched[patched.length - 1 - end] === line.text[line.text.length - 1 - end]
  )
    end += 1;

  view.dispatch({
    changes: {
      from: line.from + start,
      to: line.to - end,
      insert: patched.slice(start, patched.length - end),
    },
  });
}

/**
 * Hand the todo under the cursor to the agent worker, or take it back: `#agent`
 * on or off the line, and nothing else moved. A press that writes nothing says
 * why at the foot, as the pane's `@` does.
 */
export function agentTodoAtCursor(view: EditorView): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const pressed = agentPress(
    state.doc.toString().split("\n"),
    line.number,
    readClock(new Date()).date,
    newId(),
  );
  if ("why" in pressed) {
    state.facet(noticeHandler)?.(`Nothing moved: ${pressed.why}`);
    return;
  }
  replaceLine(view, line, pressed.line);
}
