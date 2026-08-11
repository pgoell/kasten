/**
 * The YAML block a note carries at the top, read and written from the client.
 *
 * A second reader for a format `backend/src/kasten_backend/frontmatter.py`
 * already reads, and that is the cost of the module rather than an oversight.
 * `PUT` takes whole text, the backend is settled as untouched, and the client is
 * the only thing that can write `reading:`, so the field has to be set in the
 * text before it is sent. Both halves are small and every case here mirrors a
 * named one over there.
 */

/** What opens and closes the block, on a line of its own. */
const FENCE = "---";

/**
 * A field's name, at the top level of the block. The mirror of `_KEY`
 * (`frontmatter.py:21-26`), anchored so an indented line is part of the field
 * above it rather than a field, which is what carries a list or a nested
 * mapping through untouched.
 *
 * One divergence, and it cannot matter: Python's `\w` is Unicode and
 * JavaScript's is not, so a field spelled `té` is a field over there and a
 * plain line here. This expression answers one question, "is this the line
 * setting `name`", and a name this side cannot spell is only ever a different
 * field.
 */
const KEY = /^([A-Za-z_][\w-]*)\s*:/;

/**
 * The block's lines and the note's, or null where the note has none.
 *
 * The mirror of `_split` (`frontmatter.py:40-55`): no block unless the first
 * line is a fence and a later line is one too. An opening fence with no partner
 * is a horizontal rule, and reading one as a block that never ends would
 * swallow the note under it. Both ends of the line are trimmed, the way Python
 * strips them, so `---   ` is a fence and so is one ending `---\r`.
 */
function split(text: string): { block: string[]; body: string[] } | null {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== FENCE) return null;

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FENCE);
  if (end === -1) return null;

  return { block: lines.slice(1, end), body: lines.slice(end + 1) };
}

/** The line of `block` setting `name`, or undefined where no line does. */
function lineFor(block: string[], name: string): string | undefined {
  return block.find((line) => KEY.exec(line)?.[1] === name);
}

/** The value `name` is set to in the note's block, or undefined where none is. */
export function readField(text: string, name: string): string | undefined {
  const line = lineFor(split(text)?.block ?? [], name);
  // Everything after the first colon: a field name carries no colon, and an
  // epubcfi carries one that has to survive.
  return line === undefined ? undefined : line.slice(line.indexOf(":") + 1).trim();
}
