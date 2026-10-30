/**
 * Where a drink from the palette lands. Today's note in the focused pane goes to its buffer. Any other note goes to the vault,
 * unless today's note is held or being saved: a write then would land over typed text, so the drink is refused.
 */

import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { createNote, NoteExists, updateNote } from "@/lib/api";
import { LOG_HEADING } from "@/lib/log/log-lines";
import { appendUnder, appendUnderEdit } from "@/lib/note-section";
import { periodicNote } from "@/lib/periodic";
import { notePath } from "@/lib/todo/todo-commands";

/**
 * Log a drink into the buffer when the view holds today's note. False, with nothing written, for any other note.
 * One change, so one undo takes the line back.
 */
export function logDrinkInView(view: EditorView, line: string): boolean {
  if (view.state.facet(notePath) !== periodicNote("daily", new Date()).path) return false;
  view.dispatch({
    changes: appendUnderEdit(view.state.doc.toString(), LOG_HEADING, line),
    userEvent: "input.log",
    // History joins quick adjacent input into one step; a drink is a step of its own.
    annotations: isolateHistory.of("full"),
  });
  return true;
}

export type DrinkTarget = "buffer" | "vault" | { why: string };

/**
 * Where a drink goes: into the buffer when today's note is the focused pane's, else into the vault.
 * A vault write over today's note is refused while the buffer holds text the vault refused, or a save is in the air.
 */
export function drinkTarget({
  today,
  focusedPath,
  held,
  writing,
}: {
  today: string;
  focusedPath: string | undefined;
  held: boolean;
  writing: boolean;
}): DrinkTarget {
  if (focusedPath === today) return "buffer";
  if (held) return { why: `${today} holds text not yet saved` };
  if (writing) return { why: `${today} is still being saved` };
  return "vault";
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
 * Log a drink into today's note in the vault, making the note and its `## Log` if there are none.
 * Taps run one at a time: a read before an earlier tap's save would miss its line, and the later save would drop it.
 * `stillOk` is asked again where the write is made. A refusal rejects with `Nothing logged: <why>`.
 */
export function logDrinkInVault(
  line: string,
  paths: string[],
  stillOk?: () => { why: string } | null,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, TAP_WAIT_MS);
  });
  const turn = Promise.race([drinkTurns, bound])
    .finally(() => clearTimeout(timer))
    .then(() => writeDrink(line, paths, stillOk));
  // Settled either way, so the next tap waits on this one and never on why it
  // failed.
  drinkTurns = Promise.allSettled([turn]);
  return turn;
}

async function writeDrink(
  line: string,
  paths: string[],
  stillOk?: () => { why: string } | null,
): Promise<void> {
  const daily = periodicNote("daily", new Date());
  // The refusal the last ask gave. A holder rather than a variable, since the
  // change below sets it from inside the callback `updateNote` runs.
  const refusal: { why?: string } = {};
  // Asked at every write, not once at the press: the tap may have waited behind
  // a save, and the note may have been opened or edited meanwhile.
  const change = (text: string) => {
    refusal.why = stillOk?.()?.why;
    return refusal.why === undefined ? appendUnder(text, LOG_HEADING, line) : null;
  };

  // A note the listing leaves out may have been made by a tap just before this
  // one, so a create that finds it there writes into it instead.
  if (!paths.includes(daily.path)) {
    const created = change(daily.body);
    if (created === null) throw new Error(`Nothing logged: ${refusal.why}`);
    try {
      await createNote(daily.path, created);
      return;
    } catch (error) {
      if (!(error instanceof NoteExists)) throw error;
    }
  }
  // A refused change makes `updateNote` answer null and write nothing.
  await updateNote(daily.path, change);
  if (refusal.why !== undefined) throw new Error(`Nothing logged: ${refusal.why}`);
}
