import { readFileSync } from "node:fs";

import { CompletionContext } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { relationCompletions, relationNames, vaultRelations } from "@/lib/ontology";

/**
 * The note the backend writes, read off the asset itself rather than copied.
 *
 * A copy here would go stale the first time a relation is added to that file,
 * and this test would go on passing over text the vault no longer holds.
 */
const SHIPPED = readFileSync("../backend/src/kasten_backend/ontology.md", "utf-8");

describe("relationNames", () => {
  it("reads the seven the shipped note lists, in order", () => {
    expect(relationNames(SHIPPED)).toEqual([
      "about",
      "depends-on",
      "part-of",
      "supports",
      "contradicts",
      "cites",
      "answers",
    ]);
  });

  it("offers none of the types", () => {
    // The heading is tracked, or `Note` and `Book` would be offered as relations.
    const names = relationNames(SHIPPED);

    for (const type of ["Note", "Concept", "Source", "Periodic Note", "Book", "Reference"]) {
      expect(names).not.toContain(type);
    }
  });

  it("reads an empty relations section as no relations", () => {
    expect(relationNames("## Types\n\n- Note: a note\n\n## Relations\n")).toEqual([]);
  });

  it("reads a note with no relations section as no relations", () => {
    expect(relationNames("# Ontology\n\n## Types\n\n- Note: a note\n")).toEqual([]);
  });

  it("skips what it cannot read in a half written note", () => {
    // Edited by hand, so it is half written most of the times this reads it.
    const half = "## Relations\n\n### Draft\n\nSome prose about relations.\n\n- cites: quoted\n";

    expect(relationNames(half)).toEqual(["cites"]);
  });

  it("reads a note written with windows line endings", () => {
    // The backfill keeps the endings it finds, so a note edited on Windows
    // stays that way, and a heading with a `\r` on it would end the section
    // before it started.
    const windows = "## Relations\r\n\r\n- cites: quoted\r\n";

    expect(relationNames(windows)).toEqual(["cites"]);
  });

  it("stops at the next section", () => {
    const after = "## Relations\n\n- cites: quoted\n\n## Types\n\n- Note: a note\n";

    expect(relationNames(after)).toEqual(["cites"]);
  });
});

const RELATIONS = ["about", "depends-on", "part-of", "supports", "contradicts", "cites", "answers"];

/** What the editor offers with the caret at the end of `doc`. */
function complete(doc: string, relations?: string[], explicit = false) {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage }),
      ...(relations ? [vaultRelations.of(relations)] : []),
    ],
  });

  return relationCompletions(new CompletionContext(state, doc.length, explicit));
}

describe("relationCompletions", () => {
  it("offers the vocabulary where a relation can start", () => {
    const result = complete("dep", RELATIONS);

    expect(result?.options.map(({ label }) => label)).toEqual(RELATIONS);
    expect(result?.from).toBe(0);
  });

  it("completes from after the bullet", () => {
    const result = complete("- dep", RELATIONS);

    expect(result?.options).toHaveLength(RELATIONS.length);
    expect(result?.from).toBe("- ".length);
  });

  it("offers nothing four spaces in, which opens a code block", () => {
    expect(complete("    dep", RELATIONS)).toBeNull();
  });

  it("offers nothing mid-line, where a relation cannot start", () => {
    expect(complete("see dep", RELATIONS)).toBeNull();
  });

  it("holds off on an empty line until a letter is typed", () => {
    expect(complete("", RELATIONS)).toBeNull();
    expect(complete("", RELATIONS, true)?.options).toHaveLength(RELATIONS.length);
  });

  it("inserts the separator and its mandatory space", () => {
    const result = complete("dep", RELATIONS);
    const taken = result?.options.find(({ label }) => label === "depends-on");

    expect(taken?.apply).toBe("depends-on:: ");
  });

  it("offers nothing to a view that was told no vocabulary", () => {
    expect(complete("dep")).toBeNull();
  });

  it("offers nothing when the vocabulary is empty", () => {
    // Null rather than a result holding no options. CodeMirror caches an empty
    // result and reuses it while `validFor` holds, so a source that answered
    // before the note arrived would stay silent for the rest of the word.
    expect(complete("dep", [])).toBeNull();
  });
});
