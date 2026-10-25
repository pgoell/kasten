import {
  markdownWords,
  offsetOf,
  pageWords,
  pdfWords,
  rangeAt,
  sectionWords,
  textWords,
} from "@/lib/rsvp-sources";

/** The words as text, a paragraph's end written as `¶` after its word. */
function read(words: { text: string; paragraph: boolean }[]): string {
  return words.map((word) => (word.paragraph ? `${word.text}¶` : word.text)).join(" ");
}

describe("markdownWords", () => {
  it("drops the frontmatter and the markup, and ends a paragraph at each block", () => {
    const note = [
      "---",
      "type: Note",
      "---",
      "# A **bold** title",
      "",
      "Some _text_ with [a link](https://x.y) and [[Target|an alias]].",
      "",
      "- [ ] one item",
      "- two `code`",
      "",
      "```js",
      "skipped();",
      "```",
      "> [!note] Callout title",
      "> body",
    ].join("\n");
    expect(read(markdownWords(note))).toBe(
      "A bold title¶ Some text with a link and an alias.¶ one item¶ two code¶ Callout title body¶",
    );
  });

  it("counts offsets in the whole note, frontmatter included", () => {
    const note = "---\na: 1\n---\nHello **world**";
    const words = markdownWords(note);
    expect(words.map((word) => [word.text, note.slice(word.offset, word.offset + 2)])).toEqual([
      ["Hello", "He"],
      ["world", "wo"],
    ]);
  });

  it("reads a wikilink without an alias as its target", () => {
    expect(read(markdownWords("See [[Some Note]] now"))).toBe("See Some Note now¶");
  });

  it("reads a table row by row", () => {
    expect(read(markdownWords("| a | b |\n| --- | --- |\n| c | d |"))).toBe("a b¶ c d¶");
  });
});

describe("pageWords", () => {
  it("breaks words at line ends and joins a hyphenated word", () => {
    const items = [
      { str: "The first", hasEOL: true },
      { str: "line ends in exam-", hasEOL: true },
      { str: "ple" },
      { str: " words." },
    ];
    const words = pageWords(items, 4);
    expect(read(words)).toBe("The first line ends in example words.¶");
    expect(words.every((word) => word.section === 4)).toBe(true);
  });

  it("reads every page in order, each its own section", async () => {
    const words = await pdfWords(2, async (page) => [{ str: `page ${page}` }]);
    expect(words.map((word) => [word.text, word.section])).toEqual([
      ["page", 0],
      ["1", 0],
      ["page", 1],
      ["2", 1],
    ]);
  });
});

describe("textWords", () => {
  it("ends a paragraph at each line of innerText", () => {
    expect(read(textWords("Title\nFirst para.\n\nSecond"))).toBe("Title¶ First para.¶ Second¶");
  });
});

describe("a book section", () => {
  function section(html: string): Document {
    return new DOMParser().parseFromString(html, "text/html");
  }

  it("ends a paragraph where the block changes and skips script and style", () => {
    const doc = section(
      "<body><h1>Chap<i>ter</i> one</h1><style>p{}</style><p>First line<br>second.</p><p>Next</p><script>x()</script></body>",
    );
    expect(read(sectionWords(doc, 3))).toBe("Chapter one¶ First line second.¶ Next¶");
  });

  it("turns a word's offset into a range and back", () => {
    const doc = section("<body><p>Alpha <b>beta</b></p><p>gamma delta</p></body>");
    const words = sectionWords(doc, 0);
    for (const word of words) {
      const range = rangeAt(doc, word.offset);
      expect(range.startContainer.nodeValue?.slice(range.startOffset)).toMatch(
        new RegExp(`^${word.text}`),
      );
      expect(offsetOf(doc, range)).toBe(word.offset);
    }
  });
});
