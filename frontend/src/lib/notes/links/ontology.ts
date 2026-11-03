/**
 * The vault's own relation names, read off its ontology note. An unknown name still works:
 * nothing validates the note, so a new relation needs no release.
 */

import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { Facet } from "@codemirror/state";

/** Where the vocabulary lives, inside `KASTEN_CONFIG_PATH`. */
export { ONTOLOGY_NOTE } from "@/lib/layout";

/** A section of the note. Only `Relations` is read; the types are offered nowhere. */
const SECTION = /^## +(.+?)[ \t\r]*$/;

/** One entry: a list item at the left margin, the name, then a colon and the gloss. */
const ENTRY = /^- ([^:]+):/;

/**
 * The relation names listed under `## Relations`, in order. Unreadable lines are skipped,
 * since the note is edited by hand. Any other `## ` heading ends the section.
 * A `\r` on a heading is allowed, for a note with Windows line endings.
 */
export function relationNames(text: string): string[] {
  const names: string[] = [];
  let inside = false;

  for (const line of text.split("\n")) {
    const heading = SECTION.exec(line);
    if (heading?.[1] !== undefined) {
      inside = heading[1] === "Relations";
      continue;
    }
    if (!inside) continue;

    const entry = ENTRY.exec(line);
    if (entry?.[1] !== undefined) names.push(entry[1].trim());
  }

  return names;
}

/**
 * Every relation name the ontology note lists. Null, not empty, when unread, as `vaultTags`
 * is: an empty list would claim the vault names none.
 */
export const vaultRelations = Facet.define<string[], string[] | null>({
  combine: (values) => values[0] ?? null,
});

/** What has been typed where a relation can start: the indent, the bullet, the name so far. */
const TYPED = /^ {0,3}(?:- )?([a-z-]*)$/;

/**
 * The vocabulary, offered only at a line head, where a relation can start. The names come from
 * the note alone: a table would drift, and names already in the vault would spread a typo.
 */
export function relationCompletions(context: CompletionContext): CompletionResult | null {
  const relations = context.state.facet(vaultRelations);
  // Null, not an empty result: CodeMirror reuses a result while `validFor` holds, so an
  // early empty one would offer nothing for the rest of the word.
  if (relations === null || relations.length === 0) return null;

  const line = context.state.doc.lineAt(context.pos);
  const typed = TYPED.exec(line.text.slice(0, context.pos - line.from));
  if (typed?.[1] === undefined) return null;
  // A bare line waits for a letter, as `tagCompletions` does, unless asked for.
  if (typed[1] === "" && !context.explicit) return null;

  return {
    from: context.pos - typed[1].length,
    options: relations.map((name) => ({ label: name, apply: `${name}:: `, type: "keyword" })),
    validFor: /^[a-z-]*$/,
  };
}
