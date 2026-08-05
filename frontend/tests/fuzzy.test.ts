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

  it("prefers a run of letters to the same letters scattered", () => {
    // Both folders open on `k`, so only the `n` right behind it tells them
    // apart. Leave the run unpaid and `kanban/` takes the tie on name.
    expect(rankFolders(["knowledge/graphs.md", "kanban/board.md"], "kn")).toEqual([
      "knowledge/",
      "kanban/",
    ]);
  });

  it("reads the query where it fits best, not where it first fits", () => {
    // `n` sits inside `reading` on the way to `notes`, and the match that
    // passes that one by to open `notes/` is the one worth ranking on.
    expect(rankFolders(["reading/notes/x.md", "runes/y.md"], "rn")).toEqual([
      "reading/notes/",
      "reading/",
      "runes/",
    ]);
  });

  it("drops a folder the query does not read into", () => {
    expect(rankFolders(PATHS, "zz")).toEqual([]);
  });

  it("orders two equally good folders by name", () => {
    // An empty query, which is what the prompt opens with, ties every folder,
    // and a list by name is the one a reader can find a folder in. Length is
    // not: `archive/` comes first though `z/` is shorter.
    expect(rankFolders(["archive/x.md", "z/y.md"], "")).toEqual(["archive/", "z/"]);
  });

  it("ignores the case of the query", () => {
    expect(rankFolders(PATHS, "DAILY")).toEqual(["daily/"]);
  });

  it("ignores the case of the folder", () => {
    expect(rankFolders(["Reading/borges.md"], "reading")).toEqual(["Reading/"]);
  });
});
