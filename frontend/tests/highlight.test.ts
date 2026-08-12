/**
 * The whole text of a note after a passage lands in it.
 *
 * Every case asserts the answer with `toBe` and none asserts a substring: this
 * is the format PR 6 reads back, so the exactness is the point of the file.
 */

import { addHighlight } from "@/lib/highlight";

/** A literature note before anything was taken out of the book. */
const NOTE = "---\nid: one\n---\n# Designing Data-Intensive Applications\n";

const QUOTE = "Systems that tolerate faults are called fault-tolerant.";
const SECOND = "A system that is reliable does what the user expects.";
const CHAPTER = "Storage and Retrieval";
const ID = "hl-a3f9c1";

/** The whole of `NOTE` with one highlight in it, whose quote is `lines`. */
function quoted(...lines: string[]): string {
  return `${NOTE}\n## Highlights\n\n${lines.join("\n")}\n\n${CHAPTER} ^${ID}\n`;
}

describe("addHighlight", () => {
  it("makes the section in a note that has none", () => {
    expect(addHighlight(NOTE, { text: QUOTE, chapter: CHAPTER }, ID)).toBe(
      `${NOTE}\n## Highlights\n\n> ${QUOTE}\n\n${CHAPTER} ^${ID}\n`,
    );
  });

  it("writes into a section that is there and empty", () => {
    const note = "# DDIA\n\n## Highlights\n";

    expect(addHighlight(note, { text: QUOTE, chapter: CHAPTER }, ID)).toBe(
      ["# DDIA", "", "## Highlights", "", `> ${QUOTE}`, "", `${CHAPTER} ^${ID}`, ""].join("\n"),
    );
  });

  it("leaves the blank line before the next heading where it was", () => {
    const note = ["# DDIA", "", "## Highlights", "", "## Notes", "", "- worth rereading", ""].join(
      "\n",
    );

    expect(addHighlight(note, { text: QUOTE, chapter: CHAPTER }, ID)).toBe(
      [
        "# DDIA",
        "",
        "## Highlights",
        "",
        `> ${QUOTE}`,
        "",
        `${CHAPTER} ^${ID}`,
        "",
        "## Notes",
        "",
        "- worth rereading",
        "",
      ].join("\n"),
    );
  });

  it("writes two paragraphs as one blockquote, joined by a lone >", () => {
    // A blank line would end the blockquote and leave the second paragraph as
    // prose sitting under the first.
    expect(addHighlight(NOTE, { text: `${QUOTE}\n\n${SECOND}`, chapter: CHAPTER }, ID)).toBe(
      quoted(`> ${QUOTE}`, ">", `> ${SECOND}`),
    );
  });

  it("reads a run of newlines as one break", () => {
    expect(addHighlight(NOTE, { text: `${QUOTE}\n\n\n${SECOND}`, chapter: CHAPTER }, ID)).toBe(
      quoted(`> ${QUOTE}`, ">", `> ${SECOND}`),
    );
  });

  it("reads a single newline as one break", () => {
    // Measured in Chromium: a selection from an `h1` into the paragraph under
    // it gives one newline rather than two, so the rule reads a run rather
    // than counting.
    expect(addHighlight(NOTE, { text: `${QUOTE}\n${SECOND}`, chapter: CHAPTER }, ID)).toBe(
      quoted(`> ${QUOTE}`, ">", `> ${SECOND}`),
    );
  });

  it("reads a carriage return and a line feed as one break", () => {
    expect(addHighlight(NOTE, { text: `${QUOTE}\r\n\r\n${SECOND}`, chapter: CHAPTER }, ID)).toBe(
      quoted(`> ${QUOTE}`, ">", `> ${SECOND}`),
    );
  });

  it("collapses every run of whitespace inside a paragraph to one space", () => {
    // The non-breaking space is the character that tells JavaScript's `\s`
    // apart from a hand-written class, and PR 6 needs the two sides to agree.
    const text = "Systems that   tolerate\tfaults are\u00a0called fault-tolerant.";

    expect(addHighlight(NOTE, { text, chapter: CHAPTER }, ID)).toBe(
      quoted("> Systems that tolerate faults are called fault-tolerant."),
    );
  });

  it("trims the ends of what was selected", () => {
    expect(addHighlight(NOTE, { text: `  ${QUOTE}\n\n`, chapter: CHAPTER }, ID)).toBe(
      quoted(`> ${QUOTE}`),
    );
  });

  it("leaves a paragraph that opens with a caret of its own alone", () => {
    // Written as `> > x` and stripped back to `> x`, which is PR 6's half of
    // the rule. Nothing here strips a leading `>` from the book's own words.
    expect(addHighlight(NOTE, { text: "> a quotation in the book", chapter: CHAPTER }, ID)).toBe(
      quoted("> > a quotation in the book"),
    );
  });

  it("collapses the chapter label the way it collapses the quote", () => {
    // Reachable in a real book: the nav parser falls back to the raw `title`
    // attribute where the entry holds no text (`epub.js:322`), and nothing
    // normalises that.
    const chapter = "Storage\nand    Retrieval";

    expect(addHighlight(NOTE, { text: QUOTE, chapter }, ID)).toBe(quoted(`> ${QUOTE}`));
  });

  it("writes one caret and the whole id it was handed", () => {
    // `newId("hl-")` already carries the prefix, so a format adding its own
    // spells `^hl-hl-b2c4d6`.
    expect(addHighlight(NOTE, { text: QUOTE, chapter: CHAPTER }, "hl-b2c4d6")).toBe(
      `${NOTE}\n## Highlights\n\n> ${QUOTE}\n\n${CHAPTER} ^hl-b2c4d6\n`,
    );
  });

  it("ends a note that ended with no newline with none", () => {
    // The only shape that reaches `appendUnderEdit`'s end-of-file branch: the
    // section is last and the note's last line is not blank.
    const note = ["# DDIA", "", "## Highlights", "", "> An older quote", "", "One ^hl-000001"].join(
      "\n",
    );

    expect(addHighlight(note, { text: QUOTE, chapter: CHAPTER }, ID)).toBe(
      [
        "# DDIA",
        "",
        "## Highlights",
        "",
        "> An older quote",
        "",
        "One ^hl-000001",
        "",
        `> ${QUOTE}`,
        "",
        `${CHAPTER} ^${ID}`,
      ].join("\n"),
    );
  });

  it("puts exactly one blank line between two highlights", () => {
    // The case the master spec asks for by name, and the one that fails the
    // moment somebody trims the block's leading newline as untidy.
    const once = addHighlight(NOTE, { text: QUOTE, chapter: CHAPTER }, ID);

    expect(addHighlight(once, { text: SECOND, chapter: "Replication" }, "hl-b2c4d6")).toBe(
      `${once}\n> ${SECOND}\n\nReplication ^hl-b2c4d6\n`,
    );
  });
});

describe("reading a highlight back", () => {
  it("recovers the paragraphs character for character", () => {
    // PR 6's half of the round trip, written as an assertion about the text
    // rather than as a function: strip a leading `>` and one space after it
    // from each quoted line, and a line left empty is the break between two
    // paragraphs. Nothing in this pull request calls it.
    const note = addHighlight(NOTE, { text: `${QUOTE}\n\n${SECOND}`, chapter: CHAPTER }, ID);
    const quote = note.split("\n").filter((line) => line.startsWith(">"));

    const paragraphs = quote
      .map((line) => line.replace(/^>( |$)/, ""))
      .join("\n")
      .split("\n\n");

    expect(paragraphs).toEqual([QUOTE, SECOND]);
  });
});
