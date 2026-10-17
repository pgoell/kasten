import type {
  BlockContext,
  LeafBlock,
  LeafBlockParser,
  Line,
  MarkdownConfig,
} from "@lezer/markdown";
import type katex from "katex";

/** `$`, which the parser sees as a code point rather than a string. */
const DOLLAR = 36;
const BACKSLASH = 92;

/** Whether `code` is a digit, which a closing `$` may not stand before. */
function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** A `$$` block written on one line, `$$x$$`. */
const ONE_LINE = /^\$\$[\s\S]*\S[\s\S]*\$\$\s*$/;

/**
 * A paragraph that opens with `$$`, which is a formula once a line ends with
 * `$$` again.
 *
 * A leaf rather than a block parser, because a block parser cannot look past
 * the next line before it takes the first, and an opening `$$` nothing closes
 * has to stay text rather than swallow the rest of the note the way an
 * unclosed fence does. A leaf ends at a blank line on its own, and `finish`
 * declining hands it back as the paragraph it would have been.
 */
class BlockMathParser implements LeafBlockParser {
  nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    // Closed on its first line: the block ends there and this line is the
    // next block's, so it is left for the parser to read.
    if (ONE_LINE.test(leaf.content)) {
      const end = leaf.start + leaf.content.trimEnd().length;
      cx.addLeafElement(leaf, mathBlock(cx, leaf.start, end));
      return true;
    }
    const text = line.text.trimEnd();
    if (!text.endsWith("$$")) return false;
    const end = cx.lineStart + text.length;
    cx.nextLine();
    cx.addLeafElement(leaf, mathBlock(cx, leaf.start, end));
    return true;
  }

  finish(cx: BlockContext, leaf: LeafBlock): boolean {
    if (!ONE_LINE.test(leaf.content)) return false;
    cx.addLeafElement(leaf, mathBlock(cx, leaf.start, leaf.start + leaf.content.trimEnd().length));
    return true;
  }
}

function mathBlock(cx: BlockContext, from: number, to: number) {
  return cx.elt("BlockMath", from, to, [
    cx.elt("BlockMathMark", from, from + 2),
    cx.elt("BlockMathMark", to - 2, to),
  ]);
}

/**
 * `$x$` inline and `$$…$$` as a block, the math Obsidian draws.
 *
 * Inline, the rule is pandoc's, which is Obsidian's too: the opening `$` has
 * a non-space after it, the closing one a non-space before it and no digit
 * after it, so `$5 and $6` stays a sentence about money. A formula stays on
 * its line, `\$` inside one is a dollar, and `$$` mid-line opens nothing.
 *
 * The nodes carry the source and no style: `live-preview.ts` draws them.
 */
export const MathSyntax: MarkdownConfig = {
  // A block, so an edit near one reparses from the block rather than the note.
  defineNodes: [
    "InlineMath",
    "InlineMathMark",
    { name: "BlockMath", block: true },
    "BlockMathMark",
  ],
  parseBlock: [
    {
      name: "BlockMath",
      leaf: (_, leaf) => (leaf.content.startsWith("$$") ? new BlockMathParser() : null),
      // A `$$` line closes the paragraph above it, so a formula needs no blank
      // line before it. Not the one it closes itself.
      endLeaf: (_, line, leaf) =>
        !leaf.parsers.some((parser) => parser instanceof BlockMathParser) &&
        line.text.startsWith("$$", line.pos),
    },
  ],
  parseInline: [
    {
      name: "InlineMath",
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1;
        // Both of a `$$` go by as text, or the second would open a formula.
        if (cx.char(pos + 1) === DOLLAR) return pos + 2;
        if (/\s|^$/.test(cx.slice(pos + 1, pos + 2))) return -1;

        for (let at = pos + 1; at < cx.end; at++) {
          const code = cx.char(at);
          if (code === 10) return -1;
          if (code === BACKSLASH) {
            at++;
            continue;
          }
          if (code !== DOLLAR || at === pos + 1) continue;
          if (/\s/.test(cx.slice(at - 1, at)) || isDigit(cx.char(at + 1))) continue;
          return cx.addElement(
            cx.elt("InlineMath", pos, at + 1, [
              cx.elt("InlineMathMark", pos, pos + 1),
              cx.elt("InlineMathMark", at, at + 1),
            ]),
          );
        }
        return -1;
      },
      before: "Emphasis",
    },
  ],
};

let loading: Promise<typeof katex> | null = null;

/**
 * KaTeX and its stylesheet, fetched the first time a note holds math.
 *
 * A dynamic import, which `.claude/CLAUDE.md` allows for a heavy third-party
 * bundle: a static one would put KaTeX, 75 kB gzipped, on every editor page
 * whether or not a note held a formula. Its own module so a test can see
 * whether it was asked for.
 */
export function loadKatex(): Promise<typeof katex> {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([module]) => module.default,
  );
  return loading;
}
