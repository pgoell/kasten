/**
 * The vault's echo of a todo press, which the pane does not need to hear twice.
 *
 * A press writes one or more notes and then asks for the todo list once, after
 * the last write. `/api/events` then reports each of those writes too, and
 * every report would ask for the list again: a second and third fetch of a list
 * the press already read. So a path a press wrote is not asked for again while
 * the press runs, nor for a moment after it, which is how long the echo takes to
 * arrive.
 */

/** How long after a press the echo of its writes may still arrive. */
const ECHO_MS = 3000;

/** Presses running now. A press can start before the last one has settled. */
let running = 0;
/** Paths written while a press runs, which the echo of waits for it to end. */
const written = new Set<string>();
/** Paths whose echo is due, by the time it stops being one. */
const expiry = new Map<string, number>();

/** A press has begun. Every write until its `endPress` is the press's own. */
export function beginPress(): void {
  running += 1;
}

/** A press has settled. Once none is running, what it wrote is an echo for a while. */
export function endPress(): void {
  running -= 1;
  if (running > 0) return;
  const until = Date.now() + ECHO_MS;
  for (const path of written) expiry.set(path, until);
  written.clear();
}

/** A note a press has just written, by its path as the vault spells it. */
export function pressWrote(path: string): void {
  if (running > 0) written.add(path);
}

/** Whether a write event for `path` is the echo of a press, and so not asked for again. */
export function pressEcho(path: string): boolean {
  if (running > 0 && written.has(path)) return true;
  const until = expiry.get(path);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  expiry.delete(path);
  return false;
}
