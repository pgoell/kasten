/**
 * The client's half of the frontmatter reader, kept in step with the backend's.
 *
 * `frontmatter.py` is the other half and it is settled as untouched, so every
 * case here names the Python behaviour it mirrors. The two are a second parser
 * for one format, which is the module's real cost: `PUT` takes whole text and
 * the client is the only thing that can write `reading:`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { landedAs, unstamped } from "@/lib/held-text";
import { parseConfig } from "@/lib/log/log-kinds";
import { logLines } from "@/lib/log/log-lines";
import { parseMyFoods } from "@/lib/log/my-foods";
import { belowFrontmatter } from "@/lib/markdown/frontmatter-language";
import { noteBody, readField, setField } from "@/lib/note-frontmatter";

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
    // Python strips the end of the opening line and both ends of the closing
    // one before comparing, and the reader here agrees.
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

  it("#651 I7 reads a note opening ` ---` as having no block, as frontmatter.py does", () => {
    // `_closing` wants the opening fence at the very start of the note: ` ---`
    // is a horizontal rule, so a field below it is the note's text.
    const text = note(" ---", 'color: "#fff"', "---", "# DDIA");

    expect({
      read: readField(text, "color"),
      set: setField(text, "reading", CFI),
    }).toEqual({
      read: undefined,
      set: note("---", `reading: ${CFI}`, "---", text),
    });
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

const CLOSERS: { name: string; note: string; body: string }[] = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, "../../backend/tests/fixtures/frontmatter_closers.json"),
    "utf8",
  ),
);

describe("#654 a block closes only on a fence at column 0, as frontmatter.py closes it", () => {
  it.each(CLOSERS.map((one) => [one.name, one] as const))("%s", (_, one) => {
    expect({
      noteBody: noteBody(one.note),
      editor: one.note.slice(belowFrontmatter(one.note)),
    }).toEqual({ noteBody: one.body, editor: one.body });
  });

  it("reads and writes no field above a spaced closer", () => {
    const text = note("---", "ref: x #a", " ---", "#real");

    expect({ read: readField(text, "ref"), set: setField(text, "reading", CFI) }).toEqual({
      read: undefined,
      set: note("---", `reading: ${CFI}`, "---", text),
    });
  });
});

/** `note` with each line that starts no dash swapped for `mark(index)`, its `\r` kept. */
function marked(text: string, mark: (index: number) => string): string {
  return text
    .split("\n")
    .map((line, index) =>
      line.trimStart().startsWith("-") ? line : mark(index) + (line.endsWith("\r") ? "\r" : ""),
    )
    .join("\n");
}

/** The indexes of the lines below the block, by the case's own answer. */
function below(one: { note: string; body: string }): number[] {
  const lines = one.note.split("\n");
  const start = lines.length - one.body.split("\n").length;
  return lines.flatMap((line, index) =>
    index >= start && !line.trimStart().startsWith("-") ? [index] : [],
  );
}

/** The numbers after `L` in the lines of `text` that carry one. */
function numbered(lines: string[]): number[] {
  return lines.flatMap((line) => /L(\d+)/.exec(line)?.slice(1).map(Number) ?? []);
}

describe("#1449 every reader reads below the closer frontmatter.py finds", () => {
  it.each(CLOSERS.map((one) => [one.name, one] as const))("%s", (_, one) => {
    const listed = marked(one.note, (index) => `- L${index}`);
    const stamped = marked(one.note, (index) => `modified: L${index}`);
    const start = one.note.split("\n").length - one.body.split("\n").length;
    const vault = marked(one.note, (index) =>
      index < start ? `modified: M${index}` : `modified: L${index}`,
    ).replace(/^(.*?\n)/, start > 0 ? "$1id: q\n" : "$1");

    expect({
      logLines: numbered(logLines(marked(one.note, (index) => `## Log\n- L${index}`))),
      parseConfig: parseConfig(listed).broken.map((line) => line.line - 1),
      parseMyFoods: parseMyFoods(listed).broken.map((line) => line.line - 1),
      unstamped: numbered(
        unstamped(stamped)
          .split("\n")
          .filter((line) => line.startsWith("modified")),
      ),
      landedAs: landedAs(stamped, vault),
    }).toEqual({
      logLines: below(one),
      parseConfig: below(one),
      parseMyFoods: below(one),
      unstamped: below(one),
      landedAs: true,
    });
  });

  it("keeps the bytes of a plain block, a modified-only block and an empty one", () => {
    expect([
      unstamped("---\nid: a\nmodified: x\n---\nb"),
      unstamped("---\nmodified: x\n---\nb"),
      unstamped("---\n---\nb"),
    ]).toEqual(["---\nid: a\n---\nb", "---\n\n---\nb", "---\n---\nb"]);
  });
});
