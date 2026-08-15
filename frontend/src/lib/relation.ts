/**
 * `name:: [[target]]`, a typed link written as one line of a note.
 *
 * Dataview's inline field, which is what an Obsidian reader already knows. The
 * rendering is not here: `live-preview.ts` classes the name like every other
 * inline construct, and `note-search.tsx` groups backlinks by it.
 */

export interface Relation {
  /** The name in front of the separator, lowercase, hyphens allowed. */
  name: string;
  /** The wikilink target, trimmed, as written. */
  target: string;
}

/**
 * One relation line: an optional shallow indent, an optional bullet, the name,
 * the separator with its mandatory space, then the wikilink it points at.
 *
 * The space after `::` is not optional and Dataview's is. It is what makes
 * `GET /api/search?q=":: "` a candidate superset of every relation in the vault,
 * which is the whole reason there is no `/api/relations`.
 *
 * The indent stops at three because four opens a CommonMark code block, and a
 * code block should not become a relation. A bullet nested two levels deep and
 * a line indented with a tab go with it, and both are cheap to allow later.
 *
 * The target's own rule is the editor's parser's (`wikilink.ts:52`), so there is
 * one grammar for links rather than two: a bracket or a line break inside means
 * the `[[` opened nothing.
 */
const RELATION = /^ {0,3}(?:- )?([a-z][a-z-]*):: [ \t]*\[\[([^[\]\n]+)\]\]/;

export function readRelation(line: string): Relation | null {
  const found = RELATION.exec(line);
  const target = found?.[2]?.trim() ?? "";
  // A name of only spaces is no name, which the pattern above cannot say and
  // `wikilink.ts` says the same way.
  if (found?.[1] === undefined || target === "") return null;
  return { name: found[1], target };
}
