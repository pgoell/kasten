/**
 * A note's markdown rewritten for the chat it is about to be pasted into.
 *
 * Slack's message box reads its own markup out of plain text when the message
 * is sent: one asterisk for bold, underscores for italics, and no headings,
 * list syntax or links with a label. Teams reads none of it, but keeps the
 * formatting of pasted HTML. So Slack gets text and Teams gets HTML.
 *
 * Both walk the note's own parse, wikilinks and highlights included, so
 * nothing the editor draws as structure reaches the chat as punctuation.
 */

import type { SyntaxNode } from "@lezer/common";
import { GFM, parser } from "@lezer/markdown";
import { Highlight } from "@/lib/markdown-highlight";
import { noteBody } from "@/lib/note-frontmatter";
import { Tag } from "@/lib/tag";
import { WikiLink } from "@/lib/wikilink";

type Format = "slack" | "html";

const notes = parser.configure([GFM, Highlight, Tag, WikiLink]);

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
]);

/** Blocks with nothing a reader of the chat should see. */
const UNSEEN = new Set(["LinkReference", "CommentBlock", "ProcessingInstructionBlock"]);

export function toSlack(markdown: string): string {
  return render(markdown, "slack");
}

export function toHtml(markdown: string): string {
  return render(markdown, "html");
}

function render(markdown: string, format: Format): string {
  const source = noteBody(markdown);
  const top = notes.parse(source).topNode;
  return blocks(top, source, format);
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
): string {
  let out = "";
  let pos = from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    out += prose(source.slice(pos, child.from), format);
    out += span(child, source, format);
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
    case "WikiLink":
      return prose(text.slice(2, -2), format);
    case "Link":
    case "Image": {
      // `[label](url)`: the label runs from after the first bracket to the
      // closing one, the second LinkMark.
      const close = node.getChildren("LinkMark")[1];
      const start = node.from + (node.name === "Image" ? 2 : 1);
      const label = inline(node, source, format, start, close ? close.from : node.to);
      const url = node.getChild("URL");
      return url ? link(label, source.slice(url.from, url.to), format) : label;
    }
    case "Autolink": {
      const url = node.getChild("URL");
      return link("", url ? source.slice(url.from, url.to) : text, format);
    }
    case "URL":
      return link("", text, format);
    case "Escape":
      return prose(text.slice(1), format);
    case "HardBreak":
      return format === "html" ? "<br>" : "\n";
    default:
      return node.firstChild ? inline(node, source, format) : prose(text, format);
  }
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
      const body = blocks(node, source, format);
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

function list(node: SyntaxNode, source: string, format: Format): string {
  const ordered = node.name === "OrderedList";
  const items = node.getChildren("ListItem").map((item) => {
    const parts: string[] = [];
    for (let child = item.firstChild; child; child = child.nextSibling) {
      if (child.name === "ListMark") continue;
      if (child.name === "Task") {
        const marker = child.getChild("TaskMarker");
        const done = marker !== null && /x/i.test(source.slice(marker.from, marker.to));
        parts.push(`${done ? "☑" : "☐"} ${inline(child, source, format).trim()}`);
      } else if (child.name === "Paragraph") {
        // A list item's paragraph as bare text, so a tight list stays tight.
        parts.push(inline(child, source, format));
      } else {
        parts.push(block(child, source, format));
      }
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
