/**
 * `[[note]]`, the link that names a note instead of a URL.
 *
 * Three pieces: the parser that finds one, the reader that takes the name off
 * the one under the cursor, and the rule that turns that name into a path. The
 * rendering is not here: the nodes carry no style of their own, and
 * `live-preview.ts` classes them like every other inline construct.
 */

import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { type EditorState, Facet } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { Element, InlineContext, MarkdownConfig } from "@lezer/markdown";
import { INBOX } from "@/lib/layout";

/** `[`, which the parser sees as a code point rather than a string. */
const BRACKET = 91;

/** `!`, which turns a link into an embed the way it turns one into an image. */
const BANG = 33;

/** How many characters open the link, and how many close it. */
const MARK = 2;

const SUFFIX = ".md";

/** A page of HTML in the vault, which a link names by its full file name. */
const PAGE = ".html";

/** The `[[name]]` opening at `pos`, as an element, or null where none does. */
function wikiLinkElement(cx: InlineContext, pos: number): Element | null {
  if (cx.char(pos) !== BRACKET || cx.char(pos + 1) !== BRACKET) return null;

  const rest = cx.slice(pos + MARK, cx.end);
  const end = rest.indexOf("]]");
  if (end === -1) return null;

  // A bracket or a line break before the close means the `[[` opened
  // nothing: a link names one note, and it names it on one line. A name
  // of only spaces is no name, and `[[]]` is a pair of empty brackets.
  const target = rest.slice(0, end);
  if (!target.trim() || /[[\]\n]/.test(target)) return null;

  const to = pos + MARK + end + MARK;
  return cx.elt("WikiLink", pos, to, [
    cx.elt("WikiLinkMark", pos, pos + MARK),
    cx.elt("WikiLinkMark", to - MARK, to),
  ]);
}

/**
 * `[[note]]`, which no markdown flavour we load parses, and `![[note]]`, the
 * note drawn in place.
 *
 * One element rather than a delimiter pair: what sits between the brackets is
 * a note's name, not prose, so nothing inside it is parsed as markdown.
 *
 * The embed wraps a whole `WikiLink` rather than being a node of its own
 * shape, so everything that reads a link under the cursor, `gf` first, reads
 * the one inside an embed without being told embeds exist.
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
 * What `[[name#heading|alias]]` is made of: the note, the heading in it, and
 * what to call the link. The bar is taken first, so an alias may carry a hash.
 *
 * In a table a bare bar ends the cell, so a link there writes it `\|`, as
 * Obsidian has it. The backslash is the table's, not the name's.
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

/**
 * Every note in the vault, carried on the editor state.
 *
 * A link is only a name until something says what the vault holds, and two
 * things here need to know: the completion that offers the notes, and the
 * rendering that marks a link to a note nobody has written. The route has the
 * listing and reconfigures this when it changes.
 *
 * The default is null and not an empty vault, and the difference matters: a
 * view that was told nothing, as the finder's preview pane is, must not call
 * every link in the note broken.
 */
export const vaultPaths = Facet.define<string[], string[] | null>({
  combine: (values) => values[0] ?? null,
});

/** The note named by the link enclosing the position, looking one way only. */
function enclosingLink(state: EditorState, pos: number, side: -1 | 1): string | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
  for (; node; node = node.parent) {
    if (node.name === "WikiLink") {
      return state.doc.sliceString(node.from + MARK, node.to - MARK).trim();
    }
  }
  return null;
}

/**
 * The note named by the `[[link]]` the position sits in, or null outside one.
 *
 * Both ways round the position, because the marks are off the screen and the
 * cursor cannot rest inside one. Forwards finds the link a cursor sitting where
 * the hidden `[[` ends has just entered; backwards finds the one it has just
 * left, which is where `$` lands on a line ending in a link and where the
 * caret is painted against the last letter of the name either way.
 */
export function wikiLinkAt(state: EditorState, pos: number): string | null {
  return enclosingLink(state, pos, 1) ?? enclosingLink(state, pos, -1);
}

/**
 * The vault path `[[target]]` names, whether or not a note is there yet.
 *
 * A bare name is looked for anywhere in the vault, because a wikilink names a
 * note and not a place: `[[borges]]` finds `reading/borges.md` from any note.
 * A target with a slash in it is a path, and is taken at its word. Either way
 * the answer is a path, so a name nothing answers to is the path the note
 * would be made at, and for a bare name that path is in the inbox.
 *
 * Only the name counts: `[[note#heading|alias]]` is a link to `note`. A link
 * with no name, `[[#heading]]`, is to the note it is written in, which this
 * cannot know, so it answers the empty path: no listing holds it, and every
 * caller that compares paths finds it links nowhere else.
 */
export function wikiLinkPath(target: string, paths: string[]): string {
  const { name } = splitTarget(target);
  if (name === "") return "";
  const path = name.endsWith(SUFFIX) || name.endsWith(PAGE) ? name : `${name}${SUFFIX}`;
  // A name says which note, never where it belongs, so following a link to one
  // nobody has written has to put it somewhere. The inbox is the folder for a
  // note with nowhere to be yet; a target spelling a path was taken at its word.
  return resolveIn(path, paths) ?? `${INBOX}/${path}`;
}

/**
 * The file in `paths` a full file name answers to, or null where none does.
 *
 * The lookup half of `wikiLinkPath`, apart so `![[shot.png]]` finds its image
 * by the same rule a link finds its note: exact first, a path with a slash at
 * its word, and otherwise a file of that name in any folder, ignoring case.
 */
export function resolveIn(path: string, paths: string[]): string | null {
  if (paths.includes(path) || path.includes("/")) return path;

  const name = path.toLowerCase();
  return (
    paths.find((other) => other.slice(other.lastIndexOf("/") + 1).toLowerCase() === name) ?? null
  );
}

/**
 * Whether the vault holds the note `[[target]]` names.
 *
 * A heading of the note the link is written in always lands: that note is
 * open, so it is there.
 */
export function wikiLinkLands(target: string, paths: string[]): boolean {
  return splitTarget(target).name === "" || paths.includes(wikiLinkPath(target, paths));
}

/** One `[[link]]`, spelled the way the parser above spells it. */
const LINK = /\[\[([^[\]\n]+)\]\]/g;

/**
 * Every note named by a link in `text`, in the order they were written.
 *
 * What the backlinks panel reads a search hit with. A line comes back from the
 * vault because it holds a note's name somewhere, and this is what tells the
 * line that links to it from the line that only mentions it.
 *
 * The pattern is the parser's rule rather than a looser one: a bracket or a
 * line break before the close means the `[[` opened nothing, and a name of only
 * spaces is no name.
 */
export function wikiLinkTargets(text: string): string[] {
  return [...text.matchAll(LINK)].map((match) => match[1] ?? "").filter((target) => target.trim());
}

/**
 * The line with its links written plainly: no brackets, and the name alone.
 *
 * For a list that draws a line rather than editing it. A row of the person card
 * is a line that links a person by construction, so the brackets are noise on
 * every row, and a link written as a path costs the row the words that say what
 * happened. The name is what a reader of `[[02 Projects/2026-09-28 Kickoff]]`
 * was going to read anyway. An alias is the name its writer chose to read, so
 * it wins, and a heading stays on the name it narrows.
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
 * Every note in the vault `text` links to, once each, in the order written.
 *
 * The other half of the backlinks panel, read off one note rather than off the
 * whole vault. Links to a note nobody has written yet are left out: the panel
 * is a list of notes, and there is no note there to list. The editor already
 * draws those dotted, and `gf` is what turns one into a note.
 */
export function outgoingLinks(text: string, paths: string[]): string[] {
  const found = new Set<string>();
  for (const target of wikiLinkTargets(text)) {
    const path = wikiLinkPath(target, paths);
    if (paths.includes(path)) found.add(path);
  }
  return [...found];
}

/**
 * What has been typed into an open `[[`, which is what a completion completes.
 *
 * Only the name: a `|` or `#` starts the alias or heading, which no note name
 * completes, and a table writes its bar `\|`, so a backslash ends it too.
 */
const TYPED = /\[\[[^[\]\n|#\\]*/;

/** What follows a name when the rest of the link is already written. */
const TAIL = /^(\]\]|\\?\||#)/;

/**
 * Every note in the vault, offered inside an open `[[`.
 *
 * The whole listing every time, unranked: CodeMirror scores the labels against
 * what has been typed and keeps the best, which is the same fuzzy match the
 * finder does by hand and one this does not have to write. `validFor` is what
 * keeps the next keystroke narrowing the list already on screen rather than
 * building it again.
 *
 * Registered on the markdown language rather than as a second `autocompletion`,
 * so it joins the one `basicSetup` already mounted instead of fighting it.
 */
export function wikiLinkCompletions(context: CompletionContext): CompletionResult | null {
  const paths = context.state.facet(vaultPaths);
  if (paths === null) return null;

  const open = context.matchBefore(TYPED);
  if (!open) return null;

  // Typing `[[` leaves the link open: close-brackets answers a `[` with
  // nothing in markdown. So the completion closes what it completes, unless
  // the rest of the link, the pair or an alias or heading before it, is
  // already sitting there waiting for a name.
  const closed = TAIL.test(context.state.sliceDoc(context.pos, context.pos + MARK));

  return {
    // Past the opening brackets: they are in the document already, and what a
    // completion replaces is only the name.
    from: open.from + MARK,
    options: paths.map((path) => {
      // A page keeps its `.html`: that is what tells `[[report.html]]` from
      // the `report` note beside it.
      const name = path.endsWith(SUFFIX) ? path.slice(0, -SUFFIX.length) : path;
      return { label: name, apply: closed ? name : `${name}]]`, type: "text" };
    }),
    validFor: /^[^[\]\n|#\\]*$/,
  };
}
