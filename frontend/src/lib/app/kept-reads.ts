import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import { NoteMissing } from "@/lib/core/api";

/** Vault reads kept in IndexedDB so they open with no signal: /explanation/kasten-on-a-phone.md. */

const DATABASE = "kasten-reads";
const STORE = "queries";
/** Bump when a kept query's data changes shape, so old records are dropped, never read. */
const SCHEMA = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Kept {
  hash: string;
  data: unknown;
  updatedAt: number;
  schema: number;
}

/** Only what the vault holds: finance, tokens and the rest stay off the device. */
export function kept(key: QueryKey): boolean {
  const [head] = key;
  // `["note", path]` and not `["note", path, "history"]`.
  if (head === "note") return key.length === 2 && typeof key[1] === "string";
  return (
    head === "files" || head === "tags" || head === "mentions" || head === "log" || head === "todos"
  );
}

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "hash" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await open()).transaction(STORE, mode).objectStore(STORE);
}

function usable(record: Kept | undefined, now: number): record is Kept {
  return record !== undefined && record.schema === SCHEMA && now - record.updatedAt <= MAX_AGE_MS;
}

async function keep(query: Query): Promise<void> {
  const { data, dataUpdatedAt } = query.state;
  if (data === undefined) return;
  const record: Kept = { hash: query.queryHash, data, updatedAt: dataUpdatedAt, schema: SCHEMA };
  await done((await store("readwrite")).put(record));
}

/** A note the vault no longer has: its record must not stand in for it, now or next time. */
async function forget(query: Query): Promise<void> {
  query.setState({ data: undefined, dataUpdatedAt: 0 });
  await done((await store("readwrite")).delete(query.queryHash));
}

async function restore(client: QueryClient, query: Query): Promise<void> {
  const record = (await done((await store("readonly")).get(query.queryHash))) as Kept | undefined;
  if (!usable(record, Date.now()) || query.state.data !== undefined) return;
  // The vault said the note is gone while the record was being read.
  if (query.state.error instanceof NoteMissing) return;
  client.setQueryData(query.queryKey, record.data, { updatedAt: record.updatedAt });
}

/** Drop records past their age or from another schema. */
async function prune(): Promise<void> {
  const cursors = (await store("readwrite")).openCursor();
  const now = Date.now();
  await new Promise<void>((resolve, reject) => {
    cursors.onerror = () => reject(cursors.error);
    cursors.onsuccess = () => {
      const cursor = cursors.result;
      if (cursor === null) return resolve();
      if (!usable(cursor.value as Kept, now)) cursor.delete();
      cursor.continue();
    };
  });
}

/** A private window or a full disk refuses IndexedDB; the page then works as it did without it. */
function quietly(work: Promise<void>): void {
  work.catch((error: unknown) => {
    if (!(error instanceof DOMException)) throw error;
    console.warn("kasten: kept reads unavailable", error);
  });
}

/** Restore each kept query as it is first asked for, and keep each answer it gets. */
export function keepReads(client: QueryClient): () => void {
  quietly(prune());
  return client.getQueryCache().subscribe((event) => {
    if (!kept(event.query.queryKey)) return;
    if (event.type === "added") quietly(restore(client, event.query));
    else if (event.type === "updated" && event.action.type === "success")
      quietly(keep(event.query));
    else if (event.type === "updated" && event.action.type === "error") {
      if (event.action.error instanceof NoteMissing) quietly(forget(event.query));
    }
  });
}

/** Close and forget the database, which a test must do before deleting it. For tests. */
export async function forgetKeptReads(): Promise<void> {
  if (connection === null) return;
  (await connection).close();
  connection = null;
}
