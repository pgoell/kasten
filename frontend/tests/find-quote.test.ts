/**
 * Finding a quote's words in a section document.
 *
 * jsdom, and `document.implementation.createHTMLDocument`, which is what the
 * foliate fake already builds a section document with. Nothing here needs a
 * book: what the finder promises is a rule about strings and ranges.
 */

import { findQuotes } from "@/lib/find-quote";

const FIRST = "Systems that tolerate faults are called fault-tolerant.";
const SECOND = "A system that is reliable does what the user expects.";
const THIRD = "Reliability means continuing to work correctly.";

/**
 * A section document whose body holds one paragraph element per string.
 *
 * With a newline and an indent between the elements, the way a real chapter
 * file is written. That whitespace is inside a range spanning two paragraphs,
 * so it is what the collapsing on both sides is for.
 */
function sectionOf(...paragraphs: string[]): Document {
  const doc = document.implementation.createHTMLDocument("section");
  for (const text of paragraphs) {
    const element = doc.createElement("p");
    element.textContent = text;
    doc.body.append(doc.createTextNode("\n  "), element);
  }
  return doc;
}

/** A range's own words, normalised the way both sides of the finder are. */
function said(range: Range | null): string {
  return (range?.toString() ?? "").replace(/\s+/g, " ").trim();
}

describe("findQuotes", () => {
  it("finds a quote of one paragraph", () => {
    const doc = sectionOf(FIRST, SECOND);

    expect(said(findQuotes(doc, [[FIRST]])[0] ?? null)).toBe(FIRST);
  });

  it("spans a quote of two paragraphs from the first to the last", () => {
    const doc = sectionOf(FIRST, SECOND, THIRD);

    expect(said(findQuotes(doc, [[FIRST, SECOND]])[0] ?? null)).toBe(`${FIRST} ${SECOND}`);
  });

  it("answers null for a quote whose middle paragraph the document has not got", () => {
    // Being inside the span says nothing about whether the words still match,
    // so every paragraph is looked for rather than the first and the last.
    const doc = sectionOf(FIRST, THIRD);

    expect(findQuotes(doc, [[FIRST, SECOND, THIRD]])[0]).toBeNull();
  });

  it("answers null for a quote whose second paragraph comes before its first", () => {
    const doc = sectionOf(SECOND, FIRST);

    expect(findQuotes(doc, [[FIRST, SECOND]])[0]).toBeNull();
  });

  it("finds a quote the source broke across a line and an indent", () => {
    // pin: the case the collapsing on the document's side exists for.
    const doc = sectionOf("Systems that tolerate faults\n    are called fault-tolerant.");

    expect(said(findQuotes(doc, [[FIRST]])[0] ?? null)).toBe(FIRST);
  });

  it("finds a quote carrying a non-breaking space in a document carrying a plain one", () => {
    // pin: `\s` and not a hand written class, on both sides.
    const doc = sectionOf(FIRST);
    const quote = FIRST.replace("are called", "are called");

    expect(said(findQuotes(doc, [[quote]])[0] ?? null)).toBe(FIRST);
  });

  it("finds a quote carrying a plain space in a document carrying a non-breaking one", () => {
    const doc = sectionOf(FIRST.replace("are called", "are called"));

    expect(said(findQuotes(doc, [[FIRST]])[0] ?? null)).toBe(FIRST);
  });

  it("answers null for the quote it has not got and the ranges for the rest", () => {
    // pin: one quote missing does not end the call.
    const doc = sectionOf(FIRST, SECOND);
    const found = findQuotes(doc, [[FIRST], ["Words no book of this one holds."], [SECOND]]);

    expect(found.map(said)).toEqual([FIRST, "", SECOND]);
  });

  it("takes the first of a sentence the document holds twice", () => {
    // pin: `indexOf` answers the first match, which the master spec accepts by
    // name. The fix for it would be the second selector this design refuses.
    const doc = sectionOf(FIRST, SECOND, FIRST);
    const first = doc.body.querySelectorAll("p")[0]?.firstChild;

    expect(findQuotes(doc, [[FIRST]])[0]?.startContainer).toBe(first);
  });

  it("walks the document once however many quotes it is asked for", () => {
    // pin: the case that fails when somebody makes the signature take one
    // quote. The spy goes on the global `document` because foliate's own
    // `textWalker` builds its walker there (`text-walker.js:32`).
    const doc = sectionOf(FIRST, SECOND);
    const walkers = vi.spyOn(document, "createTreeWalker");

    findQuotes(
      doc,
      Array.from({ length: 200 }, (_, at) => [`${FIRST} ${at}`]),
    );

    expect(walkers).toHaveBeenCalledTimes(1);
    walkers.mockRestore();
  });
});
