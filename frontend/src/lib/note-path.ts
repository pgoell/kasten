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

const BOOK_SUFFIX = ".epub";

/** Where an uploaded book and its note land, until you file them somewhere. */
const BOOK_INBOX = "00 Inbox/02 Books";

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
 * The book keeps its own name. It used to take the name of whatever note was
 * in the pane, which threw the title away and pinned the book to a note that
 * was about something else. Nothing has to be open for this now.
 *
 * The pair lands in the inbox rather than at its final home, for the reason a
 * clipping does: filing is a decision, and a folder move carries both halves
 * of the pair at once.
 */
export function bookNote(fileName: string): BookNote | null {
  const name = safeName(fileName.replace(/\.epub$/i, ""));
  if (name === "") return null;

  return {
    name,
    book: `${BOOK_INBOX}/${name}${BOOK_SUFFIX}`,
    note: `${BOOK_INBOX}/${name}${SUFFIX}`,
  };
}

/** The note's name, which is what every link to it carries. */
export function noteName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

/**
 * The book that sits beside a note, which is the note's path with the suffix swapped.
 *
 * The whole sidecar convention is this line. Nothing stores a book's path, so
 * there is no field to keep in step with where the note went.
 */
export function bookPath(note: string): string {
  return note.replace(/\.md$/, ".epub");
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
