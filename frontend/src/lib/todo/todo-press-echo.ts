import { digestOf } from "@/lib/vault/events/vault-events";

/**
 * The vault's echo of a todo press, which the pane need not hear twice. An event is an echo
 * only when its digest matches a text this press wrote; anybody else's edit still asks.
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
