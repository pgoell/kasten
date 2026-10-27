import { findWritten, holdsWritten } from "@/lib/book/find-quote";
import { highlightBlocks } from "@/lib/highlight";
import { quoteParagraphs } from "@/lib/html-take";
import { documentOf } from "./foliate-fake";

/** The one block a note holds, as the draw and the seek see it. */
function blockOf(note: string) {
  const [block] = highlightBlocks(note);
  if (block === undefined) throw new Error("the note holds no highlight");
  return block;
}

describe("a highlight whose quote the book holds as written", () => {
  it("is still found when it was written raw, before the escape existed", () => {
    // The book holds `\[x\]` literally. The note holds the same words raw, which
    // read back become `[x]`, a form the book does not hold: only the raw form matches.
    const note = "## Highlights\n\n> see \\[x\\] here\n\nChapter ^hl-abcdef\n";
    const doc = documentOf("see \\[x\\] here");

    expect(findWritten(doc, [blockOf(note).raw])[0]).not.toBeNull();
  });

  it("is still found when it was written through the escape", () => {
    const [written] = quoteParagraphs("match a\\.b");
    const note = `## Highlights\n\n> ${written}\n\nChapter ^hl-abcdef\n`;
    const doc = documentOf("match a\\.b");

    expect(findWritten(doc, [blockOf(note).raw])[0]).not.toBeNull();
  });

  it("is still held on a pdf page as written, which the seek asks", () => {
    expect(holdsWritten("see \\[x\\] here", ["see \\[x\\] here"])).toBe(true);
  });
});
