import { digestOf } from "@/lib/vault-events";

/**
 * The vault's echo of a todo press, which the pane does not need to hear twice.
 *
 * A press writes one or more notes and then asks for the todo list once, after
 * the last write. `/api/events` then reports each of those writes too, and
 * every report would ask for the list again: a second and third fetch of a list
 * the press already read. So an event is the echo of a press only when its
 * digest is the digest of a text the press wrote to that path. A text typed
 * into the same note by anybody else carries another digest and still asks.
 */

/** How long after a press the echo of its writes may still arrive. */
const ECHO_MS = 3000;

/** Presses running now. A press can start before the last one has settled. */
let running = 0;
/** The digests of the texts each path was written with, by the presses that wrote it. */
const written = new Map<string, Promise<string>[]>();
/** Paths the running presses wrote, which take an expiry once the last one ends. */
const fresh = new Set<string>();
/** When the echo of a path's writes stops being one, once no press runs. */
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
  written.set(path, [...(written.get(path) ?? []), digestOf(content)]);
}

/**
 * Whether a write event for `path` with `digest` is the echo of a press: the
 * digest is one of the texts a press wrote to that path, and the echo window is
 * open, which it is while a press runs or for `ECHO_MS` after.
 */
export async function pressEcho(path: string, digest: string | null): Promise<boolean> {
  prune();
  const digests = written.get(path);
  if (digests === undefined || digest === null) return false;
  return (await Promise.all(digests)).includes(digest);
}
