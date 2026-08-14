import type { MarkdownConfig } from "@lezer/markdown";

/** `#`, which the parser sees as a code point rather than a string. */
const HASH = 35;

/**
 * The tag itself: a letter after the hash, then letters, digits and separators.
 *
 * Looser than this and every `#!/bin/sh` and `#1` in a note turns into a tag.
 * `todo.ts` reads a todo's tags with a wider pattern, because a line already
 * known to be a todo can afford one.
 */
const TAG = /^#[\p{L}_][\p{L}\p{N}_/-]*/u;

/** What may not sit in front of a hash, so `note#2` is not a tag. */
const WORD = /[\p{L}\p{N}_/]/u;

/**
 * `#tag`, the way Obsidian writes one.
 *
 * A parser extension rather than a regex over the text, so the hash inside a
 * code span, a fenced block or a URL is left alone: inline parsers are never
 * asked about a range another parser has already taken.
 *
 * Nothing is hidden and nothing stands in for the hash. A tag is what somebody
 * typed, so `live-preview.ts` colours it and leaves it on the screen whichever
 * mode the editor is in.
 */
export const Tag: MarkdownConfig = {
  defineNodes: ["Tag"],
  parseInline: [
    {
      name: "Tag",
      parse(cx, next, pos) {
        if (next !== HASH || WORD.test(cx.slice(pos - 1, pos))) return -1;
        const match = TAG.exec(cx.slice(pos, cx.end));
        if (match === null) return -1;
        return cx.addElement(cx.elt("Tag", pos, pos + match[0].length));
      },
    },
  ],
};
