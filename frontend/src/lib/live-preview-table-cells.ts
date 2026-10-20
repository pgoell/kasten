import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { linkAddress, urlLinkAt } from "@/lib/link-reference";
import {
  drawnImage,
  embeddedPicture,
  type Pictured,
  spacedAddress,
} from "@/lib/live-preview-images";
import { INLINE } from "@/lib/live-preview-inline";
import { splitTarget, vaultPaths, wikiLinkLands } from "@/lib/wikilink";

/** A run of a cell's text drawn as one element. */
export interface Span {
  text: string;
  /** The class the construct wears, or null for text that carries none. */
  class: string | null;
  /** The picture an `![](path)` or `![[x.png]]` draws, standing in for the text. */
  image?: Pictured;
  /**
   * The address the link around this span opens in a tab, if it opens one.
   * Read here because the block cannot read it back: `posAtDOM` inside a block
   * widget answers the block's own position, not the cell's.
   */
  address?: string;
  /** The note the wikilink this span draws names, as `wikiLinkAt` reads it, for the same reason. */
  target?: string;
}

/** What a construct inside a cell shows and the classes it wears, or null. */
function markedText(state: EditorState, node: SyntaxNode): Span[] | null {
  const whole = state.doc.sliceString(node.from, node.to);
  if (node.name === "Tag") return [{ text: whole, class: "cm-tag" }];
  // Only a picture: a player or a sound control has no business in a cell, so
  // those stay their source, as an address that cannot load does.
  if (node.name === "Image") {
    const drawn = drawnImage(state, node);
    if (drawn?.kind !== "picture") return null;
    const to = spacedAddress(state.doc, node)?.to ?? node.to;
    const text = state.doc.sliceString(node.from, to);
    return [{ text, class: null, image: { source: drawn.source, alt: drawn.alt } }];
  }
  // Only a picture again: a note or a pdf drawn in a cell would be a page
  // inside a table, so those stay their source, as a missing picture does.
  if (node.name === "Embed") {
    const link = node.getChild("WikiLink");
    if (link === null) return null;
    const { name, alias } = splitTarget(state.doc.sliceString(link.from + 2, link.to - 2));
    const image = embeddedPicture(state, name, alias);
    return image === null ? null : [{ text: whole, class: null, image }];
  }
  // The character alone, as off a table: a cell is drawn from its spans, so
  // the backslash a table needs before a bar would otherwise show.
  if (node.name === "Escape") return [{ text: whole.slice(1), class: null }];
  const inline = INLINE[node.name];
  if (!inline && node.name !== "Link") return null;
  // A `[text]` with no `(url)` and no definition stays text, brackets and all:
  // see the walk.
  if (
    node.name === "Link" &&
    node.getChildren("LinkMark").length < 3 &&
    linkAddress(node, state.doc) === null
  ) {
    return null;
  }

  // The first two marks, which is all an inline construct has and, on a link,
  // the `[` and `]` around the text rather than the `(url)` that does not show.
  const marks: SyntaxNode[] = [];
  const name = inline ? inline.mark : "LinkMark";
  for (let child = node.firstChild; child && marks.length < 2; child = child.nextSibling) {
    if (child.name === name) marks.push(child);
  }
  const [open, close] = marks;
  if (!open || !close || open.to >= close.from) return null;

  const className = inline ? inline.class : "cm-link";
  if (node.name === "WikiLink") {
    const text = state.doc.sliceString(open.to, close.from);
    const paths = state.facet(vaultPaths);
    const dead = paths !== null && !wikiLinkLands(text, paths);
    const alias = splitTarget(text).alias;
    // The bar's backslash is the table's, so the target is the one the same
    // link hands on off a table.
    const target = text.replace("\\|", "|").trim();
    return [
      { text: alias ?? text, class: dead ? `${className} cm-wikilink-dead` : className, target },
    ];
  }

  // GFM takes a `\|` in a cell as a bar before it reads the code span, so its
  // backslash goes here too, while a code span keeps every other escape as
  // written. The parser makes no Escape inside a code span to cut on.
  if (node.name === "InlineCode") {
    const text = state.doc.sliceString(open.to, close.from).replaceAll("\\|", "|");
    return [{ text, class: className }];
  }

  // What the marks enclose is cut as a cell is, so a picture inside a link or
  // a bold run is drawn rather than shown as its source. A picture wears no
  // class; the text around it wears this one beside any of its own. Inside a
  // link that opens a tab, the picture and the text both carry its address.
  const address = node.name === "Link" ? urlLinkAt(node, state.doc)?.address : undefined;
  return spansIn(state, node, open.to, close.from).map((span) => ({
    ...span,
    ...(span.image ? {} : { class: span.class ? `${className} ${span.class}` : className }),
    ...(address === undefined ? {} : { address }),
  }));
}

/** The text of `parent` from `from` to `to`, cut at the constructs inside it. */
function spansIn(state: EditorState, parent: SyntaxNode, from: number, to: number): Span[] {
  const spans: Span[] = [];
  let at = from;
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    // The marks of a construct being cut, which sit outside the range, and
    // what a picture's spaced address already took in.
    if (child.from < from || child.to > to || child.from < at) continue;
    const marked = markedText(state, child);
    if (marked === null) continue;
    if (child.from > at) spans.push({ text: state.doc.sliceString(at, child.from), class: null });
    spans.push(...marked);
    at = (child.name === "Image" && spacedAddress(state.doc, child)?.to) || child.to;
  }
  if (at < to) spans.push({ text: state.doc.sliceString(at, to), class: null });
  return spans;
}

/**
 * One row's columns, counted off its walls rather than off its cells.
 *
 * An empty cell has no node, so `| a |  | c |` carries two cells and three
 * columns. The walls are what say which column a cell is in, and the last one
 * closes a column only when the row ends with it.
 */
export function rowSpans(state: EditorState, row: SyntaxNode): Span[][] {
  const cells: Span[][] = [];
  let open = false;
  let current: Span[] | null = null;

  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableCell") {
      current = spansIn(state, child, child.from, child.to);
      continue;
    }
    if (child.name !== "TableDelimiter") continue;
    if (open || current !== null) cells.push(current ?? []);
    open = true;
    current = null;
  }
  if (current !== null) cells.push(current);
  return cells;
}
