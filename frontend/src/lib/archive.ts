/**
 * The folder holding what is finished, and what leaving it out means.
 *
 * An ordinary folder in the vault. Nothing here creates it, moves anything into
 * it or treats a note in it differently: `98 Archive/old.md` opens, saves,
 * renames and deletes like every other note. The one thing kasten does is leave
 * it out of the four places that go looking for something, because a finished
 * project's notes and its open checkboxes are true of the note and false of the
 * week.
 *
 * Two of those four are the backend's, where the archive is left out of the rg
 * pass itself: a search caps what it answers with, so an archive left in would
 * eventually push live notes out of the answer rather than merely lengthening
 * it. The other two are here, over a listing that always arrives whole.
 *
 * That listing is deliberately never filtered at the source. It is what resolves
 * a `[[wikilink]]`, and a link to an archived note reading as a dead one would
 * make a second note in the inbox out of a note the vault already holds. So
 * `gf` into the archive works whether the toggle is on or off, and only what
 * you go browsing through changes.
 *
 * The name is spelled here and in `Settings.archive_path` on the backend. Two
 * copies of a default, not two rules: the backend's is what its rg pass skips
 * and this one is what the tree hides, and a vault that renames the folder has
 * to say so in both.
 */

export const ARCHIVE = "98 Archive";

/**
 * Whether a note lives in the archive.
 *
 * A path component matched whole, so `98 Archived plans/live.md` is not in it.
 * Nested as well as top level, which is what the backend's glob does: see
 * `skipping` in `search.py` for why that one cannot be anchored.
 */
export function inArchive(path: string): boolean {
  return path === ARCHIVE || path.startsWith(`${ARCHIVE}/`) || path.includes(`/${ARCHIVE}/`);
}

/** The notes to show, which is all of them once the archive is asked for. */
export function visible(paths: string[], archive: boolean): string[] {
  return archive ? paths : paths.filter((path) => !inArchive(path));
}
