/**
 * The client's half of the frontmatter reader, kept in step with the backend's.
 *
 * `frontmatter.py` is the other half and it is settled as untouched, so every
 * case here names the Python behaviour it mirrors. The two are a second parser
 * for one format, which is the module's real cost: `PUT` takes whole text and
 * the client is the only thing that can write `reading:`.
 */

import { readField, setField } from "@/lib/note-frontmatter";

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

describe("setField", () => {
  it("replaces the line where it stands", () => {
    // In place, so the fields around it keep the order they were written in,
    // which is what `stamp()` does with `modified` (`frontmatter.py:85-87`).
    const text = note("---", "id: one", "reading: old", "author: Kleppmann", "---", "# DDIA");

    expect(setField(text, "reading", CFI)).toBe(
      note("---", "id: one", `reading: ${CFI}`, "author: Kleppmann", "---", "# DDIA"),
    );
  });

  it("appends a field the block has not got above the closing fence", () => {
    const text = note("---", "id: one", "created: then", "modified: now", "---", "# DDIA");

    expect(setField(text, "reading", CFI)).toBe(
      note("---", "id: one", "created: then", "modified: now", `reading: ${CFI}`, "---", "# DDIA"),
    );
  });

  it("mints a block for a note that has none", () => {
    expect(setField("# DDIA\n", "reading", CFI)).toBe(
      note("---", `reading: ${CFI}`, "---", "# DDIA\n"),
    );
  });

  it("mints one above a horizontal rule rather than writing into it", () => {
    const text = note("---", "# DDIA");

    expect(setField(text, "reading", CFI)).toBe(
      note("---", `reading: ${CFI}`, "---", "---", "# DDIA"),
    );
  });

  it("leaves an indented line of the same name alone", () => {
    const text = note("---", "shelf:", "  reading: no", "---", "# DDIA");

    expect(setField(text, "reading", CFI)).toBe(
      note("---", "shelf:", "  reading: no", `reading: ${CFI}`, "---", "# DDIA"),
    );
  });

  it("keeps a note that is only a block", () => {
    expect(setField(note("---", "id: one", "---"), "reading", CFI)).toBe(
      note("---", "id: one", `reading: ${CFI}`, "---"),
    );
  });

  it("writes the value plain, so it reads back whole", () => {
    // YAML takes an epubcfi as a plain scalar: none of its colons is followed
    // by a space. A caller wanting to store a value carrying `: ` has to quote
    // it, and that caller does not exist.
    const written = setField("# DDIA", "reading", CFI);

    expect(written).toContain(`reading: ${CFI}`);
    expect(readField(written, "reading")).toBe(CFI);
  });
});
