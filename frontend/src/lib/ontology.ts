/**
 * The vault's own vocabulary, read off the note that holds it.
 *
 * A note rather than a config file or a schema, so nothing validates a relation
 * and an unknown name works: it groups under its own spelling and nobody has to
 * ship a release to add one. What this reads is what the completion offers.
 */

import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { Facet } from "@codemirror/state";

/** Where the vocabulary lives, which the route reads and the completion offers. */
export const ONTOLOGY_NOTE = "99 Misc/01 Config/01 Agents/Ontology.md";

/** A section of the note. Only `Relations` is read; the types are offered nowhere. */
const SECTION = /^## +(.+?) *$/;

/** One entry: a list item at the left margin, the name, then a colon and the gloss. */
const ENTRY = /^- ([^:]+):/;

/**
 * The relation names the note lists under `## Relations`, in the order it lists them.
 *
 * A line it cannot read is skipped rather than reported, the way `parseViews`
 * skips one: the note is edited by hand, so it is half written most of the times
 * this reads it, and a paragraph in the middle of it is not a mistake.
 *
 * The heading is tracked, or the six type names would be offered as relations.
 * A second `## ` heading of any name ends the section, which is what stops the
 * types being read when they are written under the relations rather than over.
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
 * Every relation name the vault's ontology note lists, carried on the editor state.
 *
 * Null and not an empty vocabulary, for the reason `vaultTags` is: a view that
 * was told nothing offers nothing, rather than claiming the vault names none.
 */
export const vaultRelations = Facet.define<string[], string[] | null>({
  combine: (values) => values[0] ?? null,
});

/** What has been typed where a relation can start: the indent, the bullet, the name so far. */
const TYPED = /^ {0,3}(?:- )?([a-z-]*)$/;

/**
 * The vocabulary, offered where a relation line can begin.
 *
 * That position is rule 1 of the grammar and nothing else: the head of a line,
 * after up to three spaces and an optional `- `. Mid-line it offers nothing,
 * because `see dep` is prose and a relation cannot start there.
 *
 * Taking one inserts the separator and its space. The space is not optional in
 * the grammar, and typing it is the thing this exists to save.
 *
 * The names come off the note and from nowhere else. A hardcoded table would
 * drift from the note the moment somebody edits it, and completing off the
 * names already written in the vault would spread a typo instead of catching it.
 */
export function relationCompletions(context: CompletionContext): CompletionResult | null {
  const relations = context.state.facet(vaultRelations);
  if (relations === null) return null;

  const line = context.state.doc.lineAt(context.pos);
  const typed = TYPED.exec(line.text.slice(0, context.pos - line.from));
  if (typed?.[1] === undefined) return null;
  // An empty line is every line before it is anything, so this waits for a
  // letter the way `tagCompletions` waits for one after a hash.
  if (typed[1] === "" && !context.explicit) return null;

  return {
    from: context.pos - typed[1].length,
    options: relations.map((name) => ({ label: name, apply: `${name}:: `, type: "keyword" })),
    validFor: /^[a-z-]*$/,
  };
}
