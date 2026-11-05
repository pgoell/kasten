import { appendUnder, fencedLines, noteSectionOf, sectionOf } from "@/lib/notes/text/note-section";

/** Today's daily note as the vault holds it, log line and all. */
const DAILY = [
  "# 2026-08-10 Monday",
  "",
  "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
  "",
  "## Done",
  "- ✅ 2026-08-10 read the spec [[projects/kasten]] kt-000001",
  "",
  "## Time",
  "- 09:12-10:32 read the spec",
  "",
].join("\n");

describe("appendUnder", () => {
  it("puts the line at the end of the section, above the heading after it", () => {
    expect(appendUnder(DAILY, "## Done", "- ✅ 2026-08-10 buy milk kt-000002")).toBe(
      [
        "# 2026-08-10 Monday",
        "",
        "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
        "",
        "## Done",
        "- ✅ 2026-08-10 read the spec [[projects/kasten]] kt-000001",
        "- ✅ 2026-08-10 buy milk kt-000002",
        "",
        "## Time",
        "- 09:12-10:32 read the spec",
        "",
      ].join("\n"),
    );
  });

  it("makes the section at the end of a note that has none", () => {
    const note = ["# 2026-08-10 Monday", "", "[[01 Periodic/00 Daily/2026-08-09]]", ""].join("\n");

    expect(appendUnder(note, "## Done", "- ✅ 2026-08-10 buy milk kt-000002")).toBe(
      [
        "# 2026-08-10 Monday",
        "",
        "[[01 Periodic/00 Daily/2026-08-09]]",
        "",
        "## Done",
        "- ✅ 2026-08-10 buy milk kt-000002",
        "",
      ].join("\n"),
    );
  });
});

/** A note with a section under a section, and one after both. */
const BOOK = [
  "# Borges",
  "intro",
  "## The Aleph",
  "a point in space",
  "### Notes",
  "still the aleph",
  "## Ficciones",
  "labyrinths",
].join("\n");

describe("sectionOf", () => {
  it("runs from the heading to the next one of the same level", () => {
    expect(sectionOf(BOOK, "The Aleph")).toEqual({
      text: "## The Aleph\na point in space\n### Notes\nstill the aleph",
      line: 3,
    });
  });

  it("keeps the lower headings inside and stops at a higher one", () => {
    expect(sectionOf(BOOK, "Notes")).toEqual({ text: "### Notes\nstill the aleph", line: 5 });
  });

  it("runs the last section to the end of the note", () => {
    expect(sectionOf(BOOK, "Ficciones")).toEqual({ text: "## Ficciones\nlabyrinths", line: 7 });
    expect(sectionOf(BOOK, "Borges")?.text).toBe(BOOK);
  });

  it("matches the heading ignoring case and the space around it", () => {
    expect(sectionOf(BOOK, "  the aleph ")?.line).toBe(3);
  });

  it("answers null for a heading the note does not hold", () => {
    expect(sectionOf(BOOK, "Labyrinths")).toBeNull();
  });

  it("runs a section past a hash inside fenced code", () => {
    const note = "# A\n```bash\n# install\nnpm i\n```\nmore\n# B";

    expect(sectionOf(note, "A")).toEqual({
      text: "# A\n```bash\n# install\nnpm i\n```\nmore",
      line: 1,
    });
    expect(sectionOf("# A\n~~~\n# x\n~~~\nmore", "A")?.text).toBe("# A\n~~~\n# x\n~~~\nmore");
  });

  it("finds no heading inside fenced code", () => {
    expect(sectionOf("```\n# A\n```\n# A\nreal", "a")).toEqual({ text: "# A\nreal", line: 4 });
    expect(sectionOf("~~~\n# install\n~~~", "install")).toBeNull();
  });

  it("reads ATX headings only", () => {
    expect(sectionOf("Setext\n======\nbody", "Setext")).toBeNull();
    expect(sectionOf("#hashtag\nbody", "hashtag")).toBeNull();
  });

  it("an embed section ends at the next heading after a line of inline triple-backtick code", () => {
    expect(sectionOf("## A\n```x```\n## B\nb", "A")).toEqual({ text: "## A\n```x```", line: 1 });
  });
});

describe("noteSectionOf", () => {
  const FILED = `---\nid: 01\n# not a heading: yes\n---\n${BOOK}`;

  it("counts the line in the whole file, frontmatter and all", () => {
    expect(noteSectionOf(FILED, "The Aleph")).toEqual({
      text: "## The Aleph\na point in space\n### Notes\nstill the aleph",
      line: 7,
    });
  });

  it("looks for the heading in the body alone", () => {
    expect(noteSectionOf(FILED, "not a heading: yes")).toBeNull();
  });

  it("counts from the top of a note with no frontmatter", () => {
    expect(noteSectionOf(BOOK, "Ficciones")?.line).toBe(7);
  });

  it("answers null for a heading the note does not hold", () => {
    expect(noteSectionOf(FILED, "Labyrinths")).toBeNull();
  });
});

// A closer under a list item is measured from the item's content column, as markdown-it does (#1480).
describe("fencedLines closers in a list item", () => {
  it.each([
    [
      "three past the content column",
      ["- a", "  ```", "  code", "     ```", "  - b"],
      [1, 2, 3],
      null,
    ],
    ["four past it", ["- a", "  ```", "  code", "      ```", "  - b"], [1, 2, 3, 4], "```"],
    ["ordered tilde", ["1. a", "   ~~~", "   code", "      ~~~", "   b"], [1, 2, 3], null],
    ["short or other run", ["- a", "  ````", "     ```", "     ~~~~"], [1, 2, 3], "````"],
    ["four from the margin outside a list", ["```", "x", "    ```"], [0, 1, 2], "```"],
    ["a tab as four columns", ["```", "\t```", "## Log", "```"], [0, 1, 2, 3], null],
    ["two tabs under an item", ["- a", "  ```", "\t\t```"], [1, 2], "```"],
    ["1552 a tab line inside an item's fence", ["- a", "  ```", "\tx", "  ```"], [1, 2, 3], null],
    ["1552 a tab opener under an item", ["- a", "\t```", "\tx", "\t```", "- b"], [1, 2, 3], null],
    ["1550 a nested opener", ["- a", "  - b", "    ```", "    ## Log", "    ```"], [2, 3, 4], null],
    ["1550 a nested opener left open", ["- a", "  - b", "    ```", "    ## Log"], [2, 3], "```"],
    [
      "1553 an opener under a marker four in",
      ["- a", "  - b", "    - c", "      - d", "        ```", "        x"],
      [4, 5],
      "```",
    ],
    [
      "1553 a tab-led marker under an item",
      ["- a", "  - b", "\t- c", "\t     ```", "\t     x"],
      [3, 4],
      "```",
    ],
    [
      "1557 an opener after a quote that ends an inner item",
      ["- a", "  - b", "  > q", "    ```", "    x"],
      [3, 4],
      "```",
    ],
    [
      "1557 a break inside an item is no marker",
      ["- a", "  b", "  - - -", "  c", "    ```", "    x"],
      [4, 5],
      "```",
    ],
    // Guards: indented code and lazy lines open no fence.
    ["four past a nested item", ["- a", "  - b", "        ```", "    x"], [], null],
    ["four from the margin after a paragraph", ["a", "    ```", "    x", "    ```"], [], null],
    ["a tab opener at the margin", ["\t```", "x"], [], null],
    ["four in after a break below an item", ["- a", "---", "    ```", "    x"], [], null],
    ["four in after a quote below an item", ["- a", "> q", "    ```", "    x"], [], null],
    ["four in after a quote inside an item", ["- a", "  > q", "    ```", "    x"], [2, 3], "```"],
    [
      "four in after an underline inside an item",
      ["- a", "  ---", "    ```", "    x"],
      [2, 3],
      "```",
    ],
    [
      "1553 a marker four in that no item holds",
      ["a", "", "    - b", "      ```", "      x"],
      [],
      null,
    ],
    ["four in after a quote one space in", ["- a", " > q", "    ```", "    x"], [], null],
  ])("%s", (_name, lines, coded, openRun) => {
    const read = fencedLines(lines);
    expect([...read.coded]).toEqual(coded);
    expect(read.openRun).toBe(openRun);
  });

  it("1553 reads deep items split by lazy lines without a blowup", () => {
    const pairs = Array.from({ length: 40 }, () => ["  lazy", "    - d"]).flat();
    const started = performance.now();
    const read = fencedLines(["- a", "  - b", "    - c", ...pairs, "      ~~~", "      x"]);
    expect(performance.now() - started).toBeLessThan(500);
    expect(read.openRun).toBe("~~~");
  });

  it("1553 appendUnder adds no closer at the margin after a deep fence left open", () => {
    const text = "## Log\n- a\n  - b\n    - c\n      - d\n        ```\n        code";
    expect(appendUnder(text, "## Log", "- x")).toBe(`${text}\n- x`);
  });

  it("1550 appendUnder adds no closer at the margin after a nested fence left open", () => {
    const text = "## Log\n- a\n  - b\n    ```\n    code";
    expect(appendUnder(text, "## Log", "- x")).toBe(`${text}\n- x`);
  });
});
