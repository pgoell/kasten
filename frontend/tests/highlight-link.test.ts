/**
 * A passage that carries a link of Kasten's own, written onto its anchor line.
 */

import { addHighlight } from "@/lib/highlight";

const NOTE = "# DDIA\n\n## Highlights\n";
const QUOTE = "A quote of the book.";
const CHAPTER = "Storage and Retrieval";
const ID = "hl-abcdef";
const LINK = "[12:34](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=754s)";

describe("addHighlight with a link", () => {
  it("#791 A8 a passage with a time link writes it on the anchor line, unescaped, before the chapter", () => {
    expect({
      alone: addHighlight(NOTE, { text: QUOTE, chapter: "", link: LINK }, ID),
      withChapter: addHighlight(NOTE, { text: QUOTE, chapter: CHAPTER, link: LINK }, ID),
    }).toEqual({
      alone: ["# DDIA", "", "## Highlights", "", `> ${QUOTE}`, "", `${LINK} ^${ID}`, ""].join("\n"),
      withChapter: [
        "# DDIA",
        "",
        "## Highlights",
        "",
        `> ${QUOTE}`,
        "",
        `${LINK} ${CHAPTER} ^${ID}`,
        "",
      ].join("\n"),
    });
  });
});
