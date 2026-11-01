/**
 * A link's address, its own `(url)` or its label's definition. The parser does not join
 * the two, so live preview, Copy as and the click all ask here.
 */

import type { SyntaxNode, Tree } from "@lezer/common";
import { namesAFile } from "@/lib/wikilink";

/** The text a tree was parsed from: a CodeMirror `Text`, or `sourceOf` a string. */
export interface Source {
  readonly length: number;
  sliceString(from: number, to?: number): string;
}

export function sourceOf(text: string): Source {
  return { length: text.length, sliceString: (from, to) => text.slice(from, to) };
}

/**
 * Blocks a definition can sit in, besides the document. Other nodes are leaves, so a fence
 * or a paragraph defines nothing.
 */
const HOLDERS = new Set(["Blockquote", "BulletList", "OrderedList", "ListItem"]);

/** A definition on its own line. A <url> may hold \> and \< without ending (#447). */
const DEFINITION = /^ {0,3}\[([^\]]+)\]:[ \t]*(<(?:\\.|[^<>\\\n])*>|\S+)/;

const scanned = new WeakMap<Tree, Map<string, string>>();

/**
 * The address of a `Link` or `Image`: its `(url)`, else its label's definition, or null.
 * An image reads a definition as a link does (#547).
 */
export function linkAddress(node: SyntaxNode, doc: Source): string | null {
  const url = node.getChild("URL");
  if (url !== null) return unescaped(unbracket(doc.sliceString(url.from, url.to)));
  const marks = node.getChildren("LinkMark");
  if (marks.length > 2) return null;
  const [open, close] = marks;
  if (!open || !close) return null;
  // The full form names its label; `[text][]` and the shortcut use their text.
  const named = node.getChild("LinkLabel");
  const label = normal(
    (named !== null && doc.sliceString(named.from + 1, named.to - 1)) ||
      doc.sliceString(open.to, close.from),
  );
  // `[^1]` is a footnote, which Obsidian never draws as a link.
  if (label.startsWith("^")) return null;
  // A fence is a note of its own: it takes no definition from around it.
  let top = node;
  while (!top.type.isTop && top.parent !== null) top = top.parent;
  return definitions(top, doc).get(label) ?? null;
}

/**
 * Gives `tree` the note's definitions, as Copy as parses a selection alone. The selection's
 * own still count for a label the note lacks, as in a fence the note reads as code.
 */
export function lendDefinitions(tree: Tree, doc: Source, note: Tree, noteDoc: Source): void {
  const merged = new Map(definitions(note.topNode, noteDoc));
  for (const [label, url] of definitions(tree.topNode, doc)) {
    if (!merged.has(label)) merged.set(label, url);
  }
  scanned.set(tree, merged);
}

/** An address that runs a script where it opens, never followed nor copied as a link. */
export function isScript(address: string): boolean {
  return /^(javascript|data|vbscript):/i.test(address);
}

/** A markdown link to an address, and where its source sits in the note. */
export interface UrlLink {
  address: string;
  from: number;
  to: number;
}

/**
 * The `Link` at or above `node` when it opens in a new tab, else null. Only a scheme
 * address: a relative one resolves against kasten, and a script would run here (#548).
 */
export function urlLinkAt(node: SyntaxNode | null, doc: Source): UrlLink | null {
  for (let up = node; up !== null; up = up.parent) {
    if (up.name !== "Link") continue;
    const address = linkAddress(up, doc) ?? "";
    const opens = /^[a-z][a-z0-9+.-]*:/i.test(address) && !isScript(address);
    return opens ? { address, from: up.from, to: up.to } : null;
  }
  return null;
}

/** A markdown link to a file in the vault, and where its source sits in the note. */
export interface FileLink {
  path: string;
  heading: string | null;
  from: number;
  to: number;
}

/**
 * The `Link` at or above `node` when it names a vault page or asset, else null. Separate from
 * `urlLinkAt`, since live preview asks that one too and must not follow files.
 */
export function fileLinkAt(node: SyntaxNode | null, doc: Source): FileLink | null {
  for (let up = node; up !== null; up = up.parent) {
    if (up.name === "Link") return fileLinkOf(up, doc);
  }
  return null;
}

function fileLinkOf(link: SyntaxNode, doc: Source): FileLink | null {
  const address = linkAddress(link, doc) ?? "";
  if (address === "" || /^[a-z][a-z0-9+.-]*:/i.test(address)) return null;
  // The fragment is not encoded, so `#page=3` and `#s1` come through as written.
  const hash = address.indexOf("#");
  const encoded = hash === -1 ? address : address.slice(0, hash);
  const heading = hash === -1 ? "" : address.slice(hash + 1);
  const path = decoded(encoded);
  if (path === null || !namesAFile(path)) return null;
  return { path, heading: heading === "" ? null : heading, from: link.from, to: link.to };
}

function decoded(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch (error) {
    // A stray `%` is a link that names nothing, not a note to fail on.
    if (error instanceof URIError) return null;
    throw error;
  }
}

/**
 * The vault path `relative` names from the folder of `note`, or null if it climbs above the root.
 * A link is read from the note's own folder, as Obsidian reads it.
 */
export function resolveFrom(note: string, relative: string): string | null {
  // A leading slash is refused, as the backend refuses it, rather than read from the root.
  if (relative.startsWith("/")) return null;
  const folders = note.split("/").slice(0, -1);
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") {
      folders.push(segment);
    } else if (folders.length > 0) {
      folders.pop();
    } else {
      return null;
    }
  }
  return folders.join("/");
}

/** The definitions of the note `top` heads, read once per parse. */
function definitions(top: SyntaxNode, doc: Source): Map<string, string> {
  const tree = top.tree;
  const known = tree === null ? undefined : scanned.get(tree);
  if (known !== undefined) return known;

  const found = new Map<string, string>();
  collect(top, doc, found);
  // CodeMirror parses a long note a slice at a time, so the tree can stop short of a
  // definition. Read the rest by line, unless the tree stops inside a fence.
  if (top.to < doc.length && (top.parent === null || top.parent.type.isTop) && !inFence(top)) {
    let start = top.to;
    while (start > 0 && doc.sliceString(start - 1, start) !== "\n") start--;
    scanLines(doc.sliceString(start), found);
  }
  if (tree !== null) scanned.set(tree, found);
  return found;
}

/** Whether the tree `top` heads stops inside a fence it has not seen close. */
function inFence(top: SyntaxNode): boolean {
  for (let node = top.resolveInner(top.to, -1); !node.type.isTop; node = node.parent ?? top) {
    if (node.name === "FencedCode") return node.getChildren("CodeMark").length < 2;
  }
  return false;
}

/**
 * The definitions in `text`, read by line as CommonMark would: none inside a
 * fence, and none continuing a paragraph, which a definition cannot interrupt.
 */
function scanLines(text: string, found: Map<string, string>): void {
  let fence: string | null = null;
  // Whether a block can start here: first, or after a blank line, heading or definition.
  let opens = true;
  for (const line of text.split("\n")) {
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      // Closed by a run of the same character, at least as long, alone.
      if (
        mark !== undefined &&
        mark[0] === fence[0] &&
        mark.length >= fence.length &&
        line.trim() === mark
      ) {
        fence = null;
      }
      opens = fence === null;
      continue;
    }
    if (mark !== undefined) {
      fence = mark;
      continue;
    }
    const match = opens ? DEFINITION.exec(line) : null;
    if (match?.[1] !== undefined && match[2] !== undefined) add(found, match[1], match[2]);
    opens = match !== null || line.trim() === "" || /^ {0,3}#{1,6}(\s|$)/.test(line);
  }
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
  if (key !== "" && !found.has(key)) found.set(key, unescaped(unbracket(url)));
}

/** A label as CommonMark matches it: case and runs of space do not count. */
function normal(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** `<url>` is the same address as `url`; the brackets are syntax (#443). */
function unbracket(url: string): string {
  return url.replace(/^<(.*)>$/, "$1");
}

/**
 * `text` with markdown's backslash escapes taken off, as CommonMark does in an address (#447).
 * The import adds them to a ruby's `*`, `_` and `[`.
 */
export function unescaped(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}
