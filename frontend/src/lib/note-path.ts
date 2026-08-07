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
