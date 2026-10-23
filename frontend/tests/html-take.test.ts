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

const PATH = "01 Periodic/05 Newspaper/2026-10-07.html";

/** A quote as the dump holds it, taken from a passage with two paragraphs. */
const QUOTE = takenQuote(PATH, {
  text: "A passage.\n\nSecond passage.",
  heading: "Evals",
  anchor: "2026-10-07-evals-02",
});

it("a passage writes its paragraphs and a link to the page", () => {
  expect(
    takenQuote("01 Periodic/05 Newspaper/2026-10-07.html", {
      text: "First para.\n\nSecond   para.",
      heading: "Evals",
      anchor: "2026-10-07-evals-02",
    }),
  ).toBe(
    "> First para.\n>\n> Second para.\n>\n> [[01 Periodic/05 Newspaper/2026-10-07.html#2026-10-07-evals-02|Evals]]",
  );
});

it("a passage with no heading links with the file name", () => {
  expect(pageLink(PATH, { text: "x", heading: "", anchor: "2026-10-07-evals-02" })).toBe(
    "[[01 Periodic/05 Newspaper/2026-10-07.html#2026-10-07-evals-02|2026-10-07.html]]",
  );
});

it("a passage with no anchor links to the page alone", () => {
  expect(pageLink(PATH, { text: "x", heading: "Evals", anchor: "" })).toBe(
    "[[01 Periodic/05 Newspaper/2026-10-07.html|Evals]]",
  );
});

it("a wikilink and an embed in the passage are escaped", () => {
  expect(quoteParagraphs("see [[Other]] and ![[img]]")).toEqual([
    "see \\[\\[Other\\]\\] and \\!\\[\\[img\\]\\]",
  ]);
});

it("a fake heading and a fake ## Dump stay inside the quote", () => {
  expect(takenQuote(PATH, { text: "## Dump\n# Title", heading: "", anchor: "" })).toBe(
    "> \\#\\# Dump\n>\n> \\# Title\n>\n> [[01 Periodic/05 Newspaper/2026-10-07.html|2026-10-07.html]]",
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
  expect(takenQuote(PATH, { text: "---\ntitle: x\n---", heading: "Evals", anchor: "" })).toBe(
    "> \\---\n>\n> title: x\n>\n> \\---\n>\n> [[01 Periodic/05 Newspaper/2026-10-07.html|Evals]]",
  );
});

it("html and an image in the passage are escaped", () => {
  expect(quoteParagraphs("<b>bold</b> ![x](y.png)")).toEqual([
    "\\<b\\>bold\\</b\\> \\!\\[x\\](y.png)",
  ]);
});

it("a tag in the passage is escaped", () => {
  expect(quoteParagraphs("#tag and x#y")).toEqual(["\\#tag and x\\#y"]);
});

it("the heading cannot close the link", () => {
  expect(pageLink(PATH, { text: "x", heading: "x]] [[evil|y", anchor: "a" })).toBe(
    "[[01 Periodic/05 Newspaper/2026-10-07.html#a|x evily]]",
  );
});

it("the anchor keeps only safe characters", () => {
  expect(pageLink(PATH, { text: "x", heading: "h", anchor: "a b#c]d-e_f.g:h" })).toBe(
    "[[01 Periodic/05 Newspaper/2026-10-07.html#abcd-e_f.g:h|h]]",
  );
});

it("the passage is capped at 2000 characters", () => {
  expect(quoteParagraphs("a".repeat(2500))).toEqual([`${"a".repeat(PASSAGE_CAP - 1)}…`]);
});

it("the heading is capped at 120 characters", () => {
  expect(pageLink(PATH, { text: "x", heading: "h".repeat(200), anchor: "" })).toBe(
    `[[${PATH}|${"h".repeat(HEADING_CAP - 1)}…]]`,
  );
});

it("control characters are removed", () => {
  expect(quoteParagraphs("a\u0000b\u0007c\u007f d")).toEqual(["abc d"]);
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
