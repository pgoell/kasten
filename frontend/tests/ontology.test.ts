import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { relationNames } from "@/lib/ontology";

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

  it("stops at the next section", () => {
    const after = "## Relations\n\n- cites: quoted\n\n## Types\n\n- Note: a note\n";

    expect(relationNames(after)).toEqual(["cites"]);
  });
});
