/**
 * Where each note's cursor and scroll stood when last left, per device. Kept in localStorage,
 * never the vault. Only the path and three numbers are stored, never a line of the note.
 */

const KEY = "kasten.positions.1";

/** Enough for every note a person has open in a month, small enough to parse on each read. */
const CAP = 200;

/** The selection, and the `scrollTop` of the editor's scroller. */
export interface Position {
  anchor: number;
  head: number;
  top: number;
}

/**
 * A list of pairs and not an object. `JSON.parse` puts an integer-like key
 * such as `"2024"` ahead of every other, so an object would lose the order the
 * cap drops the oldest by.
 */
type Entry = [string, Position];

function isEntry(value: unknown): value is Entry {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string") return false;
  const position = value[1] as Partial<Position> | null;
  return (
    typeof position === "object" &&
    position !== null &&
    Number.isFinite(position.anchor) &&
    Number.isFinite(position.head) &&
    Number.isFinite(position.top)
  );
}

/** Blocked site data throws on removal too, and a stale value can stay then. */
function forget(): void {
  try {
    localStorage.removeItem(KEY);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
  }
}

/**
 * Read fresh on every call rather than cached, so a write from another tab
 * counts the next time this one asks.
 */
function load(): Entry[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (error) {
    // Blocked: the note opens at its top, as it did before there was a store.
    if (error instanceof DOMException) return [];
    throw error;
  }
  if (raw === null) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(isEntry)) return parsed;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  // Broken values would be read and thrown away on every open, so they go.
  forget();
  return [];
}

/** Where the note at `path` was left, or undefined when it never was. */
export function readPosition(path: string): Position | undefined {
  return load().find(([held]) => held === path)?.[1];
}

/**
 * Put the note at `path` last, as the most recent, and drop the oldest past
 * the cap. Two tabs writing race, and the last write wins for the whole list.
 */
export function writePosition(path: string, position: Position): void {
  const entries = load().filter(([held]) => held !== path);
  // Copied field by field, so whatever else the caller's object carries stays out.
  entries.push([path, { anchor: position.anchor, head: position.head, top: position.top }]);
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-CAP)));
  } catch (error) {
    // Blocked, or full. A cursor is not worth an editor that stops working.
    if (!(error instanceof DOMException)) throw error;
  }
}
