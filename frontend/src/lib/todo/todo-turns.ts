/** The todo presses running now, the turn todo writes take one at a time, and the row an open edit follows. */

/** Presses running now. A press can start before the last one has settled. */
let running = 0;

export function beginPress(): void {
  running += 1;
}

/** Whether a press runs now: its end asks for the todo list, so nothing else need (#1998). */
export function pressRunning(): boolean {
  return running > 0;
}

export function endPress(): void {
  running -= 1;
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
 * The row an open edit of `at` (its words as typed over) is drawn on after a redraw: the same one of the lines
 * saying them while their count holds, else its own line. Null where twins cannot be told apart, or none is left (#2087).
 * `onLine` keeps it on its own line once its words have changed there; a question does not, as another todo may hold that line.
 */
export function followRow<R extends Row>(
  at: Row,
  twins: { nth: number; of: number },
  rows: R[],
  onLine = true,
): R | null {
  const here = rows.filter((row) => row.path === at.path);
  const same = here
    .filter((row) => row.text === at.text)
    .sort((one, other) => one.line - other.line);
  if (same.length > 0) return same.length === twins.of ? (same[twins.nth] ?? null) : null;
  // Its words changed on its own line: the edit stays there, and the write refuses it.
  return (onLine ? here.find((row) => row.line === at.line) : undefined) ?? null;
}
