import type { MarkdownConfig } from "@lezer/markdown";

/** `=`, which the parser sees as a code point rather than a string. */
const EQUALS = 61;

const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

/**
 * `==highlighted==`, which no markdown flavour we load parses.
 *
 * Obsidian's notes use it and the toggle command needs a node to recognise, so
 * it has to be a real parser extension rather than a decoration rule. The nodes
 * carry no style of their own: `live-preview.ts` classes them like every other
 * inline construct.
 *
 * A delimiter opens only when a non-space follows it and closes only when a
 * non-space precedes it, which is what keeps `a == b` out of it. The GFM
 * strikethrough rule this follows adds punctuation cases too, and those are
 * left out until a note needs them.
 */
export const Highlight: MarkdownConfig = {
  defineNodes: ["Highlight", "HighlightMark"],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS) {
          return -1;
        }
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const space = /\s|^$/;

        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !space.test(after),
          !space.test(before),
        );
      },
      after: "Emphasis",
    },
  ],
};
