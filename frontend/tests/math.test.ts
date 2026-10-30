import { GFM, parser } from "@lezer/markdown";
import { Highlight } from "@/lib/markdown-highlight";
import { MathSyntax } from "@/lib/math";
import { Tag } from "@/lib/tag";
import { WikiLink } from "@/lib/wikilink";

const notes = parser.configure([GFM, Highlight, MathSyntax, Tag, WikiLink]);

describe("math syntax", () => {
  it("R1 parses an unclosed block in time linear in its length", () => {
    const text = `$$ start\n${`${"x".repeat(79)}\n`.repeat(400)}`;

    const started = performance.now();
    const tree = notes.parse(text);
    const took = performance.now() - started;

    // Counting the input reads cannot see a reread of the paragraph, since
    // lezer reads each line once whatever the block parser does with it. A
    // reread like that took a minute at this size; a loaded run is far below 10s.
    expect(took).toBeLessThan(10_000);
    let found = false;
    tree.iterate({
      enter(node) {
        if (node.name === "BlockMath") found = true;
      },
    });
    expect(found).toBe(false);
  });
});
