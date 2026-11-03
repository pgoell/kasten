/**
 * `[[note]]`, the link that names a note instead of a URL. Rendering lives in
 * `live-preview-inline.ts`, which classes the nodes like every other inline construct.
 */

import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, Facet } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { Element, InlineContext, MarkdownConfig } from "@lezer/markdown";
import { INBOX } from "@/lib/layout";

/** `[`, which the parser sees as a code point rather than a string. */
const BRACKET = 91;

/** `!`, which turns a link into an embed the way it turns one into an image. */
const BANG = 33;

const MARK = 2;

const SUFFIX = ".md";

/**
 * Suffixes that make a link name a file, not a note. The backend's `FILE_SUFFIXES` copies
 * this list; `backend/tests/fixtures/link_paths.json` holds the two together.
 */
export const FILE_SUFFIXES = [
  ".html",
  ".epub",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".mp3",
  ".m4a",
  ".ogg",
  ".wav",
];

/** Whether a link's name is a file, not a note: any case, last path segment only. */
export function namesAFile(name: string): boolean {
  const last = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
  return FILE_SUFFIXES.some((suffix) => last.endsWith(suffix));
}

/** The `[[name]]` opening at `pos`, as an element, or null where none does. */
function wikiLinkElement(cx: InlineContext, pos: number): Element | null {
  if (cx.char(pos) !== BRACKET || cx.char(pos + 1) !== BRACKET) return null;

  const rest = cx.slice(pos + MARK, cx.end);
  const end = rest.indexOf("]]");
  if (end === -1) return null;

  // A bracket or a line break before the close means the `[[` opened nothing.
  const target = rest.slice(0, end);
  if (!target.trim() || /[[\]\n]/.test(target)) return null;

  const to = pos + MARK + end + MARK;
  return cx.elt("WikiLink", pos, to, [
    cx.elt("WikiLinkMark", pos, pos + MARK),
    cx.elt("WikiLinkMark", to - MARK, to),
  ]);
}

/**
 * `[[note]]`, which no markdown flavour we load parses, and `![[note]]`, the note drawn in
 * place. One element, not a delimiter pair, so the name is never read as markdown. An embed
 * wraps a whole `WikiLink`, so `gf` reads the link inside it unchanged.
 */
export const WikiLink: MarkdownConfig = {
  defineNodes: ["WikiLink", "WikiLinkMark", "Embed", "EmbedMark"],
  parseInline: [
    {
      name: "WikiLink",
      parse(cx, next, pos) {
        if (next !== BRACKET) return -1;
        const link = wikiLinkElement(cx, pos);
        return link === null ? -1 : cx.addElement(link);
      },
      // Ahead of the built-in, which would otherwise take the first `[` for a
      // markdown link and leave this nothing to open on.
      before: "Link",
    },
    {
      name: "Embed",
      parse(cx, next, pos) {
        if (next !== BANG) return -1;
        const link = wikiLinkElement(cx, pos + 1);
        if (link === null) return -1;
        return cx.addElement(
          cx.elt("Embed", pos, link.to, [cx.elt("EmbedMark", pos, pos + 1), link]),
        );
      },
      // Ahead of the image, which reads `![` as its own opening and holds the
      // link it finds inside as an image's alt text.
      before: "Image",
    },
  ],
};

/**
 * Splits `name#heading|alias`. The bar is taken first, so an alias may carry a hash. A table
 * writes its bar `\|`; the backslash is the table's, not the name's.
 */
export function splitTarget(target: string): {
  name: string;
  heading: string | null;
  alias: string | null;
} {
  const bar = target.indexOf("|");
  const named = bar === -1 ? target : target.slice(0, bar).replace(/\\$/, "");
  const alias = bar === -1 ? null : target.slice(bar + 1).trim() || null;
  const hash = named.indexOf("#");
  const name = (hash === -1 ? named : named.slice(0, hash)).trim();
  const heading = hash === -1 ? null : named.slice(hash + 1).trim() || null;
  return { name, heading, alias };
}

/** The page a `page=N` heading names, from 1 up. Undefined for anything else. */
export function pdfPage(heading: string | null): number | undefined {
  const page = Number(/^page=(\d+)$/.exec(heading ?? "")?.[1]);
  return page >= 1 ? page : undefined;
}

/**
 * Every note in the vault, carried on the editor state. Null until told, not empty: a view told
 * nothing, like the finder's preview, must not call every link in the note broken.
 */
export const vaultPaths = Facet.define<string[], string[] | null>({
  combine: (values) => values[0] ?? null,
});

/**
 * How long `gf` may parse to reach a link, in ms. A new state parses only the first few thousand
 * characters, so a link deep in a long note is not in the tree yet (#628). Longer than
 * CodeMirror's 50 ms default, since it is a key press, and rare.
 */
const FOLLOW_PARSE_MS = 200;

/** The note named by the link enclosing the position, looking one way only. */
function enclosingLink(state: EditorState, pos: number, side: -1 | 1): string | null {
  // To the end of the line and not just the cursor, so a link that opens at
  // the cursor is in the tree whole whatever the parser does with a line.
  const upto = state.doc.lineAt(pos).to;
  const tree = ensureSyntaxTree(state, upto, FOLLOW_PARSE_MS) ?? syntaxTree(state);
  let node: SyntaxNode | null = tree.resolveInner(pos, side);
  for (; node; node = node.parent) {
    if (node.name === "WikiLink") {
      return state.doc.sliceString(node.from + MARK, node.to - MARK).trim();
    }
  }
  return null;
}

/**
 * The note named by the `[[link]]` at `pos`, or null. Both ways round `pos`, since the marks are
 * off screen and the cursor cannot rest inside one. No `[[` on the line answers at once (#638).
 */
export function wikiLinkAt(state: EditorState, pos: number): string | null {
  if (!state.doc.lineAt(pos).text.includes("[[")) return null;
  return enclosingLink(state, pos, 1) ?? enclosingLink(state, pos, -1);
}

/**
 * The vault path `[[target]]` names, whether or not a note is there yet. A bare name is looked
 * for in any folder, a name with a slash is taken at its word, and one nothing answers to goes
 * in the inbox. `[[#heading]]` names no note and gives "". The backend's `named_path` agrees.
 */
export function wikiLinkPath(target: string, paths: string[]): string {
  const { name } = splitTarget(target);
  if (name === "") return "";
  const path = namesAFile(name) || name.endsWith(SUFFIX) ? name : `${name}${SUFFIX}`;
  // A link to a note nobody has written needs a home: the inbox, unless the target spelled a path.
  return resolveIn(path, paths) ?? `${INBOX}/${path}`;
}

/**
 * The file in `paths` that a full file name answers to, or null. Exact first, a path at its
 * word, then a file of that name in any folder, ignoring case.
 */
export function resolveIn(path: string, paths: string[]): string | null {
  if (paths.includes(path) || path.includes("/")) return path;

  const name = path.toLowerCase();
  return (
    paths.find((other) => other.slice(other.lastIndexOf("/") + 1).toLowerCase() === name) ?? null
  );
}

/**
 * Whether the vault holds the note `[[target]]` names. A `[[#heading]]` link always lands,
 * since it names the open note.
 */
export function wikiLinkLands(target: string, paths: string[]): boolean {
  return splitTarget(target).name === "" || paths.includes(wikiLinkPath(target, paths));
}

/** One `[[link]]`, spelled the way the parser above spells it. */
const LINK = /\[\[([^[\]\n]+)\]\]/g;

/**
 * Every note a `[[link]]` in `text` names, in the order written. The pattern is the parser's
 * rule, so a bracket or a line break before the close, or a name of only spaces, is no link.
 */
export function wikiLinkTargets(text: string): string[] {
  return [...text.matchAll(LINK)].map((match) => match[1] ?? "").filter((target) => target.trim());
}

/**
 * The line with each link as plain text: the alias if it has one, else the name's last segment
 * with any heading after it. For rows that draw a line and never edit it.
 */
export function plainLinks(text: string): string {
  return text.replace(LINK, (_, target: string) => {
    const { name, heading, alias } = splitTarget(target);
    if (alias !== null) return alias;
    const short = name.slice(name.lastIndexOf("/") + 1);
    return heading === null ? short : `${short}#${heading}`;
  });
}

/**
 * Every existing note `text` links to, once each, in order. Links to notes nobody has written are
 * left out: there is no note to list, and the editor already draws those dotted.
 */
export function outgoingLinks(text: string, paths: string[]): string[] {
  const found = new Set<string>();
  for (const target of wikiLinkTargets(text)) {
    const path = wikiLinkPath(target, paths);
    if (paths.includes(path)) found.add(path);
  }
  return [...found];
}

/** What is typed into an open `[[`: a `|`, `#` or `\` ends the name, as the alias or heading. */
const TYPED = /\[\[[^[\]\n|#\\]*/;

/** The rest of a link already closed after its name, which stops the completion adding `]]`. */
const TAIL = /^(?:\]\]|(?:\\?\||#)[^[\]\n]*\]\])/;

/**
 * Every note in the vault, offered inside an open `[[`: the whole list, unranked, since CodeMirror
 * fuzzy-matches it. Registered on the markdown language, so it joins the `basicSetup` completion
 * rather than fighting it.
 */
export function wikiLinkCompletions(context: CompletionContext): CompletionResult | null {
  const paths = context.state.facet(vaultPaths);
  if (paths === null) return null;

  const open = context.matchBefore(TYPED);
  if (!open) return null;

  // Typing `[[` leaves the link open, since close-brackets does nothing in markdown. The
  // completion closes it unless the rest of the link is already written.
  const closed = TAIL.test(
    context.state.sliceDoc(context.pos, context.state.doc.lineAt(context.pos).to),
  );

  return {
    // The brackets are already typed, so the completion replaces only the name.
    from: open.from + MARK,
    options: paths.map((path) => {
      // A page or an asset keeps its suffix, to tell it from the `report` note beside it.
      const name = path.endsWith(SUFFIX) ? path.slice(0, -SUFFIX.length) : path;
      return { label: name, apply: closed ? name : `${name}]]`, type: "text" };
    }),
    validFor: /^[^[\]\n|#\\]*$/,
  };
}
