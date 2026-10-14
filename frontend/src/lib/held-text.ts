import { useSyncExternalStore } from "react";

const HELD_KEY = "kasten.held";

/** Text the vault refused, kept for the note it was typed into. */
export interface Held {
  content: string;
  /** What the vault answered, or why nothing was asked of it. */
  reason: string;
  /** Whether the note stood conflicted, which it does again when reopened. */
  conflicted: boolean;
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
let snapshot: { path: string; reason: string }[] = [];
const listeners = new Set<() => void>();

/**
 * A browser with site data blocked throws a `SecurityError` on any touch of
 * `localStorage`, and a full one a `QuotaExceededError` on a write. Either way
 * the map in memory still holds the text for as long as the page lives, which
 * is everything but the reload.
 */
function load(): Map<string, Held> {
  if (store !== null) return store;
  store = new Map();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(HELD_KEY);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
  }
  if (raw !== null) {
    try {
      for (const [path, entry] of Object.entries(JSON.parse(raw) as Record<string, Held>)) {
        store.set(path, entry);
      }
    } catch (error) {
      // Somebody else's value under the key, or a half-written one. Nothing in
      // it can be trusted to be anybody's text.
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  snapshot = list(store);
  return store;
}

function list(held: Map<string, Held>) {
  return [...held].map(([path, { reason }]) => ({ path, reason }));
}

function changed(held: Map<string, Held>): void {
  try {
    if (held.size === 0) localStorage.removeItem(HELD_KEY);
    else localStorage.setItem(HELD_KEY, JSON.stringify(Object.fromEntries(held)));
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
  }
  // A new array only here, because `useSyncExternalStore` compares by identity
  // and a fresh one per read would render forever.
  snapshot = list(held);
  for (const listener of listeners) listener();
}

/** Keep `entry` as the text `path` holds until it is written or dropped. */
export function holdText(path: string, entry: Held): void {
  const held = load();
  held.set(path, entry);
  changed(held);
}

/** Forget `path`'s held text: it was written, or the reader threw it away. */
export function dropText(path: string): void {
  const held = load();
  if (!held.delete(path)) return;
  changed(held);
}

export function heldText(path: string): Held | undefined {
  return load().get(path);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function current() {
  load();
  return snapshot;
}

/** Every held note and why, re-rendering when one is held or let go. */
export function useHeld(): readonly { path: string; reason: string }[] {
  return useSyncExternalStore(subscribe, current);
}

/** Forget the map in memory, so the next touch reads storage again. For tests. */
export function resetHeld(): void {
  store = null;
  snapshot = [];
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

function unstamped(text: string): string {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return text;
  const block = text
    .slice(4, end)
    .split("\n")
    .filter((line) => !line.startsWith("modified:"));
  return `---\n${block.join("\n")}${text.slice(end)}`;
}
