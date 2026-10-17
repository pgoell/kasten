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

    // Main parses this in a few milliseconds and a parse that rereads the
    // whole paragraph on every line took a minute, so the bound is loose
    // enough for a loaded machine and still far from either.
    expect(took).toBeLessThan(200);
    let found = false;
    tree.iterate({
      enter(node) {
        if (node.name === "BlockMath") found = true;
      },
    });
    expect(found).toBe(false);
  });
});
