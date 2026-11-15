import { digestOf } from "@/lib/vault/events/vault-events";

/**
 * The vault's echo of a todo press, which the pane need not hear twice. An event is an echo
 * only when its digest matches a text this press wrote; anybody else's edit still asks.
 * Below: the turn todo writes take one at a time, and where an `x` left its todo for the next key.
 */

/** How long after a press the echo of its writes may still arrive. */
const ECHO_MS = 3000;

/** Presses running now. A press can start before the last one has settled. */
let running = 0;
/** The digests of the texts each path was written with, by the presses that wrote it. */
const written = new Map<string, Promise<string | null>[]>();
/** Paths the running presses wrote, which take an expiry once the last one ends. */
const fresh = new Set<string>();
/** When the echo of a path's writes stops being one, once no press runs. */
const expiry = new Map<string, number>();
/** Each path's press saves still out, whose event can beat the answer `pressWrote` reads (#1994). */
const sending = new Map<string, Set<Promise<void>>>();

/** A press has begun. Every write until its `endPress` is the press's own. */
export function beginPress(): void {
  running += 1;
}

/** Whether a press runs now: its end asks for the todo list, so nothing else need (#1998). */
export function pressRunning(): boolean {
  return running > 0;
}

/** A press has settled. Once none is running, what it wrote is an echo for a while. */
export function endPress(): void {
  running -= 1;
  if (running > 0) return;
  const until = Date.now() + ECHO_MS;
  for (const path of fresh) expiry.set(path, until);
  fresh.clear();
}

/** Forget the writes whose echo has passed, so the record does not grow with the session. */
function prune(): void {
  const now = Date.now();
  for (const [path, until] of expiry) {
    if (until > now) continue;
    expiry.delete(path);
    written.delete(path);
  }
}

/**
 * A note a press has just written, and the text it now holds: what landed on
 * disk, which is the digest `/api/events` reports for the write.
 */
export function pressWrote(path: string, content: string): void {
  if (running === 0) return;
  fresh.add(path);
  // Written again by a press, so the expiry of an earlier one no longer bounds
  // it: pruning it then would drop the digest this press is about to echo.
  expiry.delete(path);
  // The vault keeps the note's own line endings, and the save answers with the
  // text it was sent, so a CRLF note echoes the digest of the CRLF text.
  const crlf = content.replace(/(?<!\r)\n/g, "\r\n");
  // A digest needs `crypto.subtle`, which a page off a secure origin lacks. A
  // failed digest matches nothing, so the list is asked for as it was before.
  const digests = [content, crlf].map((text) =>
    digestOf(text).then(
      (digest): string | null => digest,
      (): string | null => null,
    ),
  );
  written.set(path, [...(written.get(path) ?? []), ...digests]);
}

/**
 * A press's save of `path` goes out now. The digest is known only from the answer, since the
 * backend restamps `modified`, so `pressEcho` waits on it: call the settle once it answers or fails.
 */
export function pressSending(path: string): () => void {
  if (running === 0) return () => {};
  let settle = () => {};
  const answered = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const out = sending.get(path) ?? new Set();
  out.add(answered);
  sending.set(path, out);
  return () => {
    out.delete(answered);
    if (out.size === 0) sending.delete(path);
    settle();
  };
}

/**
 * Whether a write event for `path` with `digest` echoes a press: the digest is one of the
 * texts a press wrote there, and the echo window is open (a press runs, or `ECHO_MS` after).
 * Asked only once the path's press saves still out have answered.
 */
export async function pressEcho(path: string, digest: string | null): Promise<boolean> {
  if (digest === null) return false;
  await Promise.all(sending.get(path) ?? []);
  prune();
  const digests = written.get(path);
  if (digests === undefined) return false;
  return (await Promise.all(digests)).includes(digest);
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
 * Run `work` once the todo write before it has settled. Each reads a note and saves it back,
 * so two at once would race, and a key after an `x` must read the line the `x` wrote (#2084).
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

/** Where an `x` left a row's todo, by the row as listed and as drawn, for a press read before it landed (#2080). */
const landed = new Map<string, { row: Row; at: number }>();
const keyOf = (hit: Row) => `${hit.path}\n${hit.line}\n${hit.text}`;

/** Point every key in `old`, and keys naming their line, at `to`, where an `x` left the todo. */
export function keepLanded(old: Row[], to: Row): void {
  const keys = new Set(old.map(keyOf));
  const now = Date.now();
  // Swept here, read only within one turn's wait, by which the list has redrawn.
  for (const [key, each] of landed) {
    if (now - each.at > TURN_WAIT_MS) landed.delete(key);
    else if (keys.has(keyOf(each.row))) keys.add(key);
  }
  for (const key of keys) landed.set(key, { row: to, at: now });
}

/**
 * The row a press reads: the line the last `x` wrote, for a row the note has moved past
 * (by its line, or its twins' count) while that line still says it; else the row as listed.
 */
export function landedRow<R extends Row>(
  text: string,
  hit: R,
  twins?: number[],
): { row: R; twins: number[] | undefined } {
  const lines = text.split("\n");
  const kept = landed.get(keyOf(hit));
  // A todo listed since at the row's old line goes as listed.
  const stale =
    lines[hit.line - 1] !== hit.text ||
    (twins !== undefined && lines.filter((each) => each === hit.text).length !== twins.length);
  const fresh =
    kept && Date.now() - kept.at <= TURN_WAIT_MS && lines[kept.row.line - 1] === kept.row.text;
  return stale && fresh
    ? { row: { ...hit, line: kept.row.line, text: kept.row.text }, twins: undefined }
    : { row: hit, twins };
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
 * saying them while their count holds, else where an `x` left it. Null where twins cannot be told apart, or none is left (#2087).
 */
export function followRow<R extends Row>(
  at: Row,
  twins: { nth: number; of: number },
  rows: R[],
): R | null {
  const here = rows.filter((row) => row.path === at.path);
  const same = here
    .filter((row) => row.text === at.text)
    .sort((one, other) => one.line - other.line);
  if (same.length > 0) return same.length === twins.of ? (same[twins.nth] ?? null) : null;
  const kept = landed.get(keyOf(at));
  const fresh = kept !== undefined && Date.now() - kept.at <= TURN_WAIT_MS;
  const went = fresh ? here.find((row) => keyOf(row) === keyOf(kept.row)) : undefined;
  // Its words changed on its own line: the edit stays there, and the write refuses it.
  return went ?? here.find((row) => row.line === at.line) ?? null;
}
