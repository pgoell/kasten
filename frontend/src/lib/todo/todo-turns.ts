/** The todo presses running now, the turn todo writes take one at a time, and the row an open edit follows. */

/** Presses running now. A press can start before the last one has settled. */
let running = 0;

/** Presses' store writes landed less the `todos` events seen since: one above 0 is an echo still on its way. */
let echoes = 0;

export function beginPress(): void {
  running += 1;
}

/** Whether a press runs now: its end asks for the todo list, so nothing else need (#1998). */
export function pressRunning(): boolean {
  return running > 0;
}

/** Ends a press; `wrote` when the store took its write, whose `todos` event may land before or after this. */
export function endPress(wrote: boolean): void {
  running -= 1;
  if (wrote) echoes += 1;
  // Events past a press's own echoes came from elsewhere, and the last press's end read covers them.
  if (running === 0) echoes = Math.max(echoes, 0);
}

/**
 * Whether a `todos` event needs no read: one during a press, or a press's echo landing after its end read was
 * asked (#2283). A miscount costs a read, never one missed: each echo is counted once.
 */
export function pressEcho(): boolean {
  if (running === 0 && echoes <= 0) return false;
  echoes -= 1;
  return true;
}

/** A stream opened afresh reads the list anew, and echoes sent before it never come. */
export function forgetEchoes(): void {
  echoes = 0;
}

/** A todo row as the list names it. */
interface Row {
  path: string;
  line: number;
  text: string;
}

/**
 * How long a todo write waits on the one before it, then goes on alone. The api client has
 * no timeout, so a lost answer would otherwise hold every later press until reload.
 */
const TURN_WAIT_MS = 10_000;

/** The todo write before this one, which the next waits on. */
let turns: Promise<unknown> = Promise.resolve();

/**
 * Run `work` once the todo write before it has settled. Two at once would race on a row's version,
 * and a key after an `x` must reach the todo as the `x` left it (#2084).
 */
export function inTurn<T>(work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, TURN_WAIT_MS);
  });
  const turn = Promise.race([turns, bound])
    .finally(() => clearTimeout(timer))
    .then(work);
  // Settled either way, so the next write waits on this one and never on why it failed.
  turns = Promise.allSettled([turn]);
  return turn;
}

/** The lines of `at`'s note that say its words, by line, and which of them is `at`: how an edit tells twins apart. */
export function twinsOf(at: Row, rows: Row[]): { nth: number; of: number } {
  const same = rows
    .filter((row) => row.path === at.path && row.text === at.text)
    .map((row) => row.line);
  // `at` is one of them even where its own line no longer says its words.
  const own = same.includes(at.line) ? 0 : 1;
  return { nth: same.filter((line) => line < at.line).length, of: same.length + own };
}

/**
 * The row `at` (its words when taken) is drawn on after a redraw: the same one of the lines saying them while their
 * count holds. Null where twins cannot be told apart, or none is left; never the row now on its line, as a listed
 * line counts todos and the next one takes it (#2257).
 */
export function followRow<R extends Row>(
  at: Row,
  twins: { nth: number; of: number },
  rows: R[],
): R | null {
  const same = rows
    .filter((row) => row.path === at.path && row.text === at.text)
    .sort((one, other) => one.line - other.line);
  return same.length === twins.of ? (same[twins.nth] ?? null) : null;
}

/**
 * The row an open edit is drawn on after a redraw: its own todo by id, wherever it now sits, or null once it has
 * left the list (#2257). A row that names no todo is followed by its words.
 */
export function followEdit<R extends Row>(
  at: Row,
  edit: { id?: string; twins: { nth: number; of: number } },
  rows: R[],
  idOf: (row: R) => string | undefined,
): R | null {
  if (edit.id === undefined) return followRow(at, edit.twins, rows);
  return rows.find((row) => idOf(row) === edit.id) ?? null;
}
