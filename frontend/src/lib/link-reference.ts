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

/** Reads the document the tree was parsed from. */
type Read = (from: number, to: number) => string;

/**
 * The blocks a definition can sit in, besides the document. Everything else is
 * a leaf, which holds none, so the scan never walks a paragraph's inline
 * nodes, and the text of a fence defines nothing.
 */
const HOLDERS = new Set(["Blockquote", "BulletList", "OrderedList", "ListItem"]);

const scanned = new WeakMap<Tree, Map<string, string>>();

/**
 * The address of a `Link` or `Image`: its `(url)`, else, for a link with no
 * `(`, the address of the definition its label names. Null when it has none.
 * An image's reference stays as typed, live preview drawing no picture from it.
 */
export function linkAddress(node: SyntaxNode, read: Read): string | null {
  const url = node.getChild("URL");
  if (url !== null) return unbracket(read(url.from, url.to));
  const marks = node.getChildren("LinkMark");
  if (node.name !== "Link" || marks.length > 2) return null;
  const [open, close] = marks;
  if (!open || !close) return null;
  // The full form names its label; the shortcut and the collapsed `[text][]`
  // are their own label.
  const named = node.getChild("LinkLabel");
  const label = named === null ? "" : read(named.from + 1, named.to - 1);
  return definitions(node, read).get(normal(label || read(open.to, close.from))) ?? null;
}

/** The definitions of the note `node` sits in, read once per parse. */
function definitions(node: SyntaxNode, read: Read): Map<string, string> {
  let top = node;
  while (top.parent !== null) top = top.parent;
  const tree = top.tree;
  const known = tree === null ? undefined : scanned.get(tree);
  if (known !== undefined) return known;

  const found = new Map<string, string>();
  collect(top, read, found);
  if (tree !== null) scanned.set(tree, found);
  return found;
}

/**
 * The definitions under `parent`, in document order. A mounted tree, the note
 * under its frontmatter, comes back as its own top node.
 */
function collect(parent: SyntaxNode, read: Read, found: Map<string, string>): void {
  for (let child = parent.firstChild; child !== null; child = child.nextSibling) {
    if (child.type.isTop || HOLDERS.has(child.name)) collect(child, read, found);
    if (child.name !== "LinkReference") continue;
    const label = child.getChild("LinkLabel");
    const url = child.getChild("URL");
    if (label === null || url === null) continue;
    const key = normal(read(label.from + 1, label.to - 1));
    // The first definition of a label is the one that counts, as CommonMark has it.
    if (!found.has(key)) found.set(key, unbracket(read(url.from, url.to)));
  }
}

/** A label as CommonMark matches it: case and runs of space do not count. */
function normal(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** `<url>` is the same address as `url`; the brackets are syntax (#443). */
function unbracket(url: string): string {
  return url.replace(/^<(.*)>$/, "$1");
}
