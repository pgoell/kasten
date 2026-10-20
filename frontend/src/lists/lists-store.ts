/**
 * The shared lists app's one module: the calls to `/share`, the writes that wait
 * for a connection, the live feed, and the memory the suggestions come from.
 * The screen holds none of it. It draws what `viewOf` and `suggestionsFor` give.
 */

export const LISTS = ["Einkauf", "Todo"];

export type Item = { line: number; text: string; done: boolean };

export type ListData = { name: string; sha: string | null; items: Item[] };

/**
 * A write the phone has made and the server has not yet taken. `before` counts
 * the open items with the text before the first send, so an answer lost after
 * the server wrote shows as one more afterwards.
 */
type OpBody =
  | { kind: "add"; list: string; text: string; before?: number }
  | { kind: "tick"; list: string; text: string; done: boolean }
  | { kind: "clear"; list: string };
export type Op = OpBody & { id: string };

export type Snapshot = {
  /** Each list as the server last gave it. */
  lists: Partial<Record<string, ListData>>;
  /** Writes not yet taken, oldest first. Kept in localStorage. */
  queue: Op[];
  /** Every item text each list has held, for suggestions. Kept in localStorage. */
  seen: Partial<Record<string, string[]>>;
  online: boolean;
  /** The EventSource is open, so the poll stands down. */
  live: boolean;
  /** Refusals, kept on screen until dismissed. */
  errors: string[];
  /** The session has expired: writes wait for a sign-in. */
  signIn: boolean;
};

export type ListsStore = {
  subscribe: (listener: () => void) => () => void;
  snapshot: () => Snapshot;
  add: (list: string, text: string) => void;
  tick: (list: string, text: string, done: boolean) => void;
  clear: (list: string) => void;
  dismissErrors: () => void;
  close: () => void;
};

const BASE = "/share";
// A write answered 409 is read again and sent again. Three tries in all, then it
// is refused rather than looped on.
const TRIES = 3;
const POLL_MS = 2000;
const MAX_SUGGESTIONS = 5;
const QUEUE_KEY = "kasten.lists.queue";
const SEEN_KEY = "kasten.lists.seen";

class HttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

/** The session expired: the server answered with the sign-in page, not the list. */
class SignInError extends Error {}

/**
 * A failure that says nothing about the write itself: the network is down, the
 * server broke, a conflict outlasted its tries, or the session expired. The write
 * stays queued until the next trigger.
 */
function transient(error: unknown): boolean {
  if (error instanceof TypeError || error instanceof SignInError) return true;
  return error instanceof HttpError && (error.status >= 500 || error.status === 409);
}

async function send<T>(method: string, path: string, body?: object): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    // A list read from a cache could show a tick that was already undone.
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  // An expired session answers with the sign-in page: a redirect, or HTML where JSON was asked for.
  if (res.redirected || res.status === 401 || res.status === 403) throw new SignInError();
  if (!res.ok) throw new HttpError(res.status);
  try {
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof SyntaxError) throw new SignInError();
    throw error;
  }
}

const listPath = (name: string) => `/lists/${encodeURIComponent(name)}`;

/**
 * The write one op makes against the list as it reads now, or none when the
 * list already says what the op asks for. A tick names its line from this read,
 * so a line that moved since the op was queued is found by its text instead.
 */
function requestFor(op: Op, list: ListData): { path: string; body: object } | null {
  const path = listPath(op.list);
  if (op.kind === "add") return { path: `${path}/items`, body: { text: op.text, sha: list.sha } };
  if (list.sha === null) return null;
  if (op.kind === "clear") return { path: `${path}/clear`, body: { sha: list.sha } };
  const item = list.items.find((found) => found.text === op.text && found.done !== op.done);
  if (!item) return null;
  return { path: `${path}/tick`, body: { line: item.line, done: op.done, sha: list.sha } };
}

function applyOp(items: Item[], op: Op): Item[] {
  if (op.kind === "add") return [...items, { line: -1, text: op.text, done: false }];
  if (op.kind === "clear") return items.filter((item) => !item.done);
  const at = items.findIndex((item) => item.text === op.text && item.done !== op.done);
  return at < 0 ? items : items.map((item, n) => (n === at ? { ...item, done: op.done } : item));
}

/** A list as the screen shows it: the server's copy with the queued writes laid over. */
export function viewOf(snap: Snapshot, list: string): Item[] {
  let items = snap.lists[list]?.items ?? [];
  for (const op of snap.queue) if (op.list === list) items = applyOp(items, op);
  return items;
}

function openCount(list: ListData, text: string): number {
  return list.items.filter((item) => !item.done && item.text === text).length;
}

const fold = (text: string) => text.toLocaleLowerCase("de-DE");

/**
 * The texts offered for what is typed: earlier items by their first letters
 * first, then by a letter run inside them. An item open on the list now is not
 * offered, since the point is to add the one that is missing.
 */
export function suggestionsFor(snap: Snapshot, list: string, typed: string): string[] {
  const needle = fold(typed.trim());
  if (!needle) return [];
  const open = new Set(
    viewOf(snap, list)
      .filter((item) => !item.done)
      .map((item) => fold(item.text)),
  );
  const found = new Map<string, string>();
  for (const text of snap.seen[list] ?? []) {
    if (!open.has(fold(text))) found.set(fold(text), text);
  }
  const all = [...found.entries()];
  const prefix = all.filter(([key]) => key.startsWith(needle)).map(([, text]) => text);
  const inside = all
    .filter(([key]) => !key.startsWith(needle) && key.includes(needle))
    .map(([, text]) => text);
  return [...prefix, ...inside].slice(0, MAX_SUGGESTIONS);
}

function load<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    // Something a tool wrote by hand: start empty rather than stop the page.
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}

const DRAIN_LOCK = "kasten.lists.drain";
let realmTail: Promise<void> = Promise.resolve();

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

/**
 * One drain at a time. Across tabs the browser's lock does it, so two tabs never
 * replay the same op. Where there is no lock, a chain does it within this realm.
 */
function exclusive(run: () => Promise<void>): Promise<void> {
  if (navigator.locks) return navigator.locks.request(DRAIN_LOCK, run);
  const next = realmTail.then(run);
  realmTail = next.catch(() => undefined);
  return next;
}

export function createListsStore(): ListsStore {
  let snap: Snapshot = {
    lists: {},
    queue: load<Op[]>(QUEUE_KEY, []),
    seen: load<Record<string, string[]>>(SEEN_KEY, {}),
    online: navigator.onLine,
    live: false,
    errors: [],
    signIn: false,
  };
  const listeners = new Set<() => void>();
  // Every sync waits for the one before it, so a list read never overtakes a
  // write that is still on its way up.
  let chain: Promise<void> = Promise.resolve();

  function update(patch: Partial<Snapshot>): void {
    snap = { ...snap, ...patch };
    for (const listener of listeners) listener();
  }

  // Every change reads the queue fresh. Another tab may have changed it since this
  // one last looked, and a whole-queue write from a stale copy would undo that.
  function readQueue(): Op[] {
    return load<Op[]>(QUEUE_KEY, []);
  }

  function setQueue(queue: Op[]): void {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    update({ queue });
  }

  function dequeue(id: string): void {
    setQueue(readQueue().filter((op) => op.id !== id));
  }

  function patchQueued(op: Op): void {
    setQueue(readQueue().map((queued) => (queued.id === op.id ? op : queued)));
  }

  function remember(name: string, texts: string[]): void {
    const known = snap.seen[name] ?? [];
    const fresh = [...new Set(texts)].filter((text) => !known.includes(text));
    if (fresh.length === 0) return;
    const seen = { ...snap.seen, [name]: [...known, ...fresh] };
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    update({ seen });
  }

  function put(list: ListData): void {
    update({ lists: { ...snap.lists, [list.name]: list } });
    remember(
      list.name,
      list.items.map((item) => item.text),
    );
  }

  function fail(message: string): void {
    if (!snap.errors.includes(message)) update({ errors: [...snap.errors, message] });
  }

  function getList(name: string): Promise<ListData> {
    return send<ListData>("GET", listPath(name));
  }

  /** One write: read the list, send, and on a stale sha read again and send again. */
  async function write(first: Op): Promise<void> {
    let op = first;
    for (let attempt = 1; ; attempt += 1) {
      const list = await getList(op.list);
      if (op.kind === "add" && op.before === undefined) {
        // Counted, and kept, before the first send, so a lost answer can be told from a lost write.
        op = { ...op, before: openCount(list, op.text) };
        patchQueued(op);
      }
      const request = requestFor(op, list);
      if (!request) return;
      try {
        put(await send<ListData>("POST", request.path, request.body));
        update({ signIn: false });
        return;
      } catch (error) {
        const stale = error instanceof HttpError && error.status === 409;
        if (!stale || attempt === TRIES) throw error;
      }
    }
  }

  /** Did an add land although its answer was lost? The list then holds one more open item with its text. */
  function landed(id: string): Promise<boolean> {
    const op = readQueue().find((queued) => queued.id === id);
    if (op?.kind !== "add" || op.before === undefined) return Promise.resolve(false);
    const { list, text, before } = op;
    return getList(list).then(
      (now) => openCount(now, text) > before,
      () => false,
    );
  }

  /** Sends the queue oldest first, from storage, and stops at the first write the network, server or session has not taken. */
  async function drainQueue(): Promise<void> {
    let op: Op | undefined = readQueue()[0];
    while (op && snap.online) {
      try {
        await write(op);
        dequeue(op.id);
      } catch (error) {
        if (error instanceof SignInError) update({ signIn: true });
        if (!transient(error)) {
          // The server refused it for good. Say so, and let the rest go up.
          fail(`Nicht gespeichert: ${op.list}`);
          dequeue(op.id);
        } else if (await landed(op.id)) {
          dequeue(op.id);
        } else {
          return;
        }
      }
      op = readQueue()[0];
    }
  }

  async function refresh(): Promise<void> {
    for (const name of LISTS) {
      try {
        put(await getList(name));
      } catch (error) {
        if (error instanceof SignInError) update({ signIn: true });
        if (!transient(error)) fail(`Liste ${name} nicht geladen`);
      }
    }
  }

  function sync(): void {
    chain = chain.then(() => exclusive(drainQueue)).then(refresh);
  }

  function enqueue(op: OpBody): void {
    if (op.kind === "add") remember(op.list, [op.text]);
    setQueue([...readQueue(), { ...op, id: newId() }]);
    sync();
  }

  const goOnline = () => {
    update({ online: true });
    sync();
  };
  const goOffline = () => update({ online: false });
  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);
  // Another tab changed the queue: show what it holds now.
  const onStorage = (event: StorageEvent) => {
    if (event.key === QUEUE_KEY) update({ queue: readQueue() });
  };
  window.addEventListener("storage", onStorage);

  // jsdom and older browsers have no EventSource, and the poll below covers them.
  let source: EventSource | undefined;
  if (typeof EventSource !== "undefined") {
    source = new EventSource(`${BASE}/events`);
    source.onopen = () => update({ live: true });
    source.onerror = () => update({ live: false });
    // Any event means the share folder changed. The payload is not read: a
    // refetch of both lists is the whole answer.
    source.onmessage = () => sync();
  }
  const poll = setInterval(() => {
    if (!snap.live) sync();
  }, POLL_MS);
  sync();

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => snap,
    add: (list, text) => enqueue({ kind: "add", list, text }),
    tick: (list, text, done) => enqueue({ kind: "tick", list, text, done }),
    clear: (list) => enqueue({ kind: "clear", list }),
    dismissErrors: () => update({ errors: [] }),
    close: () => {
      listeners.clear();
      source?.close();
      clearInterval(poll);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("storage", onStorage);
    },
  };
}
