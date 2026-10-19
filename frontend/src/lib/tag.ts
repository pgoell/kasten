import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { Facet } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { MarkdownConfig } from "@lezer/markdown";
import { GLUED, LEADING_TAG, TAG_CHARS } from "@/lib/tag-rule";

/** `#`, which the parser sees as a code point rather than a string. */
const HASH = 35;

/** The rest of a link's text: up to a `]` that a `(` or a `[` follows. */
const LINK_TEXT = /^[^\]\n]*\][([]/;

/**
 * `#tag`, the way Obsidian writes one, by the rule in `tag-rule.ts` that the
 * todo pane and the decks read by too.
 *
 * A parser extension rather than a regex over the text, so the hash inside a
 * code span, a fenced block or a URL is left alone: inline parsers are never
 * asked about a range another parser has already taken. A link's text is the
 * exception, parsed inline before the `](` that makes it a link, so a hash
 * is refused while a `[` stands open and the next `]` opens an address or a
 * reference. A bracket that makes no link, `see [ #x` or `[[a #z`, keeps the
 * tag, as `tagsOf` does.
 *
 * Nothing is hidden and nothing stands in for the hash. A tag is what somebody
 * typed, so `live-preview.ts` colours it and leaves it on the screen whichever
 * mode the editor is in.
 */
export const Tag: MarkdownConfig = {
  defineNodes: ["Tag"],
  parseInline: [
    {
      name: "Tag",
      parse(cx, next, pos) {
        if (next !== HASH || GLUED.test(cx.slice(pos - 1, pos))) return -1;
        const rest = cx.slice(pos, cx.end);
        if (cx.hasOpenLink && LINK_TEXT.test(rest)) return -1;
        const match = LEADING_TAG.exec(rest);
        if (match === null) return -1;
        return cx.addElement(cx.elt("Tag", pos, pos + match[0].length));
      },
    },
  ],
};

/**
 * Every tag the vault holds, carried on the editor state.
 *
 * A tag is a word you are trying to spell the way you spelled it last time, and
 * nothing in one note knows how the others spell it. The route has the
 * vocabulary and reconfigures this as notes are written.
 *
 * Null and not an empty vault, for the reason `vaultPaths` is: a view that was
 * told nothing offers nothing, rather than claiming the vault has no tags.
 */
export const vaultTags = Facet.define<string[], string[] | null>({
  combine: (values) => values[0] ?? null,
});

/**
 * What has been typed into an open `#`, which is what a completion completes.
 * Any run of tag characters, numbers alone too, so `#1` already offers `#1on1`
 * though it draws no tag yet.
 */
const TYPED = new RegExp(`#${TAG_CHARS}*`, "u");

/** Where a hash is code, which the parser never draws as a tag. */
const CODE = new Set(["InlineCode", "FencedCode", "CodeBlock"]);

/** Whether `pos` sits in code, looked up the way the parser left it. */
function inCode(context: CompletionContext, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(context.state).resolveInner(pos, -1); node; ) {
    if (CODE.has(node.name)) return true;
    node = node.parent;
  }
  return false;
}

/**
 * Every tag in the vault, offered on an open `#`.
 *
 * The whole vocabulary every time, unranked, for the reason `wikiLinkCompletions`
 * hands over the whole listing: CodeMirror scores the labels against what has
 * been typed and keeps the best. The labels carry their hash, so the range
 * starts at the hash too and `#db` is scored against `#dbt` whole.
 *
 * Registered on the markdown language, so it joins the one `autocompletion`
 * `basicSetup` already mounted rather than fighting it.
 */
export function tagCompletions(context: CompletionContext): CompletionResult | null {
  const tags = context.state.facet(vaultTags);
  if (tags === null) return null;

  const open = context.matchBefore(TYPED);
  if (!open) return null;
  // The parser's rule, so nothing is offered where a tag would not be drawn.
  if (GLUED.test(context.state.sliceDoc(open.from - 1, open.from))) return null;
  if (inCode(context, open.to)) return null;

  // A hash alone at the start of a line is a heading being opened, which is
  // what that key is mostly reached for. One letter tells the two apart, and
  // the vault's own convention writes `#flashcards/aws` there, so this waits
  // for the letter rather than refusing the line.
  const line = context.state.doc.lineAt(open.from);
  const alone = open.text.length === 1 && line.text.slice(0, open.from - line.from).trim() === "";
  if (alone && !context.explicit) return null;

  return {
    from: open.from,
    options: tags.map((tag) => ({ label: tag, type: "text" })),
    validFor: TYPED,
  };
}
