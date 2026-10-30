/**
 * The archive folder. Its notes work like any other; only browsing lists leave them out.
 * The wikilink listing keeps them, so a link into the archive does not read as dead.
 */

import { ARCHIVE } from "@/lib/layout";

export { ARCHIVE };

/** Whether a note is in the archive, at any depth. Matches whole path components only. */
export function inArchive(path: string): boolean {
  return path === ARCHIVE || path.startsWith(`${ARCHIVE}/`) || path.includes(`/${ARCHIVE}/`);
}

export function visible(paths: string[], archive: boolean): string[] {
  return archive ? paths : paths.filter((path) => !inArchive(path));
}
