/**
 * What a typed path means, decided away from the prompt that shows it.
 *
 * The prompt renders the verdict and Enter obeys it, so the whole table of
 * cases answers to a unit test with no DOM in it.
 */

export type NotePathVerdict =
  | { kind: "empty" }
  | { kind: "blocked"; reason: string }
  | { kind: "open"; path: string }
  | { kind: "create"; path: string; newFolder?: string };

const SUFFIX = ".md";

/** The one folder in the vault for things not yet filed. */
const INBOX = "00 Inbox";

/**
 * The formats the reader opens, and what the vault does with each.
 *
 * `.epub` first, which is the order the vault resolves a pair in when a note
 * has one of each beside it. `GET /api/books/{note}` reads that same order off
 * its own copy, so the two lists must not disagree about which wins.
 *
 * The folder and the type differ because the files do. An epub is a book and
 * nothing else, while a pdf is as often a paper, a report or a deck, and both
 * `02 Books` and `type: Book` would file one of those under a word that is not
 * true. `Source` is the ontology's own name for something written elsewhere,
 * which is every one of them.
 */
const FORMATS = [
  { suffix: ".epub", folder: `${INBOX}/02 Books`, type: "Book" },
  { suffix: ".pdf", folder: `${INBOX}/02 Documents`, type: "Source" },
] as const;

/** What the reader opens, in the order the vault prefers them. */
export const BOOK_SUFFIXES = FORMATS.map((format) => format.suffix);

/**
 * What a note holding this file is, which the bookmark writes into its type.
 *
 * Takes the book's path and not the note's, because the note's says nothing:
 * the whole question is which of the pair is sitting beside it, and only the
 * vault knows that.
 */
export function bookType(book: string): string {
  return FORMATS.find((format) => book.toLowerCase().endsWith(format.suffix))?.type ?? "Book";
}

/**
 * What a note's name may not carry.
 *
 * The first eight are the characters a path or a filesystem refuses, `/` above
 * all: a name holding one would file the note in a folder nobody asked for.
 * The last four are legal in a filename and illegal inside a `[[link]]`, so a
 * note carrying one could not be linked to by name.
 */
const ILLEGAL = /[/\\:*?"<>|#^[\]]/g;

/** The longest a name taken from somewhere else gets. */
const NAME_LIMIT = 80;

/**
 * One name from outside the vault, cut down to something the vault will take.
 *
 * A page's headline and a book file's name both arrive from somewhere that has
 * never heard of this vault's rules, and both answer to the same ones. Answers
 * empty where nothing legal is left, which the callers read as "no name".
 */
export function safeName(raw: string): string {
  return (
    raw
      .replace(ILLEGAL, " ")
      .replace(/\s+/g, " ")
      .slice(0, NAME_LIMIT)
      // Trailing dots and spaces after the leading ones, because the cut above
      // can leave either, and a leading dot is a name the vault will not take.
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
 * Where the file you just picked belongs, and what its note is called.
 *
 * The file keeps its own name and its own suffix. It used to take the name of
 * whatever note was in the pane, which threw the title away and pinned the book
 * to a note that was about something else. Nothing has to be open for this now.
 *
 * The suffix picks the folder, so an epub and a pdf are filed apart. It also
 * decides whether there is anything to file at all: the name used to have
 * `.epub` appended whatever it arrived as, so picking `Ulysses.pdf` wrote
 * `Ulysses.pdf.epub` and the upload refused it for bytes that did not match a
 * name nobody chose.
 *
 * The pair lands in the inbox rather than at its final home, for the reason a
 * clipping does: filing is a decision, and a folder move carries both halves
 * of the pair at once.
 */
export function bookNote(fileName: string): BookNote | null {
  const lowered = fileName.toLowerCase();
  const format = FORMATS.find((candidate) => lowered.endsWith(candidate.suffix));
  if (format === undefined) return null;

  const name = safeName(fileName.slice(0, -format.suffix.length));
  if (name === "") return null;

  return {
    name,
    book: `${format.folder}/${name}${format.suffix}`,
    note: `${format.folder}/${name}${SUFFIX}`,
  };
}

/**
 * Where a markdown file picked off disk lands, and null where none will do.
 *
 * The file keeps its own name, the way a book does, and lands in the inbox for
 * the reason a book and a clipping do: filing is a decision, and it is not this
 * key's. The suffix comes off before the name is cleaned so `.md` is not what
 * the cut at 80 spends its last characters on, and goes back on afterwards.
 *
 * Nothing here looks at what is in the file. Frontmatter another notebook wrote
 * comes through untouched, the backend's `stamp` adding an `id`, a `created`
 * and a `modified` around whatever fields are already in the block.
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
 * The typed path with the slashes tidied.
 *
 * A vault path is relative and its separator is a single slash, so a doubled or
 * leading slash is a typo the vault would swallow anyway. Absorb it here and
 * the prompt names the folder the path really lands in.
 */
function tidy(input: string): string {
  return input.trim().replace(/\/+/g, "/").replace(/^\//, "");
}

/** Whether any note sits under `folder`, which is the only way a folder exists. */
function holdsANote(paths: string[], folder: string): boolean {
  return paths.some((path) => path.startsWith(`${folder}/`));
}

/**
 * Whether a path lands on a note the vault holds, or inside one.
 *
 * A note cannot be a folder, which `resolve_path` in
 * backend/src/kasten_backend/vault.py refuses for every ancestor of the path.
 * The listing already names the notes, so say it here rather than promise a
 * folder and hand back the vault's 400.
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
  // The same rule the vault applies, said here so the prompt can say it before
  // the request rather than after the refusal.
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
  // Folders exist only as the prefix of a note, so a folder no path starts with
  // is one the create would make.
  if (paths.some((other) => other.startsWith(folder))) return { kind: "create", path };
  return { kind: "create", path, newFolder: folder };
}

/**
 * What the typed input means when the prompt is moving `source`, a folder.
 *
 * The same verdicts a note's path reads, with the note-shaped rules taken out
 * and the folder-shaped ones put in. No `.md` is added: a folder has a name and
 * not a suffix. A trailing slash names the folder rather than waiting for more,
 * because that is the spelling Tab folds in from the list. `open` means the
 * path is taken, which for a folder is a refusal rather than an invitation,
 * except at `source` itself, where it means there is nothing to do.
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
  // Every segment, the last one included: a folder landing inside a note and a
  // folder landing on one are the same refusal from the vault, and the reason
  // the second one gives is the more useful of the two.
  const blocked = noteInTheWay(paths, typed.split("/").slice(0, -1));
  if (blocked) return blocked;
  if (paths.includes(typed)) return { kind: "blocked", reason: "a note is already there" };
  // Said before the collision below, because a folder inside itself is the more
  // exact reason and the vault refuses it on its own grounds.
  if (typed.startsWith(`${source}/`)) {
    return { kind: "blocked", reason: "a folder cannot move inside itself" };
  }

  if (holdsANote(paths, typed)) return { kind: "open", path: typed };
  return { kind: "create", path: typed };
}
