import { useSyncExternalStore } from "react";

const HELD_KEY = "kasten.held";

/** Text the vault refused, kept for the note it was typed into. */
export interface Held {
  content: string;
  /** What the vault answered, or why nothing was asked of it. */
  reason: string;
  /** Whether the note stood conflicted, which it does again when reopened. */
  conflicted: boolean;
  /**
   * The vault's text the buffer was based on, when it was known. A vault that
   * has moved past it by the reopening means somebody else wrote the note
   * meanwhile. Absent from entries stored before this was kept.
   */
  base?: string;
}

/**
 * Every held text by note path, for the life of the page and past it.
 *
 * Module-level rather than in the autosave hook, because the hook is the thing
 * that goes away: a flush on leaving the route fails after it has unmounted,
 * and a write on `pagehide` fails after the page has. Mirrored to
 * `localStorage` for that second case, read lazily on first touch so a test
 * or a reload sees what the last page left.
 */
let store: Map<string, Held> | null = null;
let snapshot: { path: string; reason: string; conflicted: boolean }[] = [];
const listeners = new Set<() => void>();
/** Whether storage refused the last write, leaving the map ahead of it. */
let unwritten = false;

/**
 * A browser with site data blocked throws a `SecurityError` on any touch of
 * `localStorage`, and a full one a `QuotaExceededError` on a write. Either way
 * the map in memory still holds the text for as long as the page lives, which
 * is everything but the reload.
 */
function read(): Record<string, Held> | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(HELD_KEY);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    return null;
  }
  if (raw === null) return {};
  try {
    return JSON.parse(raw) as Record<string, Held>;
  } catch (error) {
    // Somebody else's value under the key, or a half-written one. Nothing in
    // it can be trusted to be anybody's text.
    if (!(error instanceof SyntaxError)) throw error;
    return {};
  }
}

function same(a: Held, b: Held): boolean {
  return (
    a.content === b.content &&
    a.reason === b.reason &&
    a.conflicted === b.conflicted &&
    a.base === b.base
  );
}

/**
 * Take the map from storage again, which other tabs write to as well.
 *
 * Read before every change and not only once: each change writes the whole
 * map, and one built from an old read would wipe what another tab held since.
 * An entry that has not changed keeps its object, because the autosave tells
 * the entry its buffer took from a later one by identity.
 */
function sync(): Map<string, Held> {
  const stored = read();
  const before = store ?? new Map<string, Held>();
  if (stored === null) {
    store = before;
  } else {
    store = new Map();
    for (const [path, entry] of Object.entries(stored)) {
      const kept = before.get(path);
      store.set(path, kept && same(kept, entry) ? kept : entry);
    }
    // Storage refused the last write, so what it lacks may be text held only
    // here. Kept until a write goes through, at the cost of bringing back an
    // entry another tab dropped meanwhile, which is the cheaper way to be wrong.
    if (unwritten) {
      for (const [path, entry] of before) if (!store.has(path)) store.set(path, entry);
    }
  }
  snapshot = list(store);
  return store;
}

function load(): Map<string, Held> {
  return store ?? sync();
}

function list(held: Map<string, Held>) {
  // `=== true` because an entry another build wrote may lack the field.
  return [...held].map(([path, { reason, conflicted }]) => ({
    path,
    reason,
    conflicted: conflicted === true,
  }));
}

function changed(held: Map<string, Held>): void {
  try {
    if (held.size === 0) localStorage.removeItem(HELD_KEY);
    else localStorage.setItem(HELD_KEY, JSON.stringify(Object.fromEntries(held)));
    unwritten = false;
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    unwritten = true;
  }
  // A new array only here, because `useSyncExternalStore` compares by identity
  // and a fresh one per read would render forever.
  snapshot = list(held);
  for (const listener of listeners) listener();
}

/** Keep `entry` as the text `path` holds until it is written or dropped. */
export function holdText(path: string, entry: Held): void {
  const held = sync();
  held.set(path, entry);
  changed(held);
}

/** Forget `path`'s held text: it was written, or the reader threw it away. */
export function dropText(path: string): void {
  const held = sync();
  held.delete(path);
  // Written and announced even when there was nothing to delete: the read
  // above may have brought another tab's change the list has not shown yet.
  changed(held);
}

export function heldText(path: string): Held | undefined {
  return load().get(path);
}

/**
 * Another tab held or let go of text. The browser tells every tab but the one
 * that wrote, so the bar here follows a note held over there.
 */
function storage(event: StorageEvent) {
  if (event.key !== HELD_KEY && event.key !== null) return;
  sync();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", storage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", storage);
  };
}

function current() {
  load();
  return snapshot;
}

/**
 * Every held note, why, and whether it was left standing conflicted rather
 * than refused, re-rendering when one is held or let go.
 */
export function useHeld(): readonly { path: string; reason: string; conflicted: boolean }[] {
  return useSyncExternalStore(subscribe, current);
}

/** Forget the map in memory, so the next touch reads storage again. For tests. */
export function resetHeld(): void {
  store = null;
  snapshot = [];
  unwritten = false;
}

/**
 * Whether two texts are the same note once the `modified` line is set aside.
 *
 * The backend stamps `modified` on every `PUT`, so the vault's copy of text we
 * sent never equals what was sent. A keepalive write that landed after the page
 * was gone leaves exactly that pair behind, and offering it again would be
 * offering the reader their own words as a quarrel.
 */
export function sameText(a: string, b: string): boolean {
  return unstamped(a) === unstamped(b);
}

/** `text` without its frontmatter's `modified` line, which every write restamps. */
export function unstamped(text: string): string {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return text;
  const block = text
    .slice(4, end)
    .split("\n")
    .filter((line) => !line.startsWith("modified:"));
  return `---\n${block.join("\n")}${text.slice(end)}`;
}
