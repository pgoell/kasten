import { findWritten } from "@/lib/find-quote";
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
    // The book reads `match a\.b`, and the note holds the same words, unescaped.
    const note = "## Highlights\n\n> match a\\.b\n\nChapter ^hl-abcdef\n";
    const doc = documentOf("match a\\.b");

    expect(findWritten(doc, [blockOf(note).raw])[0]).not.toBeNull();
  });

  it("is still found when it was written through the escape", () => {
    const [written] = quoteParagraphs("match a\\.b");
    const note = `## Highlights\n\n> ${written}\n\nChapter ^hl-abcdef\n`;
    const doc = documentOf("match a\\.b");

    expect(findWritten(doc, [blockOf(note).raw])[0]).not.toBeNull();
  });
});
