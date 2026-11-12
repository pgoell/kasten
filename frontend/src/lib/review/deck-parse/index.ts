import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownConfig } from "@lezer/markdown";
import { frontmatter } from "@/lib/markdown/frontmatter-language";
import { Highlight } from "@/lib/markdown/markdown-highlight";
import { MathSyntax } from "@/lib/markdown/math";
import { Tag } from "@/lib/markdown/tag";
import { WikiLink } from "@/lib/notes/links/wikilink";
import { type CodeSpan, isUnclosed, spanLines } from "@/lib/notes/text/note-code";

/** The end of a line, as `.` in a pattern reads it. */
const LINE_END = /[\n\r\u2028\u2029]/g;

/**
 * Whether a `<!--` runs on past its line, or holds a `::` or the token before its `-->`.
 * A schedule holds neither, so a card's own line stays unparsed; a copy of the token in a
 * comment must not park (#1590). One walk, not a pattern per opener, which was quadratic (#1931).
 */
function hidesCard(text: string): boolean {
  // The next `-->` and line end, kept while ahead of the walk so no search repeats.
  let close = -1;
  let lineEnd = -1;
  let open = text.indexOf("<!--");
  while (open !== -1) {
    const from = open + 4;
    if (close < from) {
      close = text.indexOf("-->", from);
      if (close === -1) close = text.length;
    }
    if (lineEnd < from) {
      LINE_END.lastIndex = from;
      lineEnd = LINE_END.exec(text)?.index ?? text.length;
    }
    const end = Math.min(close, lineEnd);
    const inside = text.slice(from, end);
    if (text[end] === "\n" && end < close) return true;
    if (inside.includes("::") || inside.includes("!suspended")) return true;
    // An opener before `end - 3` reaches the same end, so only one overlapping it can differ.
    open = text.indexOf("<!--", Math.max(open + 1, end - 3));
  }
  return false;
}

/**
 * No inline parse of a paragraph lacking a deck tag or a `<!--`, which is most of a deck note (#669).
 * One with both, a comment over several lines (#1477) or a `::` in a comment (#1547) is parsed as the editor parses it.
 */
const Untagged: MarkdownConfig = {
  parseInline: [
    {
      name: "Untagged",
      before: "Escape",
      parse: (cx, _next, pos) =>
        pos === cx.offset &&
        !(cx.text.includes("#flashcards") && cx.text.includes("<!--")) &&
        !hidesCard(cx.text)
          ? cx.end
          : -1,
    },
  ],
};

/**
 * kasten's markdown under its frontmatter, with `Untagged` in front. One instance: the parser keeps no state.
 * No code languages: nothing inside code is read.
 */
const notes = frontmatter(
  markdown({
    base: markdownLanguage,
    extensions: [Untagged, Highlight, MathSyntax, Tag, WikiLink],
  }),
).language.parser;

/** What the editor's parser makes of a note, as far as cards and deck tags care. */
export interface CommentsAndCode {
  /**
   * The note with every HTML comment that could hide a deck tag blanked, each
   * line where it was. One on one line in a paragraph with no deck tag and no `::` in it stays as text.
   */
  uncommented: string;
  /** Per line of the note, whether it is code, fence lines included. */
  code: boolean[];
  /** Per line of the note, whether it lies in a fence nobody closed. */
  unclosed: boolean[];
  /** Per line of the note, whether its text lies whole inside a comment, as no card may (#665). */
  commented: boolean[];
}

/**
 * The note's comments and code blocks as the editor's parser finds them. A line at a time
 * cannot tell a tag inside a comment from one outside it (#664). Comments and code only.
 */
export function commentsAndCode(text: string): CommentsAndCode {
  let uncommented = "";
  let at = 0;
  const spans: CodeSpan[] = [];
  const comments: [number, number][] = [];
  notes.parse(text).iterate({
    enter(node) {
      if (node.name === "FencedCode" || node.name === "CodeBlock") {
        const unclosed = node.name === "FencedCode" && isUnclosed(node.node);
        spans.push({ from: node.from, to: node.to, unclosed });
        // Nothing inside code is a comment, whatever language the fence names.
        return false;
      }
      if (node.name !== "CommentBlock" && node.name !== "Comment") return;
      comments.push([node.from, node.to]);
      uncommented +=
        text.slice(at, node.from) + text.slice(node.from, node.to).replace(/[^\n]/g, " ");
      at = node.to;
      // Nothing inside a comment is a second comment.
      return false;
    },
  });
  uncommented += text.slice(at);

  const { code, unclosed } = spanLines(text, spans);
  const commented: boolean[] = [];
  let start = 0;
  let comment = 0;
  for (const line of text.split("\n")) {
    const end = start + line.length;
    const first = start + textStart(line);
    while ((comments[comment]?.[1] ?? Infinity) < end) comment++;
    const [opens, closes] = comments[comment] ?? [Infinity, Infinity];
    commented.push(opens <= first && end <= closes);
    start = end + 1;
  }
  return { uncommented, code, unclosed, commented };
}

/**
 * Where a line's text starts: past its indent, as a comment block may open after
 * three spaces, and past its list and quote marks (#1479).
 */
function textStart(line: string): number {
  return /^(?:\s*(?:>|(?:[-+*]|\d{1,9}[.)])(?=\s|$)))*\s*/.exec(line)?.[0].length ?? 0;
}
