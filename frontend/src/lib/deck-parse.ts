import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownConfig } from "@lezer/markdown";
import { frontmatter } from "@/lib/frontmatter-language";
import { Highlight } from "@/lib/markdown-highlight";
import { MathSyntax } from "@/lib/math";
import { Tag } from "@/lib/tag";
import { WikiLink } from "@/lib/wikilink";

/**
 * No inline parse of a paragraph that holds no deck tag or no `<!--`, which is
 * most of a deck note and was most of the time the editor's parse took (#669).
 * A deck tag opens with `#flashcards`, `deck-tag.ts`'s `DECK_TAG`.
 *
 * What `commentsAndCode` takes from inside a paragraph is its comments, and those only to
 * hide the deck tags in them, so a paragraph without both has nothing to give.
 * Code is a block and the block parse stays whole. A paragraph holding both is
 * parsed as the editor parses it, code spans and all.
 */
const Untagged: MarkdownConfig = {
  parseInline: [
    {
      name: "Untagged",
      before: "Escape",
      parse: (cx, _next, pos) =>
        pos === cx.offset && !(cx.text.includes("#flashcards") && cx.text.includes("<!--"))
          ? cx.end
          : -1,
    },
  ],
};

/**
 * kasten's markdown under its frontmatter, as `noteLanguage` has it, with
 * `Untagged` in front. One for the module, the parser holding no state between
 * two notes. No code languages: nothing inside code is read.
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
   * line where it was. A comment in a paragraph with no deck tag stays as text.
   */
  uncommented: string;
  /** Per line of the note, whether it is code, fence lines included. */
  code: boolean[];
  /** Per line of the note, whether it lies in a fence nobody closed. */
  unclosed: boolean[];
}

/**
 * The note's comments and code blocks, as the editor finds them.
 *
 * The editor's parser and not a line at a time, because a comment may run over
 * several lines and a reader of one line cannot tell a tag inside one from a
 * tag outside it. It is the parser that knows a `~~~` fence, a fence nobody
 * closed, one inside a list item or quote, and an indented block from a line
 * that goes on with a paragraph or item (#664). One parse for both, a deck note
 * being long enough for a second to show.
 *
 * Comments and code only: the parser also hides tags in an HTML block such as
 * `<img>`, which runs on to the blank line, and a deck tag under one is a deck
 * the note always had. The newlines stay, so a line's index is the one card
 * detection gave it.
 */
export function commentsAndCode(text: string): CommentsAndCode {
  let uncommented = "";
  let at = 0;
  const spans: [number, number, boolean][] = [];
  notes.parse(text).iterate({
    enter(node) {
      if (node.name === "FencedCode" || node.name === "CodeBlock") {
        // A closed fence has a CodeMark at each end, one nobody closed only the
        // opening one, and an indented block none.
        const unclosed = node.name === "FencedCode" && node.node.getChildren("CodeMark").length < 2;
        spans.push([node.from, node.to, unclosed]);
        // Nothing inside code is a comment, whatever language the fence names.
        return false;
      }
      if (node.name !== "CommentBlock" && node.name !== "Comment") return;
      uncommented +=
        text.slice(at, node.from) + text.slice(node.from, node.to).replace(/[^\n]/g, " ");
      at = node.to;
      // Nothing inside a comment is a second comment.
      return false;
    },
  });
  uncommented += text.slice(at);

  // A line is code where a span overlaps it. Overlap and not the line of
  // `to`, as a block may end before its last newline or after it.
  const code: boolean[] = [];
  const unclosed: boolean[] = [];
  let start = 0;
  let next = 0;
  for (const line of text.split("\n")) {
    const end = start + line.length;
    while ((spans[next]?.[1] ?? Infinity) <= start) next++;
    const [from, to, open] = spans[next] ?? [Infinity, Infinity, false];
    const inside = from <= end && start < to;
    code.push(inside);
    unclosed.push(inside && open);
    start = end + 1;
  }
  return { uncommented, code, unclosed };
}
