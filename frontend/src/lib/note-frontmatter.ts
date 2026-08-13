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

/** Where in `block` the line setting `name` is, or -1 where no line does. */
function fieldAt(block: string[], name: string): number {
  return block.findIndex((line) => KEY.exec(line)?.[1] === name);
}

/** The value `name` is set to in the note's block, or undefined where none is. */
export function readField(text: string, name: string): string | undefined {
  const block = split(text)?.block ?? [];
  const line = block[fieldAt(block, name)];
  // Everything after the first colon: a field name carries no colon, and an
  // epubcfi carries one that has to survive.
  return line === undefined ? undefined : line.slice(line.indexOf(":") + 1).trim();
}

/**
 * `text` with `name` set to `value`, minting the block where the note has none.
 *
 * The value goes in plain and unquoted. YAML takes an epubcfi as a scalar,
 * none of its colons being followed by a space, and a caller wanting to store a
 * value that carries `: ` has to quote it itself.
 */
export function setField(text: string, name: string, value: string): string {
  const line = `${name}: ${value}`;
  const parts = split(text);
  // No block, which a bare horizontal rule at the top of a note also reads as.
  // The note goes under the new one whole rather than being rewritten.
  if (parts === null) return [FENCE, line, FENCE, text].join("\n");

  const at = fieldAt(parts.block, name);
  const block =
    at === -1
      ? // At the foot of the block, above the closing fence, which is where
        // `stamp()` appends `modified` (`frontmatter.py:85-87`).
        [...parts.block, line]
      : // In place, so the fields around it keep the order they were written in.
        parts.block.map((held, index) => (index === at ? line : held));

  return [FENCE, ...block, FENCE, ...parts.body].join("\n");
}

/** The note without its block, which is what a reader of the note should see. */
export function noteBody(text: string): string {
  const parts = split(text);
  return parts === null ? text : parts.body.join("\n");
}
