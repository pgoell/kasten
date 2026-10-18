/**
 * The address a markdown link points at, its own `(url)` or a definition's.
 *
 * The parser reads `[text]`, `[text][]` and `[text][label]` as links whatever
 * the note holds, and a definition `[label]: url` as a `LinkReference` block,
 * but it never joins the two. Live preview, Copy as and the editor's click
 * all ask here, so a reference link draws, copies and opens as the inline
 * link it stands for.
 */

import type { SyntaxNode, Tree } from "@lezer/common";

/** The text a tree was parsed from: a CodeMirror `Text`, or `sourceOf` a string. */
export interface Source {
  readonly length: number;
  sliceString(from: number, to?: number): string;
}

export function sourceOf(text: string): Source {
  return { length: text.length, sliceString: (from, to) => text.slice(from, to) };
}

/**
 * The blocks a definition can sit in, besides the document. Everything else is
 * a leaf, which holds none, so the scan never walks a paragraph's inline
 * nodes, and the text of a fence defines nothing.
 */
const HOLDERS = new Set(["Blockquote", "BulletList", "OrderedList", "ListItem"]);

/** A definition on a line of its own, as CommonMark shapes one. */
const DEFINITION = /^ {0,3}\[([^\]]+)\]:[ \t]*(<[^>\n]*>|\S+)/;

const scanned = new WeakMap<Tree, Map<string, string>>();

/**
 * The address of a `Link` or `Image`: its `(url)`, else, for a link with no
 * `(`, the address of the definition its label names. Null when it has none.
 * An image's reference stays as typed, live preview drawing no picture from it.
 */
export function linkAddress(node: SyntaxNode, doc: Source): string | null {
  const url = node.getChild("URL");
  if (url !== null) return unbracket(doc.sliceString(url.from, url.to));
  const marks = node.getChildren("LinkMark");
  if (node.name !== "Link" || marks.length > 2) return null;
  const [open, close] = marks;
  if (!open || !close) return null;
  // The full form names its label; the shortcut and the collapsed `[text][]`
  // are their own label.
  const named = node.getChild("LinkLabel");
  const label = normal(
    (named !== null && doc.sliceString(named.from + 1, named.to - 1)) ||
      doc.sliceString(open.to, close.from),
  );
  // `[^1]` is a footnote, which Obsidian never draws as a link.
  if (label.startsWith("^")) return null;
  // The tree the link belongs to, not one it is mounted in: a markdown fence
  // is a note of its own and takes no definition from around it.
  let top = node;
  while (!top.type.isTop && top.parent !== null) top = top.parent;
  return definitions(top, doc).get(label) ?? null;
}

/**
 * Hands `tree` the definitions of `note`. Copy as of a selection parses the
 * selection alone, and its links name definitions anywhere in the note.
 */
export function lendDefinitions(tree: Tree, note: Tree, doc: Source): void {
  scanned.set(tree, definitions(note.topNode, doc));
}

/** The definitions of the note `top` heads, read once per parse. */
function definitions(top: SyntaxNode, doc: Source): Map<string, string> {
  const tree = top.tree;
  const known = tree === null ? undefined : scanned.get(tree);
  if (known !== undefined) return known;

  const found = new Map<string, string>();
  collect(top, doc, found);
  // CodeMirror parses a long note a slice at a time, so its tree can stop
  // short of a definition at the end. The rest is read by line, as a fence
  // there would not be, until the tree reaches it. A fence's own tree ends
  // short of the note too, and has no rest.
  if (top.to < doc.length && (top.parent === null || top.parent.type.isTop)) {
    for (const line of doc.sliceString(top.to).split("\n")) {
      const match = DEFINITION.exec(line);
      if (match?.[1] !== undefined && match[2] !== undefined) add(found, match[1], match[2]);
    }
  }
  if (tree !== null) scanned.set(tree, found);
  return found;
}

/** The definitions under `parent`, in document order. */
function collect(parent: SyntaxNode, doc: Source, found: Map<string, string>): void {
  for (let child = parent.firstChild; child !== null; child = child.nextSibling) {
    if (HOLDERS.has(child.name)) collect(child, doc, found);
    if (child.name !== "LinkReference") continue;
    const label = child.getChild("LinkLabel");
    const url = child.getChild("URL");
    if (label === null || url === null) continue;
    add(found, doc.sliceString(label.from + 1, label.to - 1), doc.sliceString(url.from, url.to));
  }
}

/** The first definition of a label is the one that counts, as CommonMark has it. */
function add(found: Map<string, string>, label: string, url: string): void {
  const key = normal(label);
  if (key !== "" && !found.has(key)) found.set(key, unbracket(url));
}

/** A label as CommonMark matches it: case and runs of space do not count. */
function normal(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** `<url>` is the same address as `url`; the brackets are syntax (#443). */
function unbracket(url: string): string {
  return url.replace(/^<(.*)>$/, "$1");
}
