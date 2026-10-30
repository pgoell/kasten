import type { Line, Range, Text } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { linkAddress, unescaped } from "@/lib/link-reference";
import { HIDDEN, type Walk } from "@/lib/live/live-preview-hidden";
import { readRelation } from "@/lib/relation";
import { parseTodo } from "@/lib/todo/todo";
import { splitTarget, vaultPaths, wikiLinkLands } from "@/lib/wikilink";

/**
 * Inline constructs, by the node that wraps them.
 * The delimiter alone does not say which: `EmphasisMark` is both `**` and `*`.
 */
export interface Inline {
  mark: string;
  class: string;
}

export const INLINE: Record<string, Inline> = {
  StrongEmphasis: { mark: "EmphasisMark", class: "cm-strong" },
  Emphasis: { mark: "EmphasisMark", class: "cm-emphasis" },
  InlineCode: { mark: "CodeMark", class: "cm-inline-code" },
  Strikethrough: { mark: "StrikethroughMark", class: "cm-strikethrough" },
  Highlight: { mark: "HighlightMark", class: "cm-highlight" },
  // Its two `[[` and `]]` marks are the pair this reads, so a wikilink renders
  // as the note it names with nothing here that a bold word does not need.
  WikiLink: { mark: "WikiLinkMark", class: "cm-wikilink" },
};

/**
 * One ruby as an Anki import writes it, `<ruby>漢字<rt>かんじ</rt></ruby>`.
 * Only that shape is drawn; a hand-typed ruby stays as source rather than half right.
 */
const RUBY = /^<ruby>([^<]+)<rt>([^<]+)<\/rt><\/ruby>/;

/**
 * The reading over its base, the way Anki shows furigana.
 * A widget, not marks, so the tags do not show on screen around the word.
 */
class Ruby extends WidgetType {
  private readonly base: string;
  private readonly reading: string;

  constructor(base: string, reading: string) {
    super();
    this.base = base;
    this.reading = reading;
  }

  override eq(other: Ruby): boolean {
    return other.base === this.base && other.reading === this.reading;
  }

  toDOM(): HTMLElement {
    const ruby = document.createElement("ruby");
    ruby.className = "cm-ruby";
    ruby.append(this.base);
    const reading = ruby.appendChild(document.createElement("rt"));
    reading.textContent = this.reading;
    return ruby;
  }
}

/**
 * The mark that takes a link colour off a `[text]` or `![alt][ref]` no definition names.
 * The highlighter colours every Link node as a link, so this undoes that for plain text.
 */
export function plainBrackets(doc: Text, node: SyntaxNode): Range<Decoration> | null {
  if (node.getChildren("LinkMark").length > 2 || linkAddress(node, doc) !== null) return null;
  // A heading's colour sits on the same spans as the link's, so the CSS has to
  // be told to give it back. Read off the tree, because a setext heading's line
  // carries no heading class.
  let inHeading = false;
  for (let up = node.parent; up; up = up.parent) {
    if (/^(ATX|Setext)Heading[1-6]$/.test(up.name)) inHeading = true;
  }
  const name = inHeading ? "cm-plain-brackets cm-plain-brackets-heading" : "cm-plain-brackets";
  return Decoration.mark({ class: name }).range(node.from, node.to);
}

/**
 * The parser reads each of the four tags as its own node, so the ruby is read from its opening one.
 * `drawn` stops the walk hiding an escape inside the widget.
 */
export function drawRuby(walk: Walk, from: number, line: Line, revealed: boolean): void {
  const { state, decorations, hidden } = walk;
  if (revealed) return;
  const found = RUBY.exec(state.doc.sliceString(from, line.to));
  if (found === null) return;
  const [whole, base = "", reading = ""] = found;
  const end = from + whole.length;
  const widget = new Ruby(unescaped(base), unescaped(reading));
  decorations.push(Decoration.replace({ widget }).range(from, end));
  hidden.push(HIDDEN.range(from, end));
  walk.drawn = end;
}

/**
 * A task's box parses as a link, which the bullet's symbol must match on a revealed line.
 * Told apart by the `(` mark rather than the URL: `[a]()` is a link to nowhere (#441).
 */
export function drawLink(walk: Walk, node: SyntaxNode, line: Line, revealed: boolean): void {
  const { state, decorations } = walk;
  const todo = parseTodo(line.text);
  if (todo !== null && node.from === line.from + todo.indent + 2) return;
  const plain = plainBrackets(state.doc, node);
  if (plain !== null) {
    decorations.push(plain);
    return;
  }

  // A link carries four marks, `[`, `]`, `(` and `)`. The first two
  // bracket the text worth showing; everything from the second to the end
  // of the node is `](url)`, or a reference's `][label]`, and goes.
  const marks: { from: number; to: number }[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "LinkMark") marks.push({ from: child.from, to: child.to });
  }
  const [open, close] = marks;
  if (!open || !close) return;

  if (open.to < close.from) {
    decorations.push(Decoration.mark({ class: "cm-link" }).range(open.to, close.from));
  }
  if (revealed) return;
  walk.hide(open.from, open.to);
  walk.hide(close.from, node.to);
}

/**
 * The name in front of a relation, hung off the wikilink.
 * Nothing is hidden, so the class goes on the cursor's line too, as `cm-tag` does.
 */
export function markRelation(walk: Walk, from: number, line: Line): void {
  const relation = readRelation(line.text);
  if (relation !== null && line.from + line.text.indexOf("[[") === from) {
    // The pattern anchors the name near the head of the line, so the
    // first spelling of it is the one in front. Two for the `::`.
    const at = line.from + line.text.indexOf(relation.name);
    walk.decorations.push(
      Decoration.mark({ class: "cm-relation" }).range(at, at + relation.name.length + 2),
    );
  }
}

export function drawInline(walk: Walk, node: SyntaxNode, inline: Inline, revealed: boolean): void {
  const { state, decorations } = walk;
  let open: { from: number; to: number } | null = null;
  let close: { from: number; to: number } | null = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== inline.mark) continue;
    open ??= { from: child.from, to: child.to };
    close = { from: child.from, to: child.to };
  }
  // An unclosed delimiter parses as a single mark. Nothing to render.
  if (!open || !close || open.from === close.from) return;

  if (open.to < close.from) {
    // The one construct whose rendering depends on something outside the
    // document: a wikilink to a note the vault does not hold is drawn as
    // the invitation it is rather than as a link that works.
    const target = state.doc.sliceString(open.to, close.from);
    const paths = node.name === "WikiLink" ? state.facet(vaultPaths) : null;
    const dead = paths !== null && !wikiLinkLands(target, paths);
    const className = dead ? `${inline.class} cm-wikilink-dead` : inline.class;

    // `[[note|alias]]` reads as the alias, the name and the bar going with
    // the brackets. The class stays on text in the document, so a click on
    // the alias still finds the link around it.
    const alias = node.name === "WikiLink" ? splitTarget(target).alias : null;
    if (alias !== null && !revealed) {
      const shown = open.to + target.indexOf("|") + 1;
      decorations.push(Decoration.mark({ class: className }).range(shown, close.from));
      walk.hide(open.from, shown);
      walk.hide(close.from, close.to);
      return;
    }
    decorations.push(Decoration.mark({ class: className }).range(open.to, close.from));
  }
  if (revealed) return;
  walk.hide(open.from, open.to);
  walk.hide(close.from, close.to);
}
