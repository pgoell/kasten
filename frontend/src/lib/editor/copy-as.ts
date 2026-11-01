/**
 * Rewrites a note's markdown for the chat it is pasted into. Slack reads plain-text markup,
 * so it gets text; Teams keeps pasted HTML, so it gets HTML. Both walk the parse, so no drawn structure leaks out as punctuation.
 */

import type { SyntaxNode } from "@lezer/common";
import { GFM, parser } from "@lezer/markdown";
import { parseCallout } from "@/lib/callout";
import { isScript, lendDefinitions, linkAddress, sourceOf } from "@/lib/link-reference";
import { Highlight } from "@/lib/markdown-highlight";
import { MathSyntax } from "@/lib/math";
import { noteBody } from "@/lib/note-frontmatter";
import { Tag } from "@/lib/tag";
import { splitTarget, WikiLink } from "@/lib/wikilink";

type Format = "slack" | "html";

const notes = parser.configure([GFM, Highlight, MathSyntax, Tag, WikiLink]);

/** Syntax a parent spells out in the target's own terms, or drops. */
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
  // An embed's `!`: the chat gets the link inside, which the default case
  // reaches by walking into the `Embed`.
  "EmbedMark",
]);

/** Blocks with nothing a reader of the chat should see. */
const UNSEEN = new Set(["LinkReference", "CommentBlock", "ProcessingInstructionBlock"]);

/** `markdown` for Slack; `note`, when it is a part of one, holds its definitions. */
export function toSlack(markdown: string, note?: string): string {
  return render(markdown, "slack", note);
}

/** `markdown` for Teams; `note`, when it is a part of one, holds its definitions. */
export function toHtml(markdown: string, note?: string): string {
  return render(markdown, "html", note);
}

function render(markdown: string, format: Format, note?: string): string {
  const source = noteBody(markdown);
  const tree = notes.parse(source);
  if (note !== undefined) {
    const whole = noteBody(note);
    lendDefinitions(tree, sourceOf(source), notes.parse(whole), sourceOf(whole));
  }
  return blocks(tree.topNode, source, format);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Prose between two nodes. A paragraph continued inside a list item carries
 * the item's indent on each line, which is layout and not text.
 */
function prose(text: string, format: Format): string {
  const lines = text.replace(/\n[ \t]*/g, "\n");
  return format === "html" ? escapeHtml(lines) : lines;
}

function wrap(body: string, format: Format, slack: string, tag: string): string {
  return format === "html" ? `<${tag}>${body}</${tag}>` : `${slack}${body}${slack}`;
}

function link(label: string, url: string, format: Format): string {
  if (format === "html") return `<a href="${escapeHtml(url)}">${label || escapeHtml(url)}</a>`;
  // The label goes in front of the address rather than into Slack's
  // `<url|label>`, which only messages sent through the API understand.
  return label && label !== url ? `${label} (${url})` : url;
}

/** The inline content of `node` between `from` and `to`, marks left out. */
function inline(
  node: SyntaxNode,
  source: string,
  format: Format,
  from = node.from,
  to = node.to,
  render = span,
): string {
  let out = "";
  let pos = from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    out += prose(source.slice(pos, child.from), format);
    out += render(child, source, format);
    pos = child.to;
    // The space after a continued quote's `>` belongs to the mark.
    if (child.name === "QuoteMark" && source[pos] === " ") pos += 1;
  }
  return out + prose(source.slice(pos, to), format);
}

function span(node: SyntaxNode, source: string, format: Format): string {
  if (MARKS.has(node.name)) return "";
  const text = source.slice(node.from, node.to);

  switch (node.name) {
    case "StrongEmphasis":
      return wrap(inline(node, source, format), format, "*", "strong");
    case "Emphasis":
      return wrap(inline(node, source, format), format, "_", "em");
    case "Strikethrough":
      return wrap(inline(node, source, format), format, "~", "s");
    case "InlineCode":
      return wrap(inline(node, source, format), format, "`", "code");
    case "Highlight":
      return format === "html"
        ? `<mark>${inline(node, source, format)}</mark>`
        : inline(node, source, format);
    case "WikiLink": {
      // What live preview shows: the alias, else the target as written.
      const target = text.slice(2, -2);
      return prose(splitTarget(target).alias ?? target, format);
    }
    case "Link":
    case "Image":
      return linkSpan(node, source, format);
    case "Autolink": {
      const url = node.getChild("URL");
      return link("", url ? source.slice(url.from, url.to) : text, format);
    }
    case "URL":
      return link("", text, format);
    // Neither chat draws math, so a formula goes out as the source it was
    // written in, as code: Slack would read the `*` of `$a*b*c$` as bold.
    case "InlineMath":
      return wrap(format === "html" ? escapeHtml(text) : text, format, "`", "code");
    case "Escape":
      return prose(text.slice(1), format);
    case "HardBreak":
      return format === "html" ? "<br>" : "\n";
    default:
      return node.firstChild ? inline(node, source, format) : prose(text, format);
  }
}

function linkSpan(node: SyntaxNode, source: string, format: Format): string {
  // `[label](url)`: the label runs from after the first bracket to the
  // closing one, the second LinkMark, so a reference's `[label]` after it
  // stays out.
  const close = node.getChildren("LinkMark")[1];
  const start = node.from + (node.name === "Image" ? 2 : 1);
  const label = inline(node, source, format, start, close ? close.from : node.to);
  // `<>` is an empty address (#443).
  const address = linkAddress(node, sourceOf(source)) ?? "";
  // A script would run in the chat's page on a click, so it goes out as
  // the text alone (#549).
  if (isScript(address)) return label;
  if (address) return link(label, address, format);
  // The parser reads any `[text]` or `![alt]` with no `(url)` as a link
  // or an image. One no definition resolves (#439) goes out as the editor
  // shows it, brackets and any `[ref]` after them included (#442).
  // `[a]()`, with its `(` mark, is a link to nowhere and goes out as its
  // label.
  if (close && node.getChildren("LinkMark").length < 3) {
    const open = node.name === "Image" ? "![" : "[";
    return `${open}${label}${prose(source.slice(close.from, node.to), format)}`;
  }
  return label;
}

/** The blocks under `node`, each rendered and set apart from the next. */
function blocks(node: SyntaxNode, source: string, format: Format): string {
  const out: string[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (MARKS.has(child.name) || UNSEEN.has(child.name)) continue;
    out.push(block(child, source, format));
  }
  return out.filter((part) => part !== "").join(format === "html" ? "" : "\n\n");
}

function block(node: SyntaxNode, source: string, format: Format): string {
  const html = format === "html";
  const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
  if (heading) {
    const text = inline(node, source, format).trim();
    // Slack has no heading, and bold on a line of its own reads as one.
    return html ? `<h${heading[1]}>${text}</h${heading[1]}>` : `*${text}*`;
  }

  switch (node.name) {
    case "Paragraph":
      return html ? `<p>${inline(node, source, format)}</p>` : inline(node, source, format);
    case "Blockquote": {
      const body = callout(node, source, format) ?? blocks(node, source, format);
      return html ? `<blockquote>${body}</blockquote>` : body.replace(/^/gm, "> ");
    }
    case "BulletList":
    case "OrderedList":
      return list(node, source, format);
    case "FencedCode":
    case "CodeBlock": {
      const code = node
        .getChildren("CodeText")
        .map((text) => source.slice(text.from, text.to))
        .join("\n");
      // No language after the fence: Slack would print it as the first line.
      return html ? `<pre><code>${escapeHtml(code)}</code></pre>` : `\`\`\`\n${code}\n\`\`\``;
    }
    case "BlockMath": {
      // The lines under the first carry the `>` and the indent of the quote
      // or list the formula sits in, up to the column it opens at, which the
      // quote or list puts back on its own.
      const column = node.from - (source.lastIndexOf("\n", node.from - 1) + 1);
      const text = source
        .slice(node.from, node.to)
        .split("\n")
        .map((line, index) => {
          if (index === 0) return line;
          const prefix = /^[ \t>]*/.exec(line)?.[0].length ?? 0;
          return line.slice(Math.min(column, prefix));
        })
        .join("\n");
      return html ? `<pre><code>${escapeHtml(text)}</code></pre>` : `\`\`\`\n${text}\n\`\`\``;
    }
    case "HorizontalRule":
      return html ? "<hr>" : "---";
    case "Table":
      return table(node, source, format);
    case "HTMLBlock":
      return source.slice(node.from, node.to);
    default:
      return inline(node, source, format);
  }
}

/**
 * A quote opening `[!type]` as a bold header and body, or null. Neither chat draws callouts,
 * and `[!warning]-` pasted as it stands reads as noise.
 */
function callout(node: SyntaxNode, source: string, format: Format): string | null {
  const mark = node.firstChild;
  let first = mark;
  while (first && MARKS.has(first.name)) first = first.nextSibling;
  if (!mark || first?.name !== "Paragraph") return null;
  // The header must sit on the quote's own first line, as the editor reads
  // it: a paragraph that starts lower down, under a bare `>`, opens nothing.
  if (source.slice(mark.to, first.from).trim() !== "") return null;
  const newline = source.indexOf("\n", first.from);
  const header = parseCallout(
    source.slice(first.from, newline === -1 || newline > first.to ? first.to : newline),
  );
  if (!header) return null;
  const lineEnd = titleEnd(first, newline);

  const title = header.titled
    ? inline(first, source, format, first.from + header.length, lineEnd, plain)
        .trim()
        .replace(/\n/g, " ")
    : prose(header.title, format);
  const body = calloutBody(first, lineEnd, source, format).filter((part) => part !== "");
  if (format === "html") return `<p><strong>${title}</strong></p>${body.join("")}`;
  return [`*${title}*`, body.join("\n\n")].filter((part) => part !== "").join("\n");
}

/**
 * Where a callout's title ends in its first paragraph. An emphasis opened in the title and closed on a
 * later line belongs to the title, or the body would print it a second time.
 */
function titleEnd(first: SyntaxNode, newline: number): number {
  let lineEnd = newline === -1 || newline > first.to ? first.to : newline;
  for (let child = first.firstChild; child; child = child.nextSibling) {
    if (child.from < lineEnd && child.to > lineEnd) lineEnd = child.to;
  }
  return lineEnd;
}

/** The blocks under a callout's title, the rest of its first paragraph first. */
function calloutBody(first: SyntaxNode, lineEnd: number, source: string, format: Format): string[] {
  const parts: string[] = [];
  // The paragraph runs on past the header when the body follows on the next line.
  if (lineEnd < first.to) {
    const rest = inline(first, source, format, lineEnd).replace(/^\n/, "");
    parts.push(format === "html" ? `<p>${rest}</p>` : rest);
  }
  for (let child = first.nextSibling; child; child = child.nextSibling) {
    if (MARKS.has(child.name) || UNSEEN.has(child.name)) continue;
    parts.push(block(child, source, format));
  }
  return parts;
}

/**
 * A callout title's span. Slack's bold cannot hold a bold or an italic of its
 * own, the inner `*` closing it early, so emphasis there goes out as its text.
 */
function plain(node: SyntaxNode, source: string, format: Format): string {
  if (format === "slack" && (node.name === "StrongEmphasis" || node.name === "Emphasis")) {
    return inline(node, source, format, node.from, node.to, plain);
  }
  return span(node, source, format);
}

function list(node: SyntaxNode, source: string, format: Format): string {
  const ordered = node.name === "OrderedList";
  const items = node.getChildren("ListItem").map((item) => {
    const parts: string[] = [];
    for (let child = item.firstChild; child; child = child.nextSibling) {
      if (child.name !== "ListMark") parts.push(itemPart(child, source, format));
    }

    if (format === "html") return `<li>${parts.join("")}</li>`;
    const mark = item.getChild("ListMark");
    const bullet = ordered && mark ? source.slice(mark.from, mark.to) : "•";
    // Everything after the first line is indented under the bullet, which is
    // how a nested list stays nested in a box that draws no lists.
    return `${bullet} ${parts.join("\n").replace(/\n/g, "\n    ")}`;
  });

  if (format !== "html") return items.join("\n");
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.join("")}</${tag}>`;
}

function itemPart(child: SyntaxNode, source: string, format: Format): string {
  if (child.name === "Task") {
    const marker = child.getChild("TaskMarker");
    const done = marker !== null && /x/i.test(source.slice(marker.from, marker.to));
    return `${done ? "☑" : "☐"} ${inline(child, source, format).trim()}`;
  }
  // A list item's paragraph as bare text, so a tight list stays tight.
  if (child.name === "Paragraph") return inline(child, source, format);
  return block(child, source, format);
}

function table(node: SyntaxNode, source: string, format: Format): string {
  // A box that draws no tables still lines columns up in a monospaced face.
  if (format !== "html") return `\`\`\`\n${source.slice(node.from, node.to)}\n\`\`\``;

  const rows: string[] = [];
  for (let row = node.firstChild; row; row = row.nextSibling) {
    if (row.name !== "TableHeader" && row.name !== "TableRow") continue;
    const cell = row.name === "TableHeader" ? "th" : "td";
    const cells = row
      .getChildren("TableCell")
      .map((it) => `<${cell}>${inline(it, source, format).trim()}</${cell}>`);
    rows.push(`<tr>${cells.join("")}</tr>`);
  }
  return `<table>${rows.join("")}</table>`;
}
