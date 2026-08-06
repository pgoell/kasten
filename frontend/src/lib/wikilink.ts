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
import type { MarkdownConfig } from "@lezer/markdown";

/** `[`, which the parser sees as a code point rather than a string. */
const BRACKET = 91;

/** How many characters open the link, and how many close it. */
const MARK = 2;

const SUFFIX = ".md";

/**
 * `[[note]]`, which no markdown flavour we load parses.
 *
 * One element rather than a delimiter pair: what sits between the brackets is
 * a note's name, not prose, so nothing inside it is parsed as markdown.
 */
export const WikiLink: MarkdownConfig = {
  defineNodes: ["WikiLink", "WikiLinkMark"],
  parseInline: [
    {
      name: "WikiLink",
      parse(cx, next, pos) {
        if (next !== BRACKET || cx.char(pos + 1) !== BRACKET) return -1;

        const rest = cx.slice(pos + MARK, cx.end);
        const end = rest.indexOf("]]");
        if (end === -1) return -1;

        // A bracket or a line break before the close means the `[[` opened
        // nothing: a link names one note, and it names it on one line. A name
        // of only spaces is no name, and `[[]]` is a pair of empty brackets.
        const target = rest.slice(0, end);
        if (!target.trim() || /[[\]\n]/.test(target)) return -1;

        const to = pos + MARK + end + MARK;
        return cx.addElement(
          cx.elt("WikiLink", pos, to, [
            cx.elt("WikiLinkMark", pos, pos + MARK),
            cx.elt("WikiLinkMark", to - MARK, to),
          ]),
        );
      },
      // Ahead of the built-in, which would otherwise take the first `[` for a
      // markdown link and leave this nothing to open on.
      before: "Link",
    },
  ],
};

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
 * would be made at.
 */
export function wikiLinkPath(target: string, paths: string[]): string {
  const typed = target.trim();
  const path = typed.endsWith(SUFFIX) ? typed : `${typed}${SUFFIX}`;
  if (paths.includes(path) || path.includes("/")) return path;

  const name = path.toLowerCase();
  const found = paths.find(
    (other) => other.slice(other.lastIndexOf("/") + 1).toLowerCase() === name,
  );
  return found ?? path;
}

/** Whether the vault holds the note `[[target]]` names. */
export function wikiLinkLands(target: string, paths: string[]): boolean {
  return paths.includes(wikiLinkPath(target, paths));
}

/** What has been typed into an open `[[`, which is what a completion completes. */
const TYPED = /\[\[[^[\]\n]*/;

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
  // the pair is already sitting there waiting for a name.
  const closed = context.state.sliceDoc(context.pos, context.pos + MARK) === "]]";

  return {
    // Past the opening brackets: they are in the document already, and what a
    // completion replaces is only the name.
    from: open.from + MARK,
    options: paths.map((path) => {
      const name = path.slice(0, -SUFFIX.length);
      return { label: name, apply: closed ? name : `${name}]]`, type: "text" };
    }),
    validFor: /^[^[\]\n]*$/,
  };
}
