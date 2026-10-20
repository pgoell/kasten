/**
 * Where a drink from the palette lands: in the buffer when the note is today's,
 * in the vault when it is any other.
 *
 * `log-lines.ts` holds what a tap writes. The buffer owns the note it is typed
 * into, so today's own note is changed there and autosave writes it. Any other
 * note is written through the vault, the way the `## Done` log is.
 */

import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { createNote, NoteExists, updateNote } from "@/lib/api";
import { DEFAULT_LINE, type DrinkKind, LOG_HEADING } from "@/lib/log-lines";
import { appendUnder, appendUnderEdit } from "@/lib/note-section";
import { periodicNote } from "@/lib/periodic";
import { notePath } from "@/lib/todo-commands";

/**
 * Log a drink into the buffer when the view holds today's daily note. False,
 * with nothing written, for any other note.
 *
 * One change, so one undo takes the line back. Nothing is asked first: undo is
 * the way out.
 */
export function logDrinkInView(view: EditorView, kind: DrinkKind): boolean {
  if (view.state.facet(notePath) !== periodicNote("daily", new Date()).path) return false;
  view.dispatch({
    changes: appendUnderEdit(view.state.doc.toString(), LOG_HEADING, DEFAULT_LINE[kind]),
    userEvent: "input.log",
    // History joins quick adjacent input into one step; a drink is a step of its own.
    annotations: isolateHistory.of("full"),
  });
  return true;
}

/** The taps before this one, which the next waits on. */
let drinkTurns: Promise<unknown> = Promise.resolve();

/**
 * How long a tap waits on the one before it, then goes on its own.
 *
 * The api client sets no timeout, so a save that never answers would otherwise
 * hold every later tap until the page reloads. Same bound as `cycleTodoAside`.
 */
const TAP_WAIT_MS = 10_000;

/**
 * Log a drink into today's note in the vault, making the note and its `## Log`
 * where there are none.
 *
 * Taps run one at a time. A read that came before an earlier tap's save would
 * not see that tap's line, and the later save would drop it. A failed tap does
 * not hold up the next.
 */
export function logDrinkInVault(kind: DrinkKind, paths: string[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, TAP_WAIT_MS);
  });
  const turn = Promise.race([drinkTurns, bound])
    .finally(() => clearTimeout(timer))
    .then(() => writeDrink(kind, paths));
  // Settled either way, so the next tap waits on this one and never on why it
  // failed.
  drinkTurns = Promise.allSettled([turn]);
  return turn;
}

async function writeDrink(kind: DrinkKind, paths: string[]): Promise<void> {
  const daily = periodicNote("daily", new Date());
  const change = (text: string) => appendUnder(text, LOG_HEADING, DEFAULT_LINE[kind]);

  // A note the listing leaves out may have been made by a tap just before this
  // one, so a create that finds it there writes into it instead.
  if (!paths.includes(daily.path)) {
    try {
      await createNote(daily.path, change(daily.body));
      return;
    } catch (error) {
      if (!(error instanceof NoteExists)) throw error;
    }
  }
  await updateNote(daily.path, change);
}
