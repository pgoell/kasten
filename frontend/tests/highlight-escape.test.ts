import { quoteParagraphs, unescapeParagraph } from "@/lib/html-take";

/** Passages that would open a heading, a fence, a list, a link, a tag or frontmatter if written bare. */
const HOSTILE = [
  "## Dump",
  "```js",
  "- [ ] x",
  "1. x",
  "[[x]]",
  "![[x]]",
  "#tag",
  "---",
  "a\\b",
  "50%",
  "^hl-abcdef",
];

/** Text the writer leaves as it is: no backslash, no `&#35;`, nothing to take back. */
const PLAIN = ["The book says nothing unusual.", "- not a list, and no escape in it", "a\\b"];

describe("unescapeParagraph", () => {
  it("gives every hostile passage back as the page sent it", () => {
    // Soft, so one passage that fails does not hide the rest of the list.
    for (const text of HOSTILE) {
      const [written] = quoteParagraphs(text);
      expect.soft(unescapeParagraph(written ?? ""), text).toBe(text);
    }
  });

  it("leaves plain text and a lone backslash before a letter as they are", () => {
    for (const text of PLAIN) expect.soft(unescapeParagraph(text), text).toBe(text);
  });
});
