/**
 * The vault's own vocabulary, read off the note that holds it.
 *
 * A note rather than a config file or a schema, so nothing validates a relation
 * and an unknown name works: it groups under its own spelling and nobody has to
 * ship a release to add one. What this reads is what the completion offers.
 */

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
