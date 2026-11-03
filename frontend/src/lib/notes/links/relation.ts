/**
 * `name:: [[target]]`, a typed link written as one line of a note. Dataview's inline field, which
 * an Obsidian reader knows. Rendering is in `live-preview-inline.ts`, and `note-search.tsx` groups
 * backlinks by it.
 */

export interface Relation {
  /** The name in front of the separator, lowercase, hyphens allowed. */
  name: string;
  /** The wikilink target, trimmed, as written. */
  target: string;
}

/**
 * One relation line: an optional shallow indent and bullet, the name, `:: ` with its mandatory
 * space, then the wikilink. The space is what makes `GET /api/search?q=":: "` a superset of every
 * relation, which the editor reads them off. Indent stops at three, since four opens a code block.
 * `graph.py` holds a copy; both follow `docs/reference/relation-format.md`.
 */
const RELATION = /^ {0,3}(?:- )?([a-z][a-z-]*):: [ \t]*\[\[([^[\]\n]+)\]\]/;

export function readRelation(line: string): Relation | null {
  const found = RELATION.exec(line);
  const target = found?.[2]?.trim() ?? "";
  // A name of only spaces is no name, as in `wikilink.ts`.
  if (found?.[1] === undefined || target === "") return null;
  return { name: found[1], target };
}
