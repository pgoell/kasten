import { describe, expect, it } from "vitest";
import { readRelation } from "@/lib/relation";

describe("readRelation", () => {
  it("reads a relation at the left margin", () => {
    expect(readRelation("depends-on:: [[Embeddings]]")).toEqual({
      name: "depends-on",
      target: "Embeddings",
    });
  });

  it("reads one indented by up to three spaces", () => {
    for (const indent of [" ", "  ", "   "]) {
      expect(readRelation(`${indent}depends-on:: [[Embeddings]]`)).toEqual({
        name: "depends-on",
        target: "Embeddings",
      });
    }
  });

  it("reads one behind a bullet, at the margin and indented", () => {
    for (const prefix of ["- ", " - ", "  - ", "   - "]) {
      expect(readRelation(`${prefix}supports:: [[GraphRAG paper]]`)).toEqual({
        name: "supports",
        target: "GraphRAG paper",
      });
    }
  });

  it("ignores the prose after the target", () => {
    expect(readRelation("contradicts:: [[Naive RAG]] and the paper says why")).toEqual({
      name: "contradicts",
      target: "Naive RAG",
    });
  });

  it("takes the first wikilink, so a second one is prose", () => {
    expect(readRelation("supports:: [[GraphRAG paper]] and [[Naive RAG]]")).toEqual({
      name: "supports",
      target: "GraphRAG paper",
    });
  });

  it("keeps a separator inside the target", () => {
    expect(readRelation("mentions:: [[std::vector]]")).toEqual({
      name: "mentions",
      target: "std::vector",
    });
  });

  it("refuses an indent of four spaces, which opens a code block", () => {
    expect(readRelation("    depends-on:: [[A]]")).toBeNull();
  });

  it("refuses an indent of a tab", () => {
    expect(readRelation("\tdepends-on:: [[A]]")).toBeNull();
  });

  it("refuses a bullet nested two levels deep", () => {
    expect(readRelation("    - depends-on:: [[A]]")).toBeNull();
  });

  it("refuses every bullet that is not `- `", () => {
    expect(readRelation("+ depends-on:: [[A]]")).toBeNull();
    expect(readRelation("* depends-on:: [[A]]")).toBeNull();
    expect(readRelation("1. depends-on:: [[A]]")).toBeNull();
    expect(readRelation("1) depends-on:: [[A]]")).toBeNull();
    expect(readRelation("- - depends-on:: [[A]]")).toBeNull();
  });

  it("refuses a task marker between the bullet and the name", () => {
    expect(readRelation("- [ ] depends-on:: [[A]]")).toBeNull();
  });

  it("refuses a bullet with no name behind it", () => {
    expect(readRelation("-:: [[A]]")).toBeNull();
  });

  it("refuses a wikilink in front of the separator", () => {
    expect(readRelation("[[A]] depends-on:: [[B]]")).toBeNull();
  });

  it("refuses a digit in the name", () => {
    expect(readRelation("depends2:: [[A]]")).toBeNull();
  });

  it("refuses an uppercase letter in the name", () => {
    expect(readRelation("Depends-on:: [[A]]")).toBeNull();
  });

  it("refuses a separator with no space after it", () => {
    expect(readRelation("depends-on::[[A]]")).toBeNull();
  });

  it("refuses prose between the separator and the target", () => {
    expect(readRelation("depends-on:: not really [[A]]")).toBeNull();
  });

  it("refuses an empty target", () => {
    expect(readRelation("depends-on:: [[   ]]")).toBeNull();
  });

  it("refuses a bracket in the target", () => {
    expect(readRelation("depends-on:: [[a[b]]")).toBeNull();
  });

  it("refuses a line with no wikilink", () => {
    expect(readRelation("depends-on:: Embeddings")).toBeNull();
  });

  it("refuses a table row", () => {
    expect(readRelation("| depends-on:: [[A]] |")).toBeNull();
  });

  it("refuses a footnote", () => {
    expect(readRelation("[^1]: depends-on:: [[A]]")).toBeNull();
  });

  it("refuses a scope operator in prose", () => {
    expect(readRelation("std::vector is fast")).toBeNull();
  });
});
