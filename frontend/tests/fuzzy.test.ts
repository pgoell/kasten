import { rankFolders } from "@/lib/fuzzy";

// The list the file tree's tests run on, so the folders ranked here are the
// ones a real vault listing yields.
const PATHS = [
  "daily/2026-08-04.md",
  "daily/2026-08-05.md",
  "index.md",
  "projects/kasten.md",
  "projects/kasten/api-design.md",
];

describe("rankFolders", () => {
  it("takes every folder on the way to a note, once each", () => {
    // `projects/kasten/` is a folder in its own right, and the two daily notes
    // name one folder between them.
    expect(rankFolders(PATHS, "")).toEqual(["daily/", "projects/", "projects/kasten/"]);
  });

  it("ranks the folder the query names above one holding the letters by chance", () => {
    expect(rankFolders([...PATHS, "data/family/notes.md"], "daily")).toEqual([
      "daily/",
      "data/family/",
    ]);
  });

  it("prefers letters that open a segment to letters buried in one", () => {
    // `p` starts `projects/kasten/` and `k` follows its slash, while `sparks/`
    // has both mid-word.
    expect(rankFolders([...PATHS, "sparks/notes.md"], "pk")).toEqual([
      "projects/kasten/",
      "sparks/",
    ]);
  });

  it("drops a folder the query does not read into", () => {
    expect(rankFolders(PATHS, "zz")).toEqual([]);
  });

  it("puts the shorter of two equally good folders first", () => {
    expect(rankFolders(PATHS, "projects")).toEqual(["projects/", "projects/kasten/"]);
  });

  it("ignores the case of the query", () => {
    expect(rankFolders(PATHS, "DAILY")).toEqual(["daily/"]);
  });

  it("ignores the case of the folder", () => {
    expect(rankFolders(["Reading/borges.md"], "reading")).toEqual(["Reading/"]);
  });
});
