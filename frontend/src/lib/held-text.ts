import { useSyncExternalStore } from "react";

/**
 * A new key, not the old shape under the same one: a tab of the build before still reads it as
 * one entry per path, and a list would throw there.
 */
const HELD_KEY = "kasten.held.2";
/** One entry per path, which that build wrote. Read in and removed. */
const OLD_KEY = "kasten.held";

/** Text the vault refused, kept for the note it was typed into. */
export interface Held {
  content: string;
  /** What the vault answered, or why nothing was asked of it. */
  reason: string;
  /** Whether the note stood conflicted, which it does again when reopened. */
  conflicted: boolean;
  /**
   * The vault text the buffer was based on. If the vault has moved past it, someone else wrote
   * the note. Absent from entries stored before this was kept.
   */
  base?: string;
  /**
   * The text of a write still in the air when this was typed. Either it landed (the vault holds
   * this) or not (the vault holds `base`), so nobody else wrote. Absent when none was in the air.
   */
  after?: string;
}

/** A held entry as the bar lists it. `entry` is kept by identity. */
export interface HeldRow {
  path: string;
  reason: string;
  conflicted: boolean;
  entry: Held;
}

/**
 * Held text by note path, oldest first, for the page's life and past it. A list, so a failed
 * write cannot lose text the buffer never showed. Module level, since a flush on leaving the
 * route or on pagehide outlives the hook that made it. Mirrored to `localStorage`.
 */
let store: Map<string, Held[]> | null = null;
let snapshot: HeldRow[] = [];
const listeners = new Set<() => void>();
/** Whether storage refused the last write, leaving the map ahead of it. */
let unwritten = false;

function parse<T>(raw: string | null): Record<string, T> {
  if (raw === null) return {};
  try {
    return JSON.parse(raw) as Record<string, T>;
  } catch (error) {
    // Someone else's value, or a half-written one: nothing in it is trusted as text.
    if (!(error instanceof SyntaxError)) throw error;
    return {};
  }
}

/**
 * Reads storage, merging the old key in on every read: a tab of the old build may write it again.
 * Blocked or full storage (a DOMException) reads as null; the map in memory still holds the text.
 */
function read(): Record<string, Held[]> | null {
  let raw: string | null;
  let old: string | null;
  try {
    raw = localStorage.getItem(HELD_KEY);
    old = localStorage.getItem(OLD_KEY);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    return null;
  }
  const held = parse<Held[]>(raw);
  for (const [path, entry] of Object.entries(parse<Held>(old))) {
    const at = held[path] ?? [];
    if (!at.some((each) => each.content === entry.content && each.base === entry.base)) {
      held[path] = [...at, entry];
    }
  }
  return held;
}

function same(a: Held, b: Held): boolean {
  return (
    a.content === b.content &&
    a.reason === b.reason &&
    a.conflicted === b.conflicted &&
    a.base === b.base &&
    a.after === b.after
  );
}

/**
 * Takes the map from storage again, since other tabs write it too. Read before every change: each
 * change writes the whole map, so an old read would wipe what another tab held. Unchanged entries
 * keep their object, since autosave tells entries apart by identity.
 */
function sync(): Map<string, Held[]> {
  const stored = read();
  const before = store ?? new Map<string, Held[]>();
  if (stored === null) {
    store = before;
  } else {
    store = new Map();
    for (const [path, entries] of Object.entries(stored)) {
      store.set(path, reuse(entries, before.get(path) ?? []));
    }
    // Storage refused the last write, so keep text held only here until one goes through, even if
    // another tab dropped it. That error is the cheaper one.
    if (unwritten) keepUnwritten(store, before);
  }
  snapshot = list(store);
  return store;
}

function reuse(entries: Held[], before: Held[]): Held[] {
  const kept = [...before];
  return entries.map((entry) => {
    const at = kept.findIndex((each) => same(each, entry));
    return at === -1 ? entry : (kept.splice(at, 1)[0] ?? entry);
  });
}

function keepUnwritten(held: Map<string, Held[]>, before: Map<string, Held[]>): void {
  for (const [path, entries] of before) {
    const at = held.get(path) ?? [];
    const missing = entries.filter((entry) => !at.includes(entry));
    if (missing.length > 0) held.set(path, [...at, ...missing]);
  }
}

function load(): Map<string, Held[]> {
  return store ?? sync();
}

function list(held: Map<string, Held[]>): HeldRow[] {
  // `=== true` because an entry another build wrote may lack the field.
  return [...held].flatMap(([path, entries]) =>
    entries.map((entry) => ({
      path,
      reason: entry.reason,
      conflicted: entry.conflicted === true,
      entry,
    })),
  );
}

function changed(held: Map<string, Held[]>): void {
  try {
    if (held.size === 0) localStorage.removeItem(HELD_KEY);
    else localStorage.setItem(HELD_KEY, JSON.stringify(Object.fromEntries(held)));
    // Remove the old key only after the new one is written, or the next read merges it back.
    localStorage.removeItem(OLD_KEY);
    unwritten = false;
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    unwritten = true;
  }
  // A new array only on change: useSyncExternalStore compares by identity and would loop.
  snapshot = list(held);
  for (const listener of listeners) listener();
}

/**
 * Keeps `entry` as text `path` holds until it is written or dropped. It replaces `replacing` (the
 * entry the buffer showed) when still listed, else one with the same text, else is appended.
 */
export function holdText(path: string, entry: Held, replacing?: Held | null): void {
  const held = sync();
  const at = [...(held.get(path) ?? [])];
  const mine = replacing ? at.indexOf(replacing) : -1;
  const index = mine === -1 ? at.findIndex((each) => each.content === entry.content) : mine;
  if (index === -1) at.push(entry);
  else at[index] = entry;
  held.set(path, at);
  changed(held);
}

/** Forget `entry` of `path`'s held text, or all of it when there is no entry. */
export function dropText(path: string, entry?: Held): void {
  const held = sync();
  const left = entry ? (held.get(path) ?? []).filter((each) => each !== entry) : [];
  if (left.length > 0) held.set(path, left);
  else held.delete(path);
  // Write even with nothing to delete: the read above may have pulled in another tab's change.
  changed(held);
}

/**
 * Carries held text along a move: `to` gives each path's new one, or nothing. Text moved onto a
 * path that holds text goes after it. Keyed by path, it would stay under a path the vault lost.
 */
export function moveHeld(to: (path: string) => string | undefined): void {
  moves.push(to);
  const held = sync();
  const moving = [...held].flatMap(([path, entries]) => {
    const next = to(path);
    return next === undefined || next === path ? [] : [{ path, next, entries }];
  });
  if (moving.length === 0) return;
  // Take every source out first, so paths that land on each other's move each list once.
  for (const { path } of moving) held.delete(path);
  for (const { next, entries } of moving) held.set(next, [...(held.get(next) ?? []), ...entries]);
  changed(held);
}

/**
 * Every move `moveHeld` carried, for the page's life. A write in the air answers after its note
 * may have moved, so it replays the later moves over its own path.
 */
const moves: ((path: string) => string | undefined)[] = [];

/** How many moves there have been, which a write reads as it goes out. */
export function movesMade(): number {
  return moves.length;
}

/** Where `path` is after the moves made since `since`; a move not touching it leaves it. */
export function movedTo(path: string, since: number): string {
  return moves.slice(since).reduce((at, to) => to(at) ?? at, path);
}

/**
 * The entry a note offers: the oldest typed into the note whose vault text is `vault`, or the
 * oldest of all while that is unknown. The autosave, the editor and the reload check share this.
 * Paths outlive notes, so an entry left by a deleted note would otherwise reach the next note at
 * that path, and `:w` would write it over.
 */
export function heldText(path: string, vault?: string): Held | undefined {
  const entries = heldTexts(path);
  return vault === undefined ? entries[0] : entries.find((entry) => belongsTo(entry, vault));
}

/**
 * Whether `entry` was typed into the note whose vault text is `vault`, by the frontmatter `id`
 * (kept on a move, new for a new note). Read from the text, so older entries answer too. No id
 * on either side counts as a match.
 */
function belongsTo(entry: Held, vault: string): boolean {
  // The base first: the reader may have edited the `id` line in the text.
  const mine = (entry.base === undefined ? undefined : idOf(entry.base)) ?? idOf(entry.content);
  const theirs = idOf(vault);
  return mine === undefined || theirs === undefined || mine === theirs;
}

/** The frontmatter's `id`, or undefined where the text has none. */
function idOf(text: string): string | undefined {
  const line = parts(text)?.block.find((each) => each.startsWith("id:"));
  return line?.slice("id:".length).trim() || undefined;
}

/** Every entry `path` holds, oldest first. */
export function heldTexts(path: string): readonly Held[] {
  return load().get(path) ?? [];
}

/** Another tab changed held text; the browser tells every tab but the writer. */
function storage(event: StorageEvent) {
  if (event.key !== HELD_KEY && event.key !== OLD_KEY && event.key !== null) return;
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

/** Every held entry with its note and why. Re-renders when one is held or let go. */
export function useHeld(): readonly HeldRow[] {
  return useSyncExternalStore(subscribe, current);
}

/** Forget the map in memory, so the next touch reads storage again. For tests. */
export function resetHeld(): void {
  store = null;
  snapshot = [];
  unwritten = false;
  moves.length = 0;
}

/**
 * Whether two texts are the same note with the `modified` line set aside. The backend stamps
 * `modified` on every PUT, and a keepalive write that landed after the page left this pair.
 */
export function sameText(a: string, b: string): boolean {
  return unstamped(a) === unstamped(b);
}

/** The keys the backend's `stamp` writes into a block that lacks them. */
const STAMPED = new Set(["id", "created", "type"]);

/** The block's lines bar `modified`, and everything from the closing fence on. */
function parts(text: string): { block: string[]; rest: string } | undefined {
  if (!text.startsWith("---\n")) return undefined;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return undefined;
  const block = text
    .slice(4, end)
    .split("\n")
    .filter((line) => !line.startsWith("modified:"));
  return { block, rest: text.slice(end) };
}

/**
 * Whether held text landed as the vault's `vault`: the same once `modified` is set aside, or as
 * `stamp` leaves it, adding `id`, `created` or `type` lines or a whole block. One way only: a
 * held line that the vault holds another value for did not land.
 */
export function landedAs(held: string, vault: string): boolean {
  if (sameText(held, vault)) return true;
  const theirs = parts(vault);
  if (theirs === undefined) return false;
  const ours = parts(held) ?? { block: [], rest: `\n---\n${held}` };
  const added = theirs.block.length - ours.block.length;
  if (theirs.rest !== ours.rest || added < 0) return false;
  if (theirs.block.slice(added).join("\n") !== ours.block.join("\n")) return false;
  const keyOf = (line: string) => line.split(":")[0] ?? "";
  const keys = new Set(ours.block.map(keyOf));
  return theirs.block.slice(0, added).every((line) => {
    const key = keyOf(line);
    return STAMPED.has(key) && !keys.has(key);
  });
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
