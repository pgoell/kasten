/**
 * The client's half of the frontmatter reader, kept in step with the backend's.
 *
 * `frontmatter.py` is the other half and it is settled as untouched, so every
 * case here names the Python behaviour it mirrors. The two are a second parser
 * for one format, which is the module's real cost: `PUT` takes whole text and
 * the client is the only thing that can write `reading:`.
 */

import { readField } from "@/lib/note-frontmatter";

const CFI = "epubcfi(/6/14!/4/2/2/1:0)";

/** A block and a body, joined the way a note holds them. */
function note(...lines: string[]): string {
  return lines.join("\n");
}

describe("readField", () => {
  it("answers the whole value, colons and all", () => {
    // The one that fails if the reader splits on every colon rather than the
    // first: an epubcfi carries one and the value is nothing without it.
    const text = note("---", "id: one", `reading: ${CFI}`, "---", "# DDIA");

    expect(readField(text, "reading")).toBe(CFI);
  });

  it("answers undefined for a field the block does not set", () => {
    const text = note("---", "id: one", "---", "# DDIA");

    expect(readField(text, "reading")).toBeUndefined();
  });

  it("answers undefined for a note with no block", () => {
    expect(readField("# DDIA\n\nreading: not in a block\n", "reading")).toBeUndefined();
  });

  it("reads an opening fence with no partner as a horizontal rule", () => {
    // `_split` at `frontmatter.py:40-55` takes a block only where a later line
    // is a fence too. Reading one that never ends as a block would swallow the
    // note under it.
    const text = note("---", `reading: ${CFI}`, "# DDIA");

    expect(readField(text, "reading")).toBeUndefined();
  });

  it("takes a fence carrying trailing spaces, and one ending in a carriage return", () => {
    // Python strips both ends of the line before comparing, and
    // `String.prototype.trim` agrees.
    const spaced = note("---   ", `reading: ${CFI}`, "---   ", "# DDIA");
    const returned = note("---\r", `reading: ${CFI}`, "---\r", "# DDIA");

    expect(readField(spaced, "reading")).toBe(CFI);
    expect(readField(returned, "reading")).toBe(CFI);
  });

  it("does not read an indented line as a field of its own", () => {
    // The anchor in `_KEY` at `frontmatter.py:21-26` is what makes an indented
    // line part of the field above it, which is what carries a nested mapping
    // through untouched.
    const text = note("---", "shelf:", "  reading: no", "---", "# DDIA");

    expect(readField(text, "reading")).toBeUndefined();
  });
});
