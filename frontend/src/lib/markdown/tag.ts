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
 * `#tag` as Obsidian writes it, by the rule in `tag-rule.ts`. Inline, so code spans and URLs are
 * never seen by it. A link's text parses before its `](`, so a `#` in an open `[` is refused.
 * Nothing is hidden: the typed tag stays on screen, coloured by `live-preview.ts`.
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
 * Every tag in the vault. Null, not empty, when unset: no tags would claim the vault has none.
 */
export const vaultTags = Facet.define<string[], string[] | null>({
  combine: (values) => values[0] ?? null,
});

/** What is typed after an open `#`: any tag characters, so `#1` already offers `#1on1`. */
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
 * Every tag, offered on an open `#`. Unranked: CodeMirror scores the labels itself.
 * The labels carry their hash, so the range starts at the hash too.
 */
export function tagCompletions(context: CompletionContext): CompletionResult | null {
  const tags = context.state.facet(vaultTags);
  if (tags === null) return null;

  const open = context.matchBefore(TYPED);
  if (!open) return null;
  // The parser's rule, so nothing is offered where a tag would not be drawn.
  if (GLUED.test(context.state.sliceDoc(open.from - 1, open.from))) return null;
  if (inCode(context, open.to)) return null;

  // A lone `#` at line start is often a heading; `#flashcards/aws` is a tag: wait for a letter.
  const line = context.state.doc.lineAt(open.from);
  const alone = open.text.length === 1 && line.text.slice(0, open.from - line.from).trim() === "";
  if (alone && !context.explicit) return null;

  return {
    from: open.from,
    options: tags.map((tag) => ({ label: tag, type: "text" })),
    validFor: TYPED,
  };
}
