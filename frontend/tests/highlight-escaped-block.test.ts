import { highlightBlocks } from "@/lib/highlight";
import { quoteParagraphs } from "@/lib/html-take";

describe("highlightBlocks on a quote the take escaped", () => {
  it("reads the quote back as the book's words, not as the escaped line", () => {
    // The take writes the passage through the escape, so the note holds `\[` and `&#35;`.
    const [written] = quoteParagraphs("## Dump and - [ ] x in [[Chapter]]");
    const note = ["## Highlights", "", `> ${written}`, "", "Chapter One ^hl-abcdef", ""].join("\n");

    expect(highlightBlocks(note)[0]?.quote).toEqual(["## Dump and - [ ] x in [[Chapter]]"]);
  });
});
