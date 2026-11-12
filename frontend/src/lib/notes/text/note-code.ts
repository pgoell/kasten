/**
 * Which lines of a note are fenced code, as the editor's parser reads them. Every reader of the
 * body asks here, so a fence rule lives in the parser and nowhere else (#1701).
 */

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";
import type { MarkdownConfig } from "@lezer/markdown";
import { MathSyntax } from "@/lib/markdown/math";
import { noteBody } from "@/lib/notes/text/note-frontmatter";

/** Every fence opens with three backticks or tildes in a row, so a note with neither skips the parse. */
const FENCE_RUN = /```|~~~/;

/** No inline pass: no block turns on a paragraph's inline text, and it is most of the parse. */
const NoInline: MarkdownConfig = {
  parseInline: [
    {
      name: "NoInline",
      before: "Escape",
      parse: (cx, _next, pos) => (pos === cx.offset ? cx.end : -1),
    },
  ],
};

/** The editor's blocks, `$$` math among them, without frontmatter: callers hand in the body. */
const blocks = markdown({ base: markdownLanguage, extensions: [MathSyntax, NoInline] }).language
  .parser;

/** A code block's offsets in the text, and whether its fence is left open. */
export interface CodeSpan {
  from: number;
  to: number;
  unclosed: boolean;
}

/** Whether a `FencedCode` node lacks its closing run: a closed fence has a `CodeMark` at each end. */
export function isUnclosed(node: SyntaxNode): boolean {
  return node.getChildren("CodeMark").length < 2;
}

/**
 * Per line of `text`, whether a span overlaps it and whether that span is unclosed. Overlap, not
 * the line of `to`, as a block may end before its last newline or after it. Spans come in order.
 */
export function spanLines(
  text: string,
  spans: readonly CodeSpan[],
): { code: boolean[]; unclosed: boolean[] } {
  const code: boolean[] = [];
  const unclosed: boolean[] = [];
  let start = 0;
  let next = 0;
  for (const line of text.split("\n")) {
    const end = start + line.length;
    while ((spans[next]?.to ?? Infinity) <= start) next++;
    const span = spans[next];
    const inside = span !== undefined && span.from <= end && start < span.to;
    code.push(inside);
    unclosed.push(inside && (span?.unclosed ?? false));
    start = end + 1;
  }
  return { code, unclosed };
}

/**
 * The indices of fenced code lines, fences included, and the fence still open at the end, if any.
 * Indented code is not counted, as the backend counts it not, since four spaces also continue an
 * item. `openColumn` is 0 for a fence at the top level, where a closer at the margin ends it.
 */
export function fencedLines(lines: string[]): {
  coded: Set<number>;
  openFrom: number | null;
  openRun: string | null;
  openColumn: number;
} {
  const coded = new Set<number>();
  const text = lines.join("\n");
  if (!FENCE_RUN.test(text)) return { coded, openFrom: null, openRun: null, openColumn: 0 };

  const spans: CodeSpan[] = [];
  const opened: SyntaxNode[] = [];
  blocks.parse(text).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const unclosed = isUnclosed(node.node);
      spans.push({ from: node.from, to: node.to, unclosed });
      if (unclosed) opened.push(node.node);
      return false;
    },
  });
  spanLines(text, spans).code.forEach((inside, index) => {
    if (inside) coded.add(index);
  });

  // A fence its list item or quote ended is closed for anyone appending below.
  const last = opened.at(-1);
  if (last === undefined || text.slice(last.to).trim() !== "") {
    return { coded, openFrom: null, openRun: null, openColumn: 0 };
  }
  const mark = last.getChild("CodeMark");
  const lineStart = text.lastIndexOf("\n", last.from - 1) + 1;
  return {
    coded,
    openFrom: text.slice(0, last.from).split("\n").length - 1,
    openRun: mark === null ? null : text.slice(mark.from, mark.to),
    openColumn: last.parent?.type.isTop ? 0 : Math.max(1, last.from - lineStart),
  };
}

/**
 * How many lines the frontmatter takes, and the fenced lines of the body counted from the top of the note.
 * Fences are found in the body alone, so a fence the frontmatter seems to open hides nothing.
 */
export function bodyFences(lines: string[]): { above: number; coded: Set<number> } {
  const above = lines.length - noteBody(lines.join("\n")).split("\n").length;
  const coded = new Set([...fencedLines(lines.slice(above)).coded].map((at) => at + above));
  return { above, coded };
}
