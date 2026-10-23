import type { SearchHit } from "@/lib/api";
import { facets, filterHits, termRuns, topFolder } from "@/lib/search-facets";

function hit(path: string, tags?: string[]): SearchHit {
  return { path, line: 1, text: "line", tags };
}

describe("topFolder", () => {
  it("answers with the first folder of a nested path", () => {
    expect(topFolder("projects/kasten/todo.md")).toBe("projects");
  });

  it("answers with nothing for a note at the vault's root", () => {
    expect(topFolder("note.md")).toBe("");
  });
});

describe("facets", () => {
  const hits = [
    hit("projects/a.md", ["#reading"]),
    hit("projects/b.md", ["#reading", "#todo"]),
    hit("journal/c.md", ["#todo"]),
    hit("root.md"),
  ];

  it("orders folders and tags busiest first, then by name", () => {
    const found = facets(hits);

    expect(found.folders).toEqual([
      { name: "projects", count: 2 },
      { name: "", count: 1 },
      { name: "journal", count: 1 },
    ]);
    expect(found.tags).toEqual([
      { name: "#reading", count: 2 },
      { name: "#todo", count: 2 },
    ]);
  });

  it("counts a hit with no tags under no tag", () => {
    expect(facets([hit("root.md")]).tags).toEqual([]);
  });
});

describe("filterHits", () => {
  const hits = [
    hit("projects/a.md", ["#reading"]),
    hit("projects/b.md", ["#todo"]),
    hit("journal/c.md", ["#reading"]),
  ];

  it("keeps the hits inside the chosen folder", () => {
    expect(filterHits(hits, { folder: "projects", tag: null })).toEqual([hits[0], hits[1]]);
  });

  it("keeps the hits carrying the chosen tag", () => {
    expect(filterHits(hits, { folder: null, tag: "#reading" })).toEqual([hits[0], hits[2]]);
  });

  it("keeps only the hits that are in the folder and carry the tag", () => {
    expect(filterHits(hits, { folder: "projects", tag: "#reading" })).toEqual([hits[0]]);
  });

  it("lets every hit through when neither is chosen", () => {
    expect(filterHits(hits, { folder: null, tag: null })).toEqual(hits);
  });
});

describe("termRuns", () => {
  it("marks every occurrence of the term", () => {
    expect(termRuns("read and read", "read")).toEqual([
      { text: "read", term: true },
      { text: " and ", term: false },
      { text: "read", term: true },
    ]);
  });

  it("matches the term whatever the case", () => {
    expect(termRuns("Reading and READING", "reading")).toEqual([
      { text: "Reading", term: true },
      { text: " and ", term: false },
      { text: "READING", term: true },
    ]);
  });

  it("takes a regex character as a plain character", () => {
    // The dot in `a.b` is a dot, so `axb` is not a match.
    expect(termRuns("axb a.b", "a.b")).toEqual([
      { text: "axb ", term: false },
      { text: "a.b", term: true },
    ]);
  });

  it("gives the whole text as one run for a blank term", () => {
    expect(termRuns("some text", "  ")).toEqual([{ text: "some text", term: false }]);
  });

  it("finds the term after an emoji without shifting it", () => {
    expect(termRuns("🙂 reading", "reading")).toEqual([
      { text: "🙂 ", term: false },
      { text: "reading", term: true },
    ]);
  });
});
