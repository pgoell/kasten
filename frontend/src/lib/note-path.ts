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

/** What the typed input means, given every path in the vault. */
export function describeNotePath(input: string, paths: string[]): NotePathVerdict {
  // A vault path is relative and its separator is a single slash, so a doubled
  // or leading slash is a typo the vault would swallow anyway. Absorb it here
  // and the prompt names the folder the note really lands in.
  const typed = input.trim().replace(/\/+/g, "/").replace(/^\//, "");

  if (typed === "") return { kind: "empty" };
  if (typed.endsWith("/")) return { kind: "blocked", reason: "name the note" };
  // The same rule the vault applies, said here so the prompt can say it before
  // the request rather than after the refusal.
  if (typed.split("/").some((segment) => segment.startsWith("."))) {
    return { kind: "blocked", reason: "a name cannot start with a dot" };
  }

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
