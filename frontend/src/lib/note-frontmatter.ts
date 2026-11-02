/**
 * The YAML block at a note's top, read and written on the client. A second reader of
 * `backend/src/kasten_backend/frontmatter.py`: `PUT` takes whole text and only the client
 * writes `reading:`, so the field is set before sending. Keep each case mirroring the backend.
 */

const FENCE = "---";

/**
 * A top-level field name, mirroring `_KEY` in `frontmatter.py`. Anchored, so an indented
 * line stays part of the field above (lists, nested maps). Python's `\w` is Unicode and
 * this is not; a name this side cannot spell is only ever a different field.
 */
const KEY = /^([A-Za-z_][\w-]*)\s*:/;

/** Whether `line` opens or closes a block: at column 0, as `_fence` in `frontmatter.py` (#654). */
function fence(line: string | undefined): boolean {
  return line?.replace(/[ \t\r]+$/, "") === FENCE;
}

/**
 * The block's lines and the note's, or null without one. Mirrors `_split` in `frontmatter.py`.
 * A lone opening fence is a horizontal rule, not a block.
 */
function split(text: string): { block: string[]; body: string[] } | null {
  const lines = text.split("\n");
  if (!fence(lines[0])) return null;

  const end = lines.findIndex((line, index) => index > 0 && fence(line));
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
  // Keep everything after the first colon: an epubcfi value has colons of its own.
  return line === undefined ? undefined : line.slice(line.indexOf(":") + 1).trim();
}

/**
 * `text` with `name` set to `value`, adding the block if the note has none. The value is
 * written unquoted, as YAML reads an epubcfi as a scalar. A value with `: ` needs quoting.
 */
export function setField(text: string, name: string, value: string): string {
  const line = `${name}: ${value}`;
  const parts = split(text);
  // No block, or a lone rule at the top; the note is kept whole below the new block.
  if (parts === null) return [FENCE, line, FENCE, text].join("\n");

  const at = fieldAt(parts.block, name);
  const block =
    at === -1
      ? // Foot of the block, where `stamp()` appends `modified` in frontmatter.py.
        [...parts.block, line]
      : // In place, so neighbouring fields keep their order.
        parts.block.map((held, index) => (index === at ? line : held));

  return [FENCE, ...block, FENCE, ...parts.body].join("\n");
}

/** The note without its block: what a reader sees. */
export function noteBody(text: string): string {
  const parts = split(text);
  return parts === null ? text : parts.body.join("\n");
}
