import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownConfig } from "@lezer/markdown";
import { frontmatter } from "@/lib/markdown/frontmatter-language";
import { Highlight } from "@/lib/markdown/markdown-highlight";
import { MathSyntax } from "@/lib/markdown/math";
import { Tag } from "@/lib/markdown/tag";
import { WikiLink } from "@/lib/notes/links/wikilink";

/**
 * No inline parse of a paragraph lacking a deck tag or a `<!--`, which is most of a deck note (#669).
 * A paragraph with both is parsed as the editor parses it, code spans and all.
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
   * line where it was. A comment in a paragraph with no deck tag stays as text.
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
  const spans: [number, number, boolean][] = [];
  const comments: [number, number][] = [];
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
      comments.push([node.from, node.to]);
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
  const commented: boolean[] = [];
  let start = 0;
  let next = 0;
  let comment = 0;
  for (const line of text.split("\n")) {
    const end = start + line.length;
    while ((spans[next]?.[1] ?? Infinity) <= start) next++;
    const [from, to, open] = spans[next] ?? [Infinity, Infinity, false];
    const inside = from <= end && start < to;
    code.push(inside);
    unclosed.push(inside && open);
    // From the first character, as a comment block may open after up to three spaces.
    const first = start + line.length - line.trimStart().length;
    while ((comments[comment]?.[1] ?? Infinity) < end) comment++;
    const [opens, closes] = comments[comment] ?? [Infinity, Infinity];
    commented.push(opens <= first && end <= closes);
    start = end + 1;
  }
  return { uncommented, code, unclosed, commented };
}
