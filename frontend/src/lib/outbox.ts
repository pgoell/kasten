/**
 * Dumps typed on this device that the vault does not have yet.
 *
 * A thought is written to IndexedDB before anything tries to send it, so a
 * phone with no signal, or an app closed on a train, loses nothing: the record
 * is the thought until a 2xx says the daily note has it. Only then does it go.
 *
 * Each record carries the id the server dedupes on, made once at typing. A
 * send whose answer is lost looks here exactly like one that never left, so
 * the record stays and goes again; the id is what stops that second send from
 * writing a second paragraph. It also carries the date read at typing, so a
 * dump typed before midnight and sent after lands in the day it belongs to.
 *
 * The sends go one at a time, oldest first, and stop at the first that fails
 * in a way a later try can pass, so the dump keeps the order it was typed in.
 * A dump the vault itself refuses stays, with the vault's reason, and the ones
 * after it go on: no later try will change that answer, and holding every
 * later thought behind it would be the loss this exists to prevent.
 */

export interface Dump {
  /** Made at typing; the server writes a second POST with it as a no-op. */
  id: string;
  text: string;
  /** The typist's local day, `YYYY-MM-DD`, which names the daily note. */
  date: string;
  /** The order key. Milliseconds, bumped past the last one kept in this page. */
  typedAt: number;
  /**
   * The vault's reason, where its last answer was a 4xx no retry will change.
   * Held by this page alone and never stored, so a reload forgets it until the
   * next send asks again.
   */
  refused?: string;
}

/**
 * Why the last pass stopped.
 *
 * `sign-in` is oauth2-proxy: its 302 to the login page, which `redirect:
 * "manual"` turns into an opaque redirect, or its 401 once a cookie has gone.
 * Neither reaches kasten, so neither is the vault refusing anything. `server`
 * is a 5xx, a 408 or a 429, which a later try may well get past.
 */
export type Failure =
  | { kind: "offline" }
  | { kind: "sign-in" }
  | { kind: "server"; message: string };

export interface State {
  waiting: Dump[];
  failure: Failure | null;
}

const DATABASE = "kasten-outbox";
const STORE = "dumps";
/** How often a page with something waiting tries again on its own. */
const RETRY_MS = 30_000;

let connection: Promise<IDBDatabase> | null = null;
let running: Promise<State> | null = null;
let queued: Promise<State> | null = null;
let failure: Failure | null = null;
const refusals = new Map<string, string>();
let lastTyped = 0;
let retry: ReturnType<typeof setTimeout> | null = null;
let started: (() => void) | null = null;
const listeners = new Set<(state: State) => void>();

function open(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

/** Settle once the transaction has committed, which is when the data is on disk. */
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Every waiting dump, oldest first. */
export async function waiting(): Promise<Dump[]> {
  const transaction = (await open()).transaction(STORE, "readonly");
  const request = transaction.objectStore(STORE).getAll();
  await committed(transaction);
  return (request.result as Dump[])
    .sort((a, b) => a.typedAt - b.typedAt)
    .map((dump) => {
      const refused = refusals.get(dump.id);
      return refused === undefined ? dump : { ...dump, refused };
    });
}

async function remove(id: string): Promise<void> {
  const transaction = (await open()).transaction(STORE, "readwrite");
  transaction.objectStore(STORE).delete(id);
  await committed(transaction);
}

async function announce(): Promise<State> {
  const state = { waiting: await waiting(), failure };
  for (const listener of listeners) listener(state);
  return state;
}

/**
 * Write a typed dump to the device, resolving once it is safely there.
 *
 * Sending is the caller's next step, `flush`, and not this one's: a thought is
 * only as safe as the write that holds it, so the write comes first and alone.
 */
export async function keep(text: string, date: string): Promise<Dump> {
  // Two dumps kept in one millisecond would otherwise tie, and a tie leaves
  // their order to the random ids.
  lastTyped = Math.max(Date.now(), lastTyped + 1);
  const dump = { id: crypto.randomUUID(), text, date, typedAt: lastTyped };
  const transaction = (await open()).transaction(STORE, "readwrite");
  transaction.objectStore(STORE).add(dump);
  await committed(transaction);
  await announce();
  return dump;
}

/** What a refusal says, the backend's `detail` where it gave one. */
async function message(response: Response): Promise<string> {
  const fallback = `POST /api/dump failed with ${response.status}`;
  try {
    const body: unknown = await response.json();
    const detail = (body as { detail?: unknown } | null)?.detail;
    return typeof detail === "string" ? detail : fallback;
  } catch (error) {
    // A proxy's HTML error page, a 502 with no body: not JSON, so no words.
    if (!(error instanceof SyntaxError)) throw error;
    return fallback;
  }
}

/** Send what waits, oldest first, until it is all sent or one send fails. */
async function pass(): Promise<void> {
  for (const dump of await waiting()) {
    let response: Response;
    try {
      // Raw fetch and not the openapi client: an opaque redirect has status 0
      // and no body, and the client has nothing to say about one. `manual`
      // keeps oauth2-proxy's 302 from being followed to a login page whose 200
      // would read as the dump having landed.
      response = await fetch("/api/dump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: dump.text, date: dump.date, id: dump.id }),
        redirect: "manual",
        credentials: "same-origin",
      });
    } catch (error) {
      // No signal, or the answer lost on the way back. Either way the record
      // stays, and the id makes the next try safe.
      if (!(error instanceof TypeError)) throw error;
      failure = { kind: "offline" };
      return;
    }

    if (response.type === "opaqueredirect" || response.status === 401) {
      failure = { kind: "sign-in" };
      return;
    }
    const { status } = response;
    if (status === 408 || status === 429 || status >= 500) {
      failure = { kind: "server", message: await message(response) };
      return;
    }
    if (!response.ok) {
      // Kept, never deleted: the thought is still the user's to rescue.
      refusals.set(dump.id, await message(response));
      await announce();
      continue;
    }

    refusals.delete(dump.id);
    await remove(dump.id);
    await announce();
  }
  // Reached with nothing left to try, which another tab's flush can also
  // cause, so an old failure no longer describes anything.
  failure = null;
}

/** One pass, the state after it, and the next try armed if anything waits. */
async function sweep(): Promise<State> {
  await pass();
  const state = await announce();
  if (state.waiting.length > 0 && retry === null) {
    retry = setTimeout(() => {
      retry = null;
      void flush();
    }, RETRY_MS);
  }
  return state;
}

/** The pass owed to every caller who asked while one ran. */
function rerun(): Promise<State> {
  queued = null;
  return flush();
}

/**
 * Send every waiting dump, one sender per page.
 *
 * A call while a flush runs gets the next pass, which starts once the running
 * one has ended, never the running one itself: a dump kept after that pass
 * read the store is in none of its sends, and the caller is waiting to hear
 * whether it went. Every call made during one run shares that next pass.
 */
export function flush(): Promise<State> {
  if (running === null) {
    running = sweep().finally(() => {
      running = null;
    });
    return running;
  }
  // On a rejection too: the error reaches whoever awaited the running pass,
  // and the dumps still owe a pass of their own.
  queued ??= running.then(rerun, rerun);
  return queued;
}

/**
 * Hear the waiting list and the last failure, now and at every change.
 *
 * Returns the unsubscribe.
 */
export function subscribe(listener: (state: State) => void): () => void {
  listeners.add(listener);
  // The read can land after an unsubscribe or a reset, and a listener that
  // sets component state must not hear it once its page is gone (#426).
  void waiting().then((list) => {
    if (listeners.has(listener)) listener({ waiting: list, failure });
  });
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Send what waits now, and again whenever the signal or the page comes back.
 *
 * No Background Sync: Chrome alone has it, and a dump waiting for the app to be
 * opened again is the same wait iOS gives everything. Safe to call twice.
 */
export function start(): void {
  if (started !== null) return;
  const onOnline = () => void flush();
  const onVisible = () => {
    if (document.visibilityState === "visible") void flush();
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  started = () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
  // Asked so the browser does not clear the store under storage pressure. A
  // refusal changes nothing here: the store works the same either way.
  void navigator.storage?.persist?.();
  void flush();
}

/** Forget this page's state and let go of the database, as a reload would. For tests. */
export async function reset(): Promise<void> {
  await running;
  await queued;
  started?.();
  started = null;
  if (retry !== null) clearTimeout(retry);
  retry = null;
  failure = null;
  refusals.clear();
  lastTyped = 0;
  listeners.clear();
  if (connection !== null) (await connection).close();
  connection = null;
}
