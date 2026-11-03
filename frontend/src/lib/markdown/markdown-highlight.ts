import type { MarkdownConfig } from "@lezer/markdown";

/** `=`, which the parser sees as a code point rather than a string. */
const EQUALS = 61;

const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

/**
 * `==highlighted==`, which no markdown flavour we load parses. It is a parser extension rather than
 * a decoration, so the toggle command has a node to recognise. A delimiter opens only before a
 * non-space and closes only after one, which keeps `a == b` out of it.
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
