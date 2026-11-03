/**
 * Dumps typed here that the vault does not have yet. Each is written to IndexedDB before a send and
 * removed on a 2xx, so a lost signal loses nothing. Id and date, set at typing, make resends safe.
 * Sends go oldest first and stop at a failure a later try can pass. A vault refusal stays with its
 * reason, and the rest go on, since no retry would change it.
 */

export interface Dump {
  /** Made at typing; the server writes a second POST with it as a no-op. */
  id: string;
  text: string;
  /** The typist's local day, `YYYY-MM-DD`, which names the daily note. */
  date: string;
  /** The order key. Milliseconds, bumped past the last one kept in this page. */
  typedAt: number;
  /** The vault's reason for a 4xx no retry will change. In memory only, so a reload asks again. */
  refused?: string;
}

/**
 * Why the last pass stopped. `sign-in` is oauth2-proxy's redirect or 401, never a vault refusal.
 * `server` is a 5xx, 408 or 429, which a later try may pass.
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
 * Writes a typed dump to the device, resolving once it is safe there. Sending is the caller's
 * next step, `flush`.
 */
export async function keep(text: string, date: string): Promise<Dump> {
  // Same-millisecond dumps would tie, leaving their order to the random ids.
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
      // Raw fetch: the client sees an opaque redirect as status 0. `manual` stops a login page's
      // 200 from counting as a landed dump.
      response = await fetch("/api/dump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: dump.text, date: dump.date, id: dump.id }),
        redirect: "manual",
        credentials: "same-origin",
      });
    } catch (error) {
      // Offline, or the answer was lost: the record stays, and its id makes a retry safe.
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
  // Nothing left to send, which another tab's flush can also cause, so the old failure is stale.
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
 * Send every waiting dump, one sender per page. A call made during a run gets the next pass, not
 * the running one, since a dump kept after the running pass read the store is in none of its sends.
 */
export function flush(): Promise<State> {
  if (running === null) {
    running = sweep().finally(() => {
      running = null;
    });
    return running;
  }
  // Also on rejection: the error goes to the running pass's caller, and the dumps still owe a pass.
  queued ??= running.then(rerun, rerun);
  return queued;
}

/** Hears the waiting list and last failure now and at each change. Returns the unsubscribe. */
export function subscribe(listener: (state: State) => void): () => void {
  listeners.add(listener);
  // The read can land after unsubscribing; a stale listener must not hear it (#426).
  void waiting().then((list) => {
    if (listeners.has(listener)) listener({ waiting: list, failure });
  });
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Send what waits now, and again when the signal or the page returns. No Background Sync: only
 * Chrome has it, and iOS waits for the app to open anyway. Safe to call twice.
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
  // Asks the browser to keep the store under storage pressure; a refusal changes nothing here.
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
