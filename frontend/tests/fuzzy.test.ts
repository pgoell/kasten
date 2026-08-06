import { folderCandidates, rankCandidates, rankFolders, rankNotes } from "@/lib/fuzzy";

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

  it("will not spend one letter of a folder on two letters of the query", () => {
    // `daily/` carries a single `d`. A match leaves the letter it lands on
    // behind it, so the second `d` has the rest of the name to read from and
    // finds no `d` there.
    expect(rankFolders(PATHS, "dd")).toEqual([]);
  });

  it("will not read the query out of order", () => {
    // `projects/` holds both letters, the `s` last and the `p` first, so the
    // query reads into it backwards or not at all.
    expect(rankFolders(PATHS, "sp")).toEqual([]);
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

  it("reads a folder name carrying a character outside the basic plane", () => {
    // An emoji is one character and two code units. Count the query in one and
    // the name in the other and the two never meet, so a folder named with one
    // falls out of the list. `📁notes/` opens on the emoji and `my📁notes/`
    // buries it, a difference only a name counted in characters can see.
    expect(rankFolders(["📁notes/a.md", "my📁notes/b.md"], "📁n")).toEqual([
      "📁notes/",
      "my📁notes/",
    ]);
  });
});

describe("folderCandidates", () => {
  it("takes every folder on the way to a note, once each, in the order first seen", () => {
    // The fixture is deliberately out of order, so the expectation pins the
    // order the paths arrive in rather than a sorted one. A real listing is
    // sorted already, ranking decides what the prompt shows, and a sort here
    // would be work every open pays for nothing.
    const folders = folderCandidates([
      "zettel/inbox/seed.md",
      "archive/2025.md",
      "zettel/today.md",
    ]);

    expect(folders.map((folder) => folder.path)).toEqual(["zettel/", "zettel/inbox/", "archive/"]);
  });

  it("puts the name bonus out of reach, so a folder is scored on its whole path", () => {
    // A note is ranked partly on its last segment. A folder has no last segment
    // in that sense, its name being where the notes underneath begin, so it
    // opts out by naming a start no character can reach.
    for (const folder of folderCandidates(PATHS)) {
      expect(folder.nameAt).toBeGreaterThanOrEqual(folder.lower.length);
    }
  });
});

describe("rankCandidates", () => {
  it("ranks derived candidates exactly as rankFolders ranks the paths they came from", () => {
    // `rankFolders` is these two applied in turn, so every case above rides on
    // this holding: for the empty query the prompt opens with, for one that
    // matches, and for one that reads into nothing.
    const folders = folderCandidates(PATHS);

    expect(rankCandidates(folders, "")).toEqual(rankFolders(PATHS, ""));
    expect(rankCandidates(folders, "pk")).toEqual(rankFolders(PATHS, "pk"));
    expect(rankCandidates(folders, "zz")).toEqual(rankFolders(PATHS, "zz"));
  });
});

describe("rankNotes", () => {
  it("ranks the note the query names above one whose folder holds the letters", () => {
    // The tie the name bonus exists to break. Both paths open a segment on `a`
    // and carry `arch` as a run, so on folder rules alone they score the same
    // and `localeCompare` hands it to `archive/`, which is the wrong note.
    expect(rankNotes(["archive/2024/march.md", "projects/kasten/architecture.md"], "arch")).toEqual(
      ["projects/kasten/architecture.md", "archive/2024/march.md"],
    );
  });

  it("keeps a note the query only reads into by way of its folder", () => {
    // Ranked below a name match, but present: typing the folder is how you
    // narrow to a note whose name you cannot spell.
    expect(rankNotes(["daily/2026-08-05.md", "projects/kasten/api-design.md"], "kasten")).toEqual([
      "projects/kasten/api-design.md",
    ]);
  });

  it("returns every note in name order for the empty query", () => {
    // What the finder opens with. Nothing is typed, so nothing tells two notes
    // apart and the list is the one a reader can find a note in.
    expect(rankNotes(PATHS, "")).toEqual(PATHS);
  });

  it("drops a note the query does not read into", () => {
    expect(rankNotes(PATHS, "zz")).toEqual([]);
  });

  it("will not read the query out of order", () => {
    // The suffix is part of the path, so a query has `.md` to read from at the
    // end and nowhere else.
    expect(rankNotes(["index.md"], "mi")).toEqual([]);
  });
});
