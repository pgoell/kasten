import type { components } from "@/lib/api-types";
import { client } from "@/lib/core/api-client";
import { noteName } from "@/lib/notes/links/note-path";
import { wikiLinkPath } from "@/lib/notes/links/wikilink";
import { setField } from "@/lib/notes/text/note-frontmatter";

/** One `type: Book` note, as `GET /api/library` reads it off the note and the file beside it. */
export type LibraryBook = components["schemas"]["LibraryBook"];
export type Status = LibraryBook["status"];

/** The values `s` steps through and the switch offers. `unread` is only ever worked out. */
export const CHOSEN = ["want", "reading", "finished", "dropped"] as const;

export const STATUS_WORDS: Record<Status, string> = {
  unread: "Not started",
  want: "Want to read",
  reading: "Reading",
  finished: "Finished",
  dropped: "Dropped",
};

export async function fetchLibrary(): Promise<LibraryBook[]> {
  const { data, response } = await client.GET("/api/library");
  if (!data) throw new Error(`GET /api/library failed with ${response.status}`);
  return data;
}

/** Each slash encoded too: the route reads the note's path after `cover/` whole. */
export function coverUrl(book: LibraryBook): string {
  return `/api/library/cover/${encodeURIComponent(book.path)}`;
}

/** A shelf is the folder a book sits in, named without the sort number in front: `01 Technical` is Technical. */
export function shelfName(folder: string): string {
  const last = folder.slice(folder.lastIndexOf("/") + 1);
  return last.replace(/^\d+\s+/, "") || "Vault";
}

/** Every folder that holds a book, the shelves a move can put one on. */
export function shelvesOf(books: readonly LibraryBook[]): string[] {
  return [...new Set(books.map((book) => book.folder))].sort();
}

export interface Group {
  name: string;
  books: LibraryBook[];
}

const newestRead = (a: LibraryBook, b: LibraryBook) =>
  (b.read_at ?? "").localeCompare(a.read_at ?? "") || a.title.localeCompare(b.title);
const byTitle = (a: LibraryBook, b: LibraryBook) => a.title.localeCompare(b.title);
// Want to read ahead of the rest of the pile, since somebody said so.
const upNext = (a: LibraryBook, b: LibraryBook) =>
  Number(b.status === "want") - Number(a.status === "want") || byTitle(a, b);

const GROUPS: { name: string; holds: Status[]; order: typeof byTitle }[] = [
  { name: "Reading", holds: ["reading"], order: newestRead },
  { name: "Up next", holds: ["want", "unread"], order: upNext },
  { name: "Done", holds: ["finished", "dropped"], order: newestRead },
];

/** Whether every word of `query` is in the book's title, author or shelf, ignoring case. */
export function matches(book: LibraryBook, query: string): boolean {
  const hay = `${book.title} ${book.author ?? ""} ${shelfName(book.folder)}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => hay.includes(word));
}

/** The books the list draws, grouped and in the order drawn. Empty groups are left out. */
export function grouped(
  books: readonly LibraryBook[],
  query: string,
  showHidden: boolean,
): Group[] {
  const shown = books.filter((book) => (showHidden || !book.hidden) && matches(book, query));
  return GROUPS.map(({ name, holds, order }) => ({
    name,
    books: shown.filter((book) => holds.includes(book.status)).sort(order),
  })).filter((group) => group.books.length > 0);
}

/** The status after `status` on `s`. A worked-out `unread` steps to the first chosen one. */
export function nextStatus(status: Status): (typeof CHOSEN)[number] {
  const at = CHOSEN.indexOf(status as (typeof CHOSEN)[number]);
  return CHOSEN[(at + 1) % CHOSEN.length] ?? "want";
}

export function withStatus(text: string, status: (typeof CHOSEN)[number]): string {
  return setField(text, "status", status);
}

/** Shown again writes `false` rather than dropping the key, since `setField` has no delete. */
export function withHidden(text: string, hidden: boolean): string {
  return setField(text, "hidden", hidden ? "true" : "false");
}

/** The `[[link]]` that names `path`: the bare name, or the path where another note shares it. */
export function linkTo(path: string, paths: readonly string[]): string {
  const stem = noteName(path);
  const name = wikiLinkPath(stem, [...paths]) === path ? stem : path.replace(/\.md$/, "");
  return `[[${name}]]`;
}

/**
 * `reading-now.md` naming `link` as the current book. The first link is the one `<leader>gc`
 * reads, so it is swapped in place and the rest of the hand-written note is kept.
 */
export function namingCurrent(text: string, link: string): string {
  const first = /\[\[[^[\]\n]+\]\]/.exec(text);
  if (first === null) return `${link}\n${text}`;
  return text.slice(0, first.index) + link + text.slice(first.index + first[0].length);
}

/** `x` of `n` as a whole percent, or null with no honest number. */
export function percent(book: LibraryBook): number | null {
  return book.progress === null ? null : Math.round(book.progress * 100);
}

/** When it was last read, in the reader's own words: today, yesterday, or a date. */
export function lastRead(book: LibraryBook, today: Date): string | null {
  if (book.read_at === null) return null;
  const at = new Date(book.read_at);
  if (Number.isNaN(at.getTime())) return null;
  const days = Math.round(
    (new Date(today.toDateString()).getTime() - new Date(at.toDateString()).getTime()) / 86_400_000,
  );
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
