/**
 * The whole text of a note after a passage lands in it.
 *
 * Every case asserts the answer with `toBe` and none asserts a substring: this
 * is the format PR 6 reads back, so the exactness is the point of the file.
 */

import { addHighlight, highlightAt, highlightBlocks } from "@/lib/highlight";

/** A literature note before anything was taken out of the book. */
const NOTE = "---\nid: one\n---\n# Designing Data-Intensive Applications\n";

const QUOTE = "Systems that tolerate faults are called fault-tolerant.";
const SECOND = "A system that is reliable does what the user expects.";
const CHAPTER = "Storage and Retrieval";
const ID = "hl-a3f9c1";

/** The one-based line holding `text`, which is how a case names a cursor. */
function lineOf(note: string, text: string): number {
  return note.split("\n").findIndex((line) => line.includes(text)) + 1;
}

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
    const note = addHighlight(NOTE, { text: `${QUOTE}\n\n${SECOND}`, chapter: CHAPTER }, ID);

    expect(highlightBlocks(note)[0]?.quote).toEqual([QUOTE, SECOND]);
  });
});

describe("highlightBlocks", () => {
  // Every round trip below starts from paragraphs already in the shape the
  // writer leaves them, single spaces and no ends, so `addHighlight`'s own
  // normalising is the identity on them and no case carries a second copy of
  // the writer's rule.
  it("reads back the one paragraph the writer wrote", () => {
    const text = "One paragraph, already collapsed.";
    const blocks = highlightBlocks(addHighlight("", { text, chapter: CHAPTER }, ID));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.quote).toEqual([text]);
    expect(blocks[0]?.id).toBe(ID);
  });

  it("reads back the three paragraphs the writer wrote", () => {
    const three = [QUOTE, SECOND, "Reliability means continuing to work correctly."];
    const note = addHighlight(NOTE, { text: three.join("\n\n"), chapter: CHAPTER }, ID);

    expect(highlightBlocks(note)[0]?.quote).toEqual(three);
  });

  // The six the writer collapses on the way in, so these are not round trips:
  // each names the paragraphs it expects. The first three guard the two sides
  // agreeing on `\s`; the last three are the paragraph break.
  it("reads a run of spaces back as one space", () => {
    const note = addHighlight(
      NOTE,
      { text: "Systems that   tolerate faults.", chapter: CHAPTER },
      ID,
    );

    expect(highlightBlocks(note)[0]?.quote).toEqual(["Systems that tolerate faults."]);
  });

  it("reads a tab back as one space", () => {
    const note = addHighlight(
      NOTE,
      { text: "Systems that\ttolerate faults.", chapter: CHAPTER },
      ID,
    );

    expect(highlightBlocks(note)[0]?.quote).toEqual(["Systems that tolerate faults."]);
  });

  it("reads a non-breaking space back as one space", () => {
    const note = addHighlight(
      NOTE,
      { text: "Systems that tolerate faults.", chapter: CHAPTER },
      ID,
    );

    expect(highlightBlocks(note)[0]?.quote).toEqual(["Systems that tolerate faults."]);
  });

  it("reads a carriage return and a line feed as two paragraphs", () => {
    const note = addHighlight(NOTE, { text: `${QUOTE}\r\n\r\n${SECOND}`, chapter: CHAPTER }, ID);

    expect(highlightBlocks(note)[0]?.quote).toEqual([QUOTE, SECOND]);
  });

  it("reads three newlines as two paragraphs", () => {
    const note = addHighlight(NOTE, { text: `${QUOTE}\n\n\n${SECOND}`, chapter: CHAPTER }, ID);

    expect(highlightBlocks(note)[0]?.quote).toEqual([QUOTE, SECOND]);
  });

  it("reads one newline as two paragraphs", () => {
    const note = addHighlight(NOTE, { text: `${QUOTE}\n${SECOND}`, chapter: CHAPTER }, ID);

    expect(highlightBlocks(note)[0]?.quote).toEqual([QUOTE, SECOND]);
  });
});

describe("a block a hand has been over", () => {
  // All pins against the rule above, each named with what it guards. The
  // format promises a hand edit survives, so each of these is a note somebody
  // typed in rather than a note the writer left.
  const WRITTEN = addHighlight(NOTE, { text: QUOTE, chapter: CHAPTER }, ID);

  it("still parses with the blank line left as a line of spaces", () => {
    const note = WRITTEN.replace(`${QUOTE}\n\n`, `${QUOTE}\n   \n`);

    expect(highlightBlocks(note)[0]?.quote).toEqual([QUOTE]);
  });

  it("still parses with the anchor line left trailing spaces", () => {
    expect(highlightBlocks(WRITTEN.replace(`^${ID}`, `^${ID}  `))[0]?.quote).toEqual([QUOTE]);
  });

  it("joins a hand wrapped quote line back into one paragraph", () => {
    const note = WRITTEN.replace(
      `> ${QUOTE}`,
      "> Systems that tolerate faults\n> are called fault-tolerant.",
    );

    expect(highlightBlocks(note)[0]?.quote).toEqual([QUOTE]);
  });

  it("collapses a hand doubled space inside a line", () => {
    const note = WRITTEN.replace("tolerate faults", "tolerate  faults");

    expect(highlightBlocks(note)[0]?.quote).toEqual([QUOTE]);
  });

  it("gives back the caret a paragraph of the book's own carried", () => {
    const note = addHighlight(NOTE, { text: "> a quotation in the book", chapter: CHAPTER }, ID);

    expect(highlightBlocks(note)[0]?.quote).toEqual(["> a quotation in the book"]);
  });

  it("gives back a paragraph that was nothing but a caret", () => {
    const note = addHighlight(NOTE, { text: ">", chapter: CHAPTER }, ID);

    expect(highlightBlocks(note)[0]?.quote).toEqual([">"]);
  });

  it("names the first and last line of the block", () => {
    expect(highlightBlocks(WRITTEN)[0]).toMatchObject({
      from: lineOf(WRITTEN, QUOTE),
      to: lineOf(WRITTEN, ID),
    });
  });

  it("is still a block away from the Highlights heading", () => {
    // The anchor is the whole test, so a block moved elsewhere in the note
    // still works and nothing looks for the heading.
    const note = `${NOTE}\n## Notes\n\n> ${QUOTE}\n\n${CHAPTER} ^${ID}\n`;

    expect(highlightBlocks(note)[0]?.quote).toEqual([QUOTE]);
  });

  it("reads two highlights back in the order the note holds them", () => {
    const note = addHighlight(WRITTEN, { text: SECOND, chapter: "Replication" }, "hl-b2c4d6");

    expect(highlightBlocks(note).map((block) => block.quote)).toEqual([[QUOTE], [SECOND]]);
  });
});

describe("a block edited past recognition", () => {
  /** One highlight as the writer left it, for a hand edit to take a part off. */
  const WRITTEN = addHighlight(NOTE, { text: QUOTE, chapter: CHAPTER }, ID);

  it("is not a block with the anchor line deleted", () => {
    expect(highlightBlocks(WRITTEN.replace(`${CHAPTER} ^${ID}\n`, ""))).toEqual([]);
  });

  it("is not a block with the blank line deleted", () => {
    expect(highlightBlocks(WRITTEN.replace(`${QUOTE}\n\n`, `${QUOTE}\n`))).toEqual([]);
  });

  it("is not a block with the quoted run deleted", () => {
    expect(highlightBlocks(WRITTEN.replace(`> ${QUOTE}\n`, ""))).toEqual([]);
  });

  it("is not a block with five hex characters in the id", () => {
    expect(highlightBlocks(WRITTEN.replace(ID, "hl-a3f9c"))).toEqual([]);
  });

  it("is not a block with the id retyped in capitals", () => {
    expect(highlightBlocks(WRITTEN.replace(ID, "hl-A3F9C1"))).toEqual([]);
  });

  it("is not a block with the run edited down to a lone caret", () => {
    // An empty quote is a question the finder should never be asked.
    expect(highlightBlocks(WRITTEN.replace(`> ${QUOTE}`, ">"))).toEqual([]);
  });

  it("answers null for a cursor inside a run edited down to a lone caret", () => {
    const note = WRITTEN.replace(`> ${QUOTE}`, ">");

    expect(highlightAt(note, lineOf(note, ">"))).toBeNull();
  });

  it("reads a plain blockquote with no anchor under it as no block", () => {
    // The case that keeps `<CR>` moving down: Enter reaches the same reader
    // `gf` does, so a rule firing on any blockquote would turn Enter on every
    // quoted paragraph in the vault into "open a book".
    const note = `${NOTE}\n> a quotation somebody wrote down\n\nAnd a plain line under it\n`;

    expect(highlightBlocks(note)).toEqual([]);
  });
});

describe("highlightAt", () => {
  const WRITTEN = addHighlight(NOTE, { text: QUOTE, chapter: CHAPTER }, ID);

  // The four places a cursor can sit in a block, of which a one paragraph
  // block has three lines: the chapter words and the anchor share the last.
  it("answers the quote for a cursor on the quote line", () => {
    expect(highlightAt(WRITTEN, lineOf(WRITTEN, QUOTE))).toEqual([QUOTE]);
  });

  it("answers the quote for a cursor on the blank line", () => {
    expect(highlightAt(WRITTEN, lineOf(WRITTEN, QUOTE) + 1)).toEqual([QUOTE]);
  });

  it("answers the quote for a cursor on the chapter and anchor line", () => {
    expect(highlightAt(WRITTEN, lineOf(WRITTEN, ID))).toEqual([QUOTE]);
  });

  it("answers the quote for a cursor on the second line of a two paragraph run", () => {
    const note = addHighlight(NOTE, { text: `${QUOTE}\n\n${SECOND}`, chapter: CHAPTER }, ID);

    expect(highlightAt(note, lineOf(note, SECOND))).toEqual([QUOTE, SECOND]);
  });

  it("answers null above the first block", () => {
    expect(highlightAt(WRITTEN, lineOf(WRITTEN, "## Highlights"))).toBeNull();
  });

  it("answers null below the last block", () => {
    expect(highlightAt(WRITTEN, WRITTEN.split("\n").length)).toBeNull();
  });

  it("answers null on the blank line between two blocks", () => {
    // pin: a rule that treated any blank line as some block's own would take
    // the gap between two highlights for part of the second.
    const note = addHighlight(WRITTEN, { text: SECOND, chapter: "Replication" }, "hl-b2c4d6");

    expect(highlightAt(note, lineOf(note, SECOND) - 1)).toBeNull();
  });
});
