import type {
  BlockContext,
  LeafBlock,
  LeafBlockParser,
  Line,
  MarkdownConfig,
} from "@lezer/markdown";
import type katex from "katex";
import { loadOnce } from "@/lib/load-once";

/** `$`, which the parser sees as a code point rather than a string. */
const DOLLAR = 36;
const BACKSLASH = 92;

/** Whether `code` is a digit, which a closing `$` may not stand before. */
function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/**
 * Length of the first line if it is a whole `$$x$$` block, else -1. Read once: rereading per line
 * made an unclosed `$$` paragraph cubic.
 */
function oneLine(first: string): number {
  const text = first.trimEnd();
  return text.length > 4 && text.endsWith("$$") && text.slice(2, -2).trim() !== ""
    ? text.length
    : -1;
}

/**
 * A paragraph opening with `$$`: a formula once a line ends with `$$`. A leaf, so an unclosed
 * `$$` stays text rather than swallowing the note the way an unclosed fence does.
 */
class BlockMathParser implements LeafBlockParser {
  private readonly closed: number;

  constructor(first: string) {
    this.closed = oneLine(first);
  }

  nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    // Closed on its first line: the block ends there, and this line belongs to the next block.
    if (this.closed > 0) {
      cx.addLeafElement(leaf, mathBlock(cx, leaf.start, leaf.start + this.closed));
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
    if (this.closed < 0 || leaf.content.includes("\n")) return false;
    cx.addLeafElement(leaf, mathBlock(cx, leaf.start, leaf.start + this.closed));
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
 * `$x$` inline and `$$…$$` as a block, as Obsidian draws them. Inline uses pandoc's rule, so
 * `$5 and $6` stays prose. The nodes carry source only; `live-preview-math.ts` draws them.
 */
export const MathSyntax: MarkdownConfig = {
  // A block node, so an edit reparses from the block, not the note.
  defineNodes: [
    "InlineMath",
    "InlineMathMark",
    { name: "BlockMath", block: true },
    "BlockMathMark",
  ],
  parseBlock: [
    {
      name: "BlockMath",
      leaf: (_, leaf) => (leaf.content.startsWith("$$") ? new BlockMathParser(leaf.content) : null),
      // A `$$` line closes the paragraph above it, unless the line is lazy (lezer's untyped `depth`
      // below the paragraph's), so `- item` over `$$` stays one list item.
      endLeaf: (cx, line, leaf) =>
        !leaf.parsers.some((parser) => parser instanceof BlockMathParser) &&
        (line as Line & { depth: number }).depth >= cx.depth &&
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
          // A formula spanning a link would break it: `$5 per [[Item]], x$` loses its wikilink.
          if (/\]\(|\[\[|\]\]/.test(cx.slice(pos + 1, at))) return -1;
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

/**
 * KaTeX and its stylesheet, fetched the first time a note holds math. Dynamic because KaTeX is
 * 75 kB gzipped. A failed load is forgotten, so the next formula retries (#637).
 */
export const loadKatex: () => Promise<typeof katex> = loadOnce(() =>
  Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([module]) => module.default,
  ),
);
