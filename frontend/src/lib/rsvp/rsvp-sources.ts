/**
 * The words of each text kind kasten reads, in reading order, for RSVP. Each source turns its text
 * into runs (`Run` in `rsvp.ts`), and every word keeps its place so it maps back to one.
 */

import type { SyntaxNode } from "@lezer/common";
import { GFM, parser } from "@lezer/markdown";
import { parseCallout } from "@/lib/callout";
import { Highlight } from "@/lib/markdown-highlight";
import { MathSyntax } from "@/lib/math";
import { noteBody } from "@/lib/note-frontmatter";
import { type Run, type Word, wordsOf } from "@/lib/rsvp/rsvp";
import { Tag } from "@/lib/tag";
import { WikiLink } from "@/lib/wikilink";

/** The note's own parse, as `copy-as.ts` configures it, so the two read a note alike. */
const notes = parser.configure([GFM, Highlight, MathSyntax, Tag, WikiLink]);

/** Syntax around the words, which a reader never sees. */
const MARKS = new Set([
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "LinkMark",
  "EmphasisMark",
  "CodeMark",
  "CodeInfo",
  "LinkTitle",
  "LinkLabel",
  "StrikethroughMark",
  "HighlightMark",
  "TaskMarker",
  "TableDelimiter",
  "WikiLinkMark",
  "EmbedMark",
]);

/**
 * Inline nodes with nothing to read one word at a time: an address, a formula,
 * a tag of markup, an image and an embed are things to look at.
 */
const UNREAD = new Set(["URL", "Autolink", "InlineMath", "HTMLTag", "Comment", "Image", "Embed"]);

/** Blocks the same is true of: code, a formula, markup and a rule. */
const UNREAD_BLOCKS = new Set([
  "FencedCode",
  "CodeBlock",
  "BlockMath",
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
  "LinkReference",
  "HorizontalRule",
]);

/** Blocks that hold blocks, walked into rather than read. */
const CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);

/**
 * A note's words, read from its source and not the editor's DOM, which holds only the lines on screen.
 * Offsets count the whole note, front matter included, as the editor's cursor does.
 */
export function markdownWords(text: string): Word[] {
  const body = noteBody(text);
  // `noteBody` keeps the note's tail whole, so the block is what it cut off the front.
  const start = text.length - body.length;
  const runs: Run[] = [];

  function emit(from: number, to: number) {
    if (to > from) runs.push({ text: body.slice(from, to), from: start + from });
  }

  function inline(node: SyntaxNode, from = node.from, to = node.to) {
    let at = from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue;
      emit(at, child.from);
      span(child);
      at = child.to;
    }
    emit(at, to);
  }

  function span(node: SyntaxNode) {
    if (MARKS.has(node.name) || UNREAD.has(node.name)) return;
    switch (node.name) {
      case "WikiLink": {
        // The alias where there is one, as live preview draws it, else the target.
        const inner = body.slice(node.from + 2, node.to - 2);
        const bar = inner.indexOf("|");
        const from = node.from + 2 + (bar === -1 ? 0 : bar + 1);
        emit(from, node.to - 2);
        return;
      }
      case "Escape":
        emit(node.from + 1, node.to);
        return;
      case "HardBreak":
        runs.push({ text: " ", from: start + node.from });
        return;
      default:
        if (node.firstChild) inline(node);
        else emit(node.from, node.to);
    }
  }

  /** A table row by row, each row a paragraph. */
  function table(node: SyntaxNode) {
    for (let row = node.firstChild; row; row = row.nextSibling) {
      for (const cell of row.getChildren("TableCell")) {
        inline(cell);
        runs.push({ text: " ", from: start + cell.to });
      }
      runs.push("break");
    }
  }

  function blocks(node: SyntaxNode) {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (MARKS.has(child.name) || UNREAD_BLOCKS.has(child.name)) continue;
      if (CONTAINERS.has(child.name)) blocks(child);
      else if (child.name === "Table") table(child);
      else {
        inline(child, calloutBody(child) ?? child.from);
        runs.push("break");
      }
    }
  }

  /**
   * Where a callout's first paragraph starts once its `[!type]` is cut, or
   * undefined for any other block. The title is read; the type is markup.
   */
  function calloutBody(node: SyntaxNode): number | undefined {
    if (node.name !== "Paragraph" || node.parent?.name !== "Blockquote") return undefined;
    let first = node.parent.firstChild;
    while (first && MARKS.has(first.name)) first = first.nextSibling;
    if (first?.from !== node.from) return undefined;
    const end = body.indexOf("\n", node.from);
    const header = parseCallout(body.slice(node.from, end === -1 ? node.to : end));
    return header === null ? undefined : node.from + header.length;
  }

  blocks(notes.parse(body).topNode);
  return wordsOf(runs, 0);
}

/** A page's text items, as pdf.js's `getTextContent` hands them over. */
export interface PdfItem {
  str?: string;
  hasEOL?: boolean;
}

/**
 * One pdf page's words. Items join with nothing between them, and a line end is a word break,
 * so a word hyphenated at a line end is joined again. A pdf has no paragraph marks, so a page ends one.
 */
export function pageWords(items: readonly PdfItem[], page: number): Word[] {
  const runs: Run[] = [];
  let at = 0;
  for (const item of items) {
    const text = item.str ?? "";
    if (item.hasEOL && /\p{L}-$/u.test(text)) {
      runs.push({ text: text.slice(0, -1), from: at });
    } else {
      runs.push({ text: item.hasEOL ? `${text}\n` : text, from: at });
    }
    at += text.length;
  }
  return wordsOf(runs, page);
}

/** Every page's words, read one page at a time; `keep` is asked before each. */
export async function pdfWords(
  pages: number,
  read: (page: number) => Promise<readonly PdfItem[]>,
  keep: () => boolean = () => true,
): Promise<Word[]> {
  const words: Word[] = [];
  for (let page = 1; page <= pages; page += 1) {
    if (!keep()) break;
    words.push(...pageWords(await read(page), page - 1));
  }
  return words;
}

/**
 * A page's words out of its `innerText`, which ends each block with a line
 * break and leaves out what the page hides.
 */
export function textWords(text: string): Word[] {
  return wordsOf([{ text, from: 0 }], 0, true);
}

/** Elements whose text starts a paragraph of its own. */
const BLOCKS = new Set([
  "P",
  "DIV",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "PRE",
  "TD",
  "TH",
  "DT",
  "DD",
  "FIGCAPTION",
  "SECTION",
  "ARTICLE",
  "ASIDE",
  "HEADER",
  "FOOTER",
  "TR",
]);

/**
 * The text nodes of a section's body, in order, and the `<br>` elements among
 * them. Script and style hold no words, and foliate's own walker skips them too.
 */
function textNodes(doc: Document): (Text | Element)[] {
  const root = doc.body ?? doc.documentElement;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const name = (node as Element).tagName.toUpperCase();
      if (name === "SCRIPT" || name === "STYLE") return NodeFilter.FILTER_REJECT;
      return name === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const nodes: (Text | Element)[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text | Element);
  }
  return nodes;
}

/** The nearest block holding `node`, which says where one paragraph gives way to the next. */
function blockOf(node: Node): Element | null {
  for (let at = node.parentElement; at; at = at.parentElement) {
    if (BLOCKS.has(at.tagName.toUpperCase())) return at;
  }
  return null;
}

/**
 * One book section's words. Each offset counts the characters of the text nodes
 * before it, which `rangeAt` and `offsetOf` count the same way.
 */
export function sectionWords(doc: Document, section: number): Word[] {
  const runs: Run[] = [];
  let at = 0;
  let block: Element | null | undefined;
  for (const node of textNodes(doc)) {
    if (node.nodeType !== Node.TEXT_NODE) {
      runs.push({ text: "\n", from: at });
      continue;
    }
    const holder = blockOf(node);
    if (block !== undefined && holder !== block) runs.push("break");
    block = holder;
    const text = node.nodeValue ?? "";
    runs.push({ text, from: at });
    at += text.length;
  }
  return wordsOf(runs, section);
}

/** A collapsed range at `offset` in a section's text, counted as `sectionWords` counts. */
export function rangeAt(doc: Document, offset: number): Range {
  const range = doc.createRange();
  let at = 0;
  let last: Text | null = null;
  for (const node of textNodes(doc)) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const length = node.nodeValue?.length ?? 0;
    last = node as Text;
    if (offset < at + length) {
      range.setStart(node, offset - at);
      range.collapse(true);
      return range;
    }
    at += length;
  }
  if (last !== null) range.setStart(last, last.nodeValue?.length ?? 0);
  range.collapse(true);
  return range;
}

/** Where `range` starts in a section's text, counted as `sectionWords` counts. */
export function offsetOf(doc: Document, range: Range): number {
  let at = 0;
  for (const node of textNodes(doc)) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    if (node === range.startContainer) return at + range.startOffset;
    // The first text at or after the start, for a range that starts on an element.
    if (range.comparePoint(node, 0) >= 0) return at;
    at += node.nodeValue?.length ?? 0;
  }
  return at;
}
