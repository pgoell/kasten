/**
 * A passage a vault HTML page sends, written as a dump paragraph.
 *
 * The page is hostile, so each escape has a case of its own, and every case
 * asserts the exact text with `toEqual` or `toBe`: the dump is read back by
 * the backend's section reader, and a substring match would let a stray
 * character through.
 */

import { expect, it } from "vitest";
import {
  HEADING_CAP,
  PASSAGE_CAP,
  pageLink,
  quoteParagraphs,
  takenQuote,
  withoutTaken,
} from "@/lib/html-take";
import { tagsOf } from "@/lib/tag-rule";

const PATH = "01 Periodic/05 Newspaper/2026-10-07.html";

/** A quote as the dump holds it, taken from a passage with two paragraphs. */
const QUOTE = takenQuote(
  PATH,
  {
    text: "A passage.\n\nSecond passage.",
    heading: "Evals",
    anchor: "2026-10-07-evals-02",
  },
  "00 Daily/2026-10-23.md",
);

it("a passage writes its paragraphs and a link to the page", () => {
  expect(
    takenQuote(
      "01 Periodic/05 Newspaper/2026-10-07.html",
      {
        text: "First para.\n\nSecond   para.",
        heading: "Evals",
        anchor: "2026-10-07-evals-02",
      },
      "00 Daily/2026-10-23.md",
    ),
  ).toBe(
    "> First para.\n>\n> Second para.\n>\n> [[01 Periodic/05 Newspaper/2026-10-07.html#2026-10-07-evals-02|Evals]]",
  );
});

it("a passage with no heading links with the file name", () => {
  expect(
    pageLink(
      PATH,
      { text: "x", heading: "", anchor: "2026-10-07-evals-02" },
      "00 Daily/2026-10-23.md",
    ),
  ).toBe("[[01 Periodic/05 Newspaper/2026-10-07.html#2026-10-07-evals-02|2026-10-07.html]]");
});

it("a passage with no anchor links to the page alone", () => {
  expect(
    pageLink(PATH, { text: "x", heading: "Evals", anchor: "" }, "00 Daily/2026-10-23.md"),
  ).toBe("[[01 Periodic/05 Newspaper/2026-10-07.html|Evals]]");
});

it("a wikilink and an embed in the passage are escaped", () => {
  expect(quoteParagraphs("see [[Other]] and ![[img]]")).toEqual([
    "see \\[\\[Other\\]\\] and \\!\\[\\[img\\]\\]",
  ]);
});

it("a fake heading and a fake ## Dump stay inside the quote", () => {
  expect(
    takenQuote(
      PATH,
      { text: "## Dump\n# Title", heading: "", anchor: "" },
      "00 Daily/2026-10-23.md",
    ),
  ).toBe(
    "> &#35;&#35; Dump\n>\n> &#35; Title\n>\n> [[01 Periodic/05 Newspaper/2026-10-07.html|2026-10-07.html]]",
  );
});

it("a fence in the passage is escaped", () => {
  expect(quoteParagraphs("```js\ncode\n~~~")).toEqual(["\\`\\`\\`js", "code", "\\~\\~\\~"]);
});

it("a todo line in the passage is not a todo", () => {
  expect(quoteParagraphs("- [ ] buy milk\n1. first")).toEqual([
    "\\- \\[ \\] buy milk",
    "1\\. first",
  ]);
});

it("a frontmatter fence in the passage stays quoted", () => {
  expect(
    takenQuote(
      PATH,
      { text: "---\ntitle: x\n---", heading: "Evals", anchor: "" },
      "00 Daily/2026-10-23.md",
    ),
  ).toBe(
    "> \\---\n>\n> title: x\n>\n> \\---\n>\n> [[01 Periodic/05 Newspaper/2026-10-07.html|Evals]]",
  );
});

it("html and an image in the passage are escaped", () => {
  expect(quoteParagraphs("<b>bold</b> ![x](y.png)")).toEqual([
    "\\<b\\>bold\\</b\\> \\!\\[x\\](y.png)",
  ]);
});

it("a tag in the passage is escaped", () => {
  expect(quoteParagraphs("#tag and x#y")).toEqual(["&#35;tag and x&#35;y"]);
  // Kasten's own tag reader, not a count of hashes: a backslash before the hash
  // would still read as a tag there, so the quote must hold no tag at all.
  const quote = takenQuote(
    PATH,
    { text: "#tag and x#y #urgent", heading: "Evals", anchor: "" },
    "00 Daily/2026-10-23.md",
  );
  expect(quote.split("\n").flatMap((line) => tagsOf(line))).toEqual([]);
});

it("the heading cannot close the link", () => {
  expect(
    pageLink(PATH, { text: "x", heading: "x]] [[evil|y", anchor: "a" }, "00 Daily/2026-10-23.md"),
  ).toBe("[[01 Periodic/05 Newspaper/2026-10-07.html#a|x evily]]");
});

it("the anchor keeps only safe characters", () => {
  expect(
    pageLink(
      PATH,
      { text: "x", heading: "h", anchor: "a b#c]d-e_f.g:h" },
      "00 Daily/2026-10-23.md",
    ),
  ).toBe("[[01 Periodic/05 Newspaper/2026-10-07.html#abcd-e_f.g:h|h]]");
});

it("a page path with ]] in its name links with an encoded address", () => {
  const from = "00 Daily/2026-10-23.md";
  expect(pageLink("x/a]]b.html", { text: "t", heading: "H", anchor: "s1" }, from)).toBe(
    "[H](../x/a%5D%5Db.html#s1)",
  );
});

it("a taken quote from a page path with ]] ends with the encoded link, quoted", () => {
  const from = "00 Daily/2026-10-23.md";
  expect(takenQuote("x/a]]b.html", { text: "t", heading: "H", anchor: "s1" }, from)).toBe(
    "> t\n>\n> [H](../x/a%5D%5Db.html#s1)",
  );
});

it("a page path with a bar in its name links with an encoded address", () => {
  const from = "00 Daily/2026-10-23.md";
  expect(pageLink("x/a|b.html", { text: "t", heading: "H", anchor: "s1" }, from)).toBe(
    "[H](../x/a%7Cb.html#s1)",
  );
});

it("a page path with a hash in its name links with an encoded address", () => {
  const from = "00 Daily/2026-10-23.md";
  expect(pageLink("x/a#b.html", { text: "t", heading: "H", anchor: "s1" }, from)).toBe(
    "[H](../x/a%23b.html#s1)",
  );
});

it("a page path with a bracket in its name links with an encoded address", () => {
  const from = "00 Daily/2026-10-23.md";
  expect(pageLink("x/a[b.html", { text: "t", heading: "H", anchor: "s1" }, from)).toBe(
    "[H](../x/a%5Bb.html#s1)",
  );
});

it("a page with no heading and ]] in its file name gets an alias with no bracket", () => {
  const from = "00 Daily/2026-10-23.md";
  expect(pageLink("x/a]]b.html", { text: "t", heading: "", anchor: "s1" }, from)).toBe(
    "[ab.html](../x/a%5D%5Db.html#s1)",
  );
});

it("a fallback path's space, parentheses and percent are encoded, and decode back", () => {
  const path = "x/a (b) 50%|c.html";
  const from = "00 Daily/2026-10-23.md";
  const link = pageLink(path, { text: "t", heading: "", anchor: "s1" }, from);
  expect(link).toBe("[a (b) 50c.html](../x/a%20%28b%29%2050%25%7Cc.html#s1)");

  const address = link.slice(link.indexOf("](") + 2, link.indexOf("#"));
  expect(
    address
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/"),
  ).toBe("../x/a (b) 50%|c.html");
});

it("a fallback link is written relative to the note it lands in", () => {
  const passage = { text: "t", heading: "H", anchor: "s1" };
  expect(pageLink("x/a]]b.html", passage, "x/n.md")).toBe("[H](a%5D%5Db.html#s1)");
  expect(pageLink("x/a]]b.html", passage, "a/b/n.md")).toBe("[H](../../x/a%5D%5Db.html#s1)");
  expect(pageLink("x/a]]b.html", passage, "d.md")).toBe("[H](x/a%5D%5Db.html#s1)");
});

it("the passage is capped at 2000 characters", () => {
  expect(quoteParagraphs("a".repeat(2500))).toEqual([`${"a".repeat(PASSAGE_CAP - 1)}…`]);
});

it("the cap does not cut a character in half", () => {
  // An astral character is two UTF-16 units, so a cap counted in units would end
  // on half of one. The kept text must hold 1999 whole characters and the ellipsis.
  const smile = String.fromCodePoint(0x1f600);
  expect(quoteParagraphs(smile.repeat(2500))).toEqual([`${smile.repeat(PASSAGE_CAP - 1)}…`]);
});

it("the heading is capped at 120 characters", () => {
  expect(
    pageLink(PATH, { text: "x", heading: "h".repeat(200), anchor: "" }, "00 Daily/2026-10-23.md"),
  ).toBe(`[[${PATH}|${"h".repeat(HEADING_CAP - 1)}…]]`);
});

it("a heading cannot open an html comment", () => {
  expect(pageLink(PATH, { text: "x", heading: "<!--", anchor: "" }, "00 Daily/2026-10-23.md")).toBe(
    "[[01 Periodic/05 Newspaper/2026-10-07.html|--]]",
  );
  expect(
    pageLink(PATH, { text: "x", heading: "x <!-- y -->", anchor: "" }, "00 Daily/2026-10-23.md"),
  ).toBe("[[01 Periodic/05 Newspaper/2026-10-07.html|x -- y --]]");
});

it("the passage is capped at 50 paragraphs", () => {
  const text = Array.from({ length: 60 }, (_, index) => `p${index}`).join("\n");
  const kept = Array.from({ length: 49 }, (_, index) => `p${index}`);

  expect(quoteParagraphs(text)).toEqual([...kept, "p49…"]);
});

it("a lone surrogate is removed", () => {
  const lone = String.fromCharCode(0xd83d);

  expect(quoteParagraphs(`a${lone}b`)).toEqual(["ab"]);
  expect(
    pageLink(PATH, { text: "x", heading: `x${lone}y`, anchor: "" }, "00 Daily/2026-10-23.md"),
  ).toBe(`[[${PATH}|xy]]`);
});

it("control characters are removed", () => {
  expect(quoteParagraphs("a\u0000b\u0007c\u007f d")).toEqual(["abc d"]);
});

it("a tab between two table cells reads as a space", () => {
  expect(quoteParagraphs("cell one\tcell two")).toEqual(["cell one cell two"]);
});

it("withoutTaken takes the block out of a dump with earlier lines", () => {
  const head =
    "---\ntype: Periodic Note\nid: kept\n---\n\n# 2026-10-23 Friday\n\n## TODOs\n- [ ] a\n\n## Dump\nan earlier paragraph\n";
  const before = `${head}\n## Notes\nkept\n`;
  // What the dump writer leaves: a blank line, the capture, then a blank line before the next heading.
  const after = `${head}\n${QUOTE}\n\n## Notes\nkept\n`;

  expect(withoutTaken(after, QUOTE)).toBe(before);
});

it("withoutTaken takes the block out of a dump it was first in", () => {
  const before = "# d\n\n## Dump\n\n## Notes\nx\n";
  const after = `# d\n\n## Dump\n${QUOTE}\n\n## Notes\nx\n`;

  expect(withoutTaken(after, QUOTE)).toBe(before);
});

it("withoutTaken answers null when the block is not in the dump", () => {
  const elsewhere = `## Dump\nan earlier paragraph\n\n## Notes\n${QUOTE}\n`;
  const edited = `## Dump\n${QUOTE.replace("Second passage.", "Second, edited.")}\n`;

  expect(withoutTaken(elsewhere, QUOTE)).toBeNull();
  expect(withoutTaken(edited, QUOTE)).toBeNull();
});

it("withoutTaken answers null when the block is in the dump twice", () => {
  expect(withoutTaken(`## Dump\n${QUOTE}\n\n${QUOTE}\n`, QUOTE)).toBeNull();
});
