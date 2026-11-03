/**
 * What a typed path means, decided away from the prompt. The prompt shows the verdict and Enter
 * obeys it, so the table of cases is unit-tested without a DOM.
 */

import { INBOX } from "@/lib/layout";

export type NotePathVerdict =
  | { kind: "empty" }
  | { kind: "blocked"; reason: string }
  | { kind: "open"; path: string }
  | { kind: "create"; path: string; newFolder?: string };

const SUFFIX = ".md";

/**
 * The formats the reader opens, in the order the vault prefers them. `GET /api/books/{note}` keeps
 * the same order, so the two lists agree. A pdf is often a paper or a deck, so it is a `Source`.
 */
const FORMATS = [
  { suffix: ".epub", folder: "02 Books", type: "Book" },
  { suffix: ".pdf", folder: "02 Documents", type: "Source" },
] as const;

/** What the reader opens, in the order the vault prefers them. */
export const BOOK_SUFFIXES = FORMATS.map((format) => format.suffix);

/**
 * The type a note holding this book gets. Takes the book's path, since the note's path says
 * nothing about which format sits beside it.
 */
export function bookType(book: string): string {
  return FORMATS.find((format) => book.toLowerCase().endsWith(format.suffix))?.type ?? "Book";
}

/**
 * Characters a note name may not carry. The first eight are refused by a path or filesystem, `/`
 * above all. The last four cannot sit inside a `[[link]]`.
 */
const ILLEGAL = /[/\\:*?"<>|#^[\]]/g;

/** The longest a name taken from somewhere else gets. */
const NAME_LIMIT = 80;

/**
 * One name from outside the vault, cut down to one the vault takes. Empty where nothing legal is
 * left, which callers read as "no name".
 */
export function safeName(raw: string): string {
  return (
    raw
      .replace(ILLEGAL, " ")
      .replace(/\s+/g, " ")
      .slice(0, NAME_LIMIT)
      // The cut above can leave a trailing dot or space, and a leading dot is refused.
      .replace(/^[.\s]+/, "")
      .replace(/[.\s]+$/, "")
  );
}

/** A book and the note beside it, as an upload files them. */
export interface BookNote {
  /** What both files are called, without either suffix. */
  name: string;
  book: string;
  note: string;
}

/**
 * Where the picked file belongs, and what its note is called. The file keeps its own name and
 * suffix, and the suffix picks the folder. The pair lands in the inbox, since filing is a decision.
 */
export function bookNote(fileName: string): BookNote | null {
  const lowered = fileName.toLowerCase();
  const format = FORMATS.find((candidate) => lowered.endsWith(candidate.suffix));
  if (format === undefined) return null;

  const name = safeName(fileName.slice(0, -format.suffix.length));
  if (name === "") return null;

  const folder = `${INBOX}/${format.folder}`;
  return {
    name,
    book: `${folder}/${name}${format.suffix}`,
    note: `${folder}/${name}${SUFFIX}`,
  };
}

/**
 * Where a markdown file picked off disk lands, or null where none will do. It keeps its own name
 * in the inbox. The suffix comes off before the cut at 80, so `.md` does not use up the name.
 */
export function importedNote(fileName: string): string | null {
  const name = safeName(fileName.replace(/\.md$/i, ""));

  return name === "" ? null : `${INBOX}/${name}${SUFFIX}`;
}

/** The note's name, which is what every link to it carries. */
export function noteName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

/**
 * A vault path spelled for a URL. `encodeURI` leaves `#` and `?` raw, and they cut a URL short, so
 * only those two are escaped further. Notes keep `encodeURI`'s spelling, which the backend's move
 * matches on.
 */
export function encodePath(path: string): string {
  return encodeURI(path).replaceAll("#", "%23").replaceAll("?", "%3F");
}

/**
 * Collapse doubled slashes and drop a leading one, so the prompt names the real folder the path
 * lands in.
 */
function tidy(input: string): string {
  return input.trim().replace(/\/+/g, "/").replace(/^\//, "");
}

/** Whether any note sits under `folder`, which is the only way a folder exists. */
function holdsANote(paths: string[], folder: string): boolean {
  return paths.some((path) => path.startsWith(`${folder}/`));
}

/**
 * The blocked verdict when a note sits where a folder of the path must go. `resolve_path` in
 * backend/src/kasten_backend/vault.py refuses that too, so the prompt says it first.
 */
function noteInTheWay(paths: string[], segments: string[]): NotePathVerdict | null {
  let ancestor = "";
  for (const segment of segments) {
    ancestor += ancestor === "" ? segment : `/${segment}`;
    if (paths.includes(ancestor)) return { kind: "blocked", reason: "a note cannot be a folder" };
  }
  return null;
}

/** What the typed input means, given every path in the vault. */
export function describeNotePath(input: string, paths: string[]): NotePathVerdict {
  const typed = tidy(input);

  if (typed === "") return { kind: "empty" };
  if (typed.endsWith("/")) return { kind: "blocked", reason: "name the note" };
  // The vault's own rule, said here so the prompt can say it before the request.
  if (typed.split("/").some((segment) => segment.startsWith("."))) {
    return { kind: "blocked", reason: "a name cannot start with a dot" };
  }
  const blocked = noteInTheWay(paths, typed.split("/").slice(0, -1));
  if (blocked) return blocked;

  const path = typed.endsWith(SUFFIX) ? typed : `${typed}${SUFFIX}`;
  if (paths.includes(path)) return { kind: "open", path };

  const cut = path.lastIndexOf("/");
  if (cut === -1) return { kind: "create", path };

  const folder = path.slice(0, cut + 1);
  // A folder no note sits under is one the create would make.
  if (paths.some((other) => other.startsWith(folder))) return { kind: "create", path };
  return { kind: "create", path, newFolder: folder };
}

/**
 * What the typed input means when the prompt moves `source`, a folder. The note rules are dropped
 * and no `.md` is added. A trailing slash names the folder, the spelling Tab folds in. `open` is a
 * refusal for a folder, except at `source` itself, where there is nothing to do.
 */
export function describeFolderPath(
  input: string,
  paths: string[],
  source: string,
): NotePathVerdict {
  const typed = tidy(input).replace(/\/$/, "");

  if (typed === "") return { kind: "empty" };
  if (typed.split("/").some((segment) => segment.startsWith("."))) {
    return { kind: "blocked", reason: "a name cannot start with a dot" };
  }
  // Only the ancestors are checked here. A folder landing on a note is refused below.
  const blocked = noteInTheWay(paths, typed.split("/").slice(0, -1));
  if (blocked) return blocked;
  if (paths.includes(typed)) return { kind: "blocked", reason: "a note is already there" };
  // Before the collision check: a folder inside itself is the more exact refusal.
  if (typed.startsWith(`${source}/`)) {
    return { kind: "blocked", reason: "a folder cannot move inside itself" };
  }

  if (holdsANote(paths, typed)) return { kind: "open", path: typed };
  return { kind: "create", path: typed };
}
