import { useSyncExternalStore } from "react";

/**
 * A list of entries per path. A new key and not the old one under a new shape:
 * a tab of the build before, still open after the deploy, reads its key as one
 * entry per path, and a list there would throw in it.
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
   * The vault's text the buffer was based on, when it was known. A vault that
   * has moved past it by the reopening means somebody else wrote the note
   * meanwhile. Absent from entries stored before this was kept.
   */
  base?: string;
  /**
   * The text of a write still in the air that the held text was typed behind,
   * and which its own write named. Either that write landed and the vault
   * holds this, or it never arrived and the vault still holds `base`: both
   * mean nobody else wrote. Absent where no such write was in the air.
   */
  after?: string;
}

/** One held entry as the bar lists it, the entry itself carried by identity. */
export interface HeldRow {
  path: string;
  reason: string;
  conflicted: boolean;
  entry: Held;
}

/**
 * Every held text by note path, oldest first, for the life of the page and
 * past it. A list and not one entry: a failed write that replaced an entry
 * would lose text the buffer never showed, so every text stays until it is
 * written or dropped.
 *
 * Module-level rather than in the autosave hook, because the hook is the thing
 * that goes away: a flush on leaving the route fails after it has unmounted,
 * and a write on `pagehide` fails after the page has. Mirrored to
 * `localStorage` for that second case, read lazily on first touch so a test
 * or a reload sees what the last page left.
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
    // Somebody else's value under the key, or a half-written one. Nothing in
    // it can be trusted to be anybody's text.
    if (!(error instanceof SyntaxError)) throw error;
    return {};
  }
}

/**
 * A browser with site data blocked throws a `SecurityError` on any touch of
 * `localStorage`, and a full one a `QuotaExceededError` on a write. Either way
 * the map in memory still holds the text for as long as the page lives, which
 * is everything but the reload.
 *
 * The old key is read every time and not once: a tab of the old build may
 * write it again after this one moved it over.
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
 * Take the map from storage again, which other tabs write to as well.
 *
 * Read before every change and not only once: each change writes the whole
 * map, and one built from an old read would wipe what another tab held since.
 * An entry that has not changed keeps its object, because the autosave tells
 * the entry its buffer took from a later one by identity.
 */
function sync(): Map<string, Held[]> {
  const stored = read();
  const before = store ?? new Map<string, Held[]>();
  if (stored === null) {
    store = before;
  } else {
    store = new Map();
    for (const [path, entries] of Object.entries(stored)) {
      const kept = [...(before.get(path) ?? [])];
      store.set(
        path,
        entries.map((entry) => {
          const at = kept.findIndex((each) => same(each, entry));
          return at === -1 ? entry : (kept.splice(at, 1)[0] ?? entry);
        }),
      );
    }
    // Storage refused the last write, so what it lacks may be text held only
    // here. Kept until a write goes through, at the cost of bringing back an
    // entry another tab dropped meanwhile, which is the cheaper way to be wrong.
    if (unwritten) {
      for (const [path, entries] of before) {
        const at = store.get(path) ?? [];
        const missing = entries.filter((entry) => !at.includes(entry));
        if (missing.length > 0) store.set(path, [...at, ...missing]);
      }
    }
  }
  snapshot = list(store);
  return store;
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
    // Only once the new key holds its entries, and on every write: the next
    // read merges the old key in again, and would bring back what this dropped.
    localStorage.removeItem(OLD_KEY);
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

/**
 * Keep `entry` as text `path` holds until it is written or dropped.
 *
 * In the place of `replacing`, the entry the buffer showed and typed on, when
 * it is still listed. Else in the place of an entry of the same text, which is
 * the hide and the failure of one write holding it twice. Else beside the
 * rest: an entry the buffer never showed is still nowhere else.
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

/**
 * Forget `entry` of `path`'s held text, or all of it with no entry: it was
 * written, or the reader threw it away.
 */
export function dropText(path: string, entry?: Held): void {
  const held = sync();
  const left = entry ? (held.get(path) ?? []).filter((each) => each !== entry) : [];
  if (left.length > 0) held.set(path, left);
  else held.delete(path);
  // Written and announced even when there was nothing to delete: the read
  // above may have brought another tab's change the list has not shown yet.
  changed(held);
}

/**
 * Carry held text along a move, `to` answering each path's new one or nothing.
 *
 * The map is keyed by path, so text held for a note that is then moved would
 * stay listed under a path the vault no longer has, and opening the note at
 * its new one would never offer it again. Onto a path that holds text too,
 * after that text: both stay listed, each still to be dealt with.
 */
export function moveHeld(to: (path: string) => string | undefined): void {
  moves.push(to);
  const held = sync();
  const moving = [...held].flatMap(([path, entries]) => {
    const next = to(path);
    return next === undefined || next === path ? [] : [{ path, next, entries }];
  });
  if (moving.length === 0) return;
  // Every source taken out first, so a folder move whose paths land on each
  // other's carries each list once.
  for (const { path } of moving) held.delete(path);
  for (const { next, entries } of moving) held.set(next, [...(held.get(next) ?? []), ...entries]);
  changed(held);
}

/**
 * Every move `moveHeld` carried, for the life of the page.
 *
 * A write in the air answers after its note may have moved, and the text it
 * holds or drops belongs under the path the note has now, where `moveHeld`
 * already put the entry it carried. The write counts the moves as it goes out
 * and plays the later ones over its path when it answers.
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
 * The entry a note offers, the oldest. One answer for the autosave, the editor
 * opening on it and the pane deciding about a reload, so all three mean the
 * same text.
 */
export function heldText(path: string): Held | undefined {
  return load().get(path)?.[0];
}

/** Every entry `path` holds, oldest first. */
export function heldTexts(path: string): readonly Held[] {
  return load().get(path) ?? [];
}

/**
 * Another tab held or let go of text. The browser tells every tab but the one
 * that wrote, so the bar here follows a note held over there.
 */
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

/**
 * Every held entry, its note, why, and whether it was left standing conflicted
 * rather than refused, re-rendering when one is held or let go.
 */
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
 * Whether held text landed as the vault's `vault`: the same note once
 * `modified` is set aside, or what `stamp` makes of it on the way in, which is
 * an `id`, `created` or `type` line ahead of the block where it has none, and a
 * whole block where there is none. One way only: a held copy that set one of
 * those lines and finds another value there did not land.
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
