/**
 * A passage a PDF sends, written as a dump paragraph, and the marks a page's text
 * layer keeps. The PDF's text is as hostile as a page's, so the escapes are
 * checked with exact text, the way `html-take.test.ts` checks them.
 */

import { afterEach, expect, it } from "vitest";
import { offsetsIn, pdfLink, pdfQuote, rangeIn } from "@/lib/book/pdf-take";
import { pageLink, quoteBlock } from "@/lib/html-take";
import { tagsOf } from "@/lib/tag-rule";

const PATH = "30 Research/report.pdf";

afterEach(() => {
  document.body.innerHTML = "";
});

it("a block of two paragraphs quotes them with a lone > between, and the link last", () => {
  expect(quoteBlock("First para.\n\nSecond   para.", "[[a|b]]")).toBe(
    "> First para.\n>\n> Second para.\n>\n> [[a|b]]",
  );
});

it("a pdf link names the page and the file", () => {
  expect(pdfLink(PATH, 2, "00 Daily/2026-10-23.md")).toBe(
    "[[30 Research/report.pdf#page=2|report.pdf, page 2]]",
  );
});

it("a file name with signs in it keeps them out of the alias", () => {
  // A name with `=`, `*`, `_` and `$` is legal in a vault and is not a link
  // character, so the alias drops them the way a heading's alias drops them.
  expect(pdfLink("30 Research/Q1 = 2*3_$.pdf", 4, "00 Daily/2026-10-23.md")).toBe(
    "[[30 Research/Q1 = 2*3_$.pdf#page=4|Q1 23.pdf, page 4]]",
  );
});

it("a path with no bracket, bar or hash writes the same wikilink as before", () => {
  const from = "00 Daily/2026-10-23.md";
  expect(pageLink(PATH, { text: "x", heading: "Evals", anchor: "s1" }, from)).toBe(
    "[[30 Research/report.pdf#s1|Evals]]",
  );
  expect(pdfLink(PATH, 2, from)).toBe("[[30 Research/report.pdf#page=2|report.pdf, page 2]]");
});

it("a pdf path with ]] in its name links with an encoded address", () => {
  expect(pdfLink("30 Research/a]]b.pdf", 3, "00 Daily/2026-10-23.md")).toBe(
    "[ab.pdf, page 3](../30%20Research/a%5D%5Db.pdf#page=3)",
  );
});

it("a pdf path with a bar in its name links with an encoded address", () => {
  expect(pdfLink("30 Research/a|b.pdf", 3, "00 Daily/2026-10-23.md")).toBe(
    "[ab.pdf, page 3](../30%20Research/a%7Cb.pdf#page=3)",
  );
});

it("a pdf path with a hash in its name links with an encoded address", () => {
  expect(pdfLink("30 Research/a#b.pdf", 3, "00 Daily/2026-10-23.md")).toBe(
    "[ab.pdf, page 3](../30%20Research/a%23b.pdf#page=3)",
  );
});

it("a pdf path with a bracket in its name links with an encoded address", () => {
  expect(pdfLink("30 Research/a[b.pdf", 3, "00 Daily/2026-10-23.md")).toBe(
    "[ab.pdf, page 3](../30%20Research/a%5Bb.pdf#page=3)",
  );
});

it("a long pdf name with a bar keeps its page in the alias", () => {
  const name = `${"a".repeat(119)}|b.pdf`;
  expect(pdfLink(`30 Research/${name}`, 3, "00 Daily/2026-10-23.md")).toBe(
    `[${"a".repeat(119)}…, page 3](../30%20Research/${"a".repeat(119)}%7Cb.pdf#page=3)`,
  );
});

it("a tab between two table cells in a pdf passage reads as a space", () => {
  expect(pdfQuote(PATH, 2, "cell one\tcell two", "00 Daily/2026-10-23.md")).toBe(
    "> cell one cell two\n>\n> [[30 Research/report.pdf#page=2|report.pdf, page 2]]",
  );
});

it("a pdf passage with markup, a fake heading and a fake todo stays quoted", () => {
  const quote = pdfQuote(
    PATH,
    2,
    "## Dump\n- [ ] x\n[[x]]\n![[x]]\n#tag\n---",
    "00 Daily/2026-10-23.md",
  );

  expect(quote).toBe(
    [
      "> &#35;&#35; Dump",
      ">",
      "> \\- \\[ \\] x",
      ">",
      "> \\[\\[x\\]\\]",
      ">",
      "> \\!\\[\\[x\\]\\]",
      ">",
      "> &#35;tag",
      ">",
      "> \\---",
      ">",
      "> [[30 Research/report.pdf#page=2|report.pdf, page 2]]",
    ].join("\n"),
  );
  expect(quote.split("\n").flatMap((line) => tagsOf(line))).toEqual([]);
});

/** A text layer of three spans, the way the viewer draws the words of a line. */
function layerOfThree(): { layer: HTMLElement; texts: Text[] } {
  const layer = document.createElement("div");
  layer.className = "textLayer";
  for (const words of ["Hello ", "wide ", "world"]) {
    const span = document.createElement("span");
    span.textContent = words;
    layer.append(span);
  }
  document.body.append(layer);
  const texts = Array.from(layer.querySelectorAll("span")).map((span) => span.firstChild as Text);
  return { layer, texts };
}

it("offsets and ranges round trip over a layer of several spans", () => {
  const { layer, texts } = layerOfThree();
  const first = texts[0] as Text;
  const second = texts[1] as Text;
  const third = texts[2] as Text;

  // "wide " starts at 6 and "wor" ends at 14: the range runs across two spans.
  const across = document.createRange();
  across.setStart(second, 0);
  across.setEnd(third, 3);
  expect(offsetsIn(layer, across)).toEqual({ start: 6, end: 14 });

  // A range that starts inside the first span is clipped to the layer's own text.
  const middle = document.createRange();
  middle.setStart(first, 2);
  middle.setEnd(third, 3);
  expect(offsetsIn(layer, middle)).toEqual({ start: 2, end: 14 });

  const back = rangeIn(layer, 6, 14);
  expect(back?.toString()).toBe("wide wor");
  expect(back === null ? null : offsetsIn(layer, back)).toEqual({ start: 6, end: 14 });
});

it("a range that does not meet the layer has no offsets in it", () => {
  const { layer } = layerOfThree();
  const outside = document.createElement("p");
  outside.textContent = "Elsewhere on the page.";
  document.body.append(outside);

  const elsewhere = document.createRange();
  elsewhere.selectNodeContents(outside);
  expect(offsetsIn(layer, elsewhere)).toBeNull();
});
