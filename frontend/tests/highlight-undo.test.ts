import { withoutHighlight } from "@/lib/book/highlight-undo";
import { addHighlight } from "@/lib/highlight";

const BASE = "# DDIA\n\n## Highlights\n";
const QUOTE = "Systems that tolerate faults are called fault-tolerant.";
const OTHER = "A system that is reliable does what the user expects.";
const ID = "hl-a3f9c1";
const SECOND = "hl-b2c4d6";

describe("withoutHighlight", () => {
  it("takes the one block out, with the blank line that sat in front of its quote", () => {
    const note = addHighlight(BASE, { text: QUOTE, chapter: "One" }, ID);

    expect(withoutHighlight(note, ID)).toBe("# DDIA\n\n## Highlights\n");
  });

  it("keeps the other blocks, and the heading, in the order the note holds them", () => {
    const first = addHighlight(BASE, { text: QUOTE, chapter: "One" }, ID);
    const note = addHighlight(first, { text: OTHER, chapter: "Two" }, SECOND);

    expect(withoutHighlight(note, ID)).toBe(
      ["# DDIA", "", "## Highlights", "", `> ${OTHER}`, "", `Two ^${SECOND}`, ""].join("\n"),
    );
  });

  it("takes a figure written above the quote out with the block, so the note is as it was", () => {
    const note = addHighlight(BASE, { text: QUOTE, chapter: "One", image: "99 Misc/fig.png" }, ID);

    expect(withoutHighlight(note, ID)).toBe(BASE);
  });

  it("refuses when two blocks carry the same id, since it cannot tell which is the take", () => {
    const first = addHighlight(BASE, { text: QUOTE, chapter: "One" }, ID);
    const note = addHighlight(first, { text: OTHER, chapter: "Two" }, ID);

    expect(withoutHighlight(note, ID)).toBeNull();
  });

  it("answers null when no block carries the id", () => {
    const note = addHighlight(BASE, { text: QUOTE, chapter: "One" }, ID);

    expect(withoutHighlight(note, SECOND)).toBeNull();
  });
});
