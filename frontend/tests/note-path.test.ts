import {
  bookNote,
  bookPath,
  describeFolderPath,
  describeNotePath,
  safeName,
} from "@/lib/note-path";

const PATHS = ["daily/2026-08-05.md", "index.md", "projects/kasten/api-design.md"];

describe("describeNotePath", () => {
  it("has nothing to say about an empty input", () => {
    expect(describeNotePath("", PATHS)).toEqual({ kind: "empty" });
  });

  it("takes an input of only whitespace for an empty one", () => {
    expect(describeNotePath("   ", PATHS)).toEqual({ kind: "empty" });
  });

  it("trims what is typed around the path", () => {
    expect(describeNotePath("  kasten  ", PATHS)).toEqual({ kind: "create", path: "kasten.md" });
  });

  it("takes a lone slash for an empty input", () => {
    expect(describeNotePath("/", [])).toEqual({ kind: "empty" });
  });

  it("takes a pair of slashes for an empty input", () => {
    expect(describeNotePath("//", [])).toEqual({ kind: "empty" });
  });

  it("waits for a name when the input ends in a slash", () => {
    expect(describeNotePath("reading/", PATHS)).toEqual({
      kind: "blocked",
      reason: "name the note",
    });
  });

  it("blocks a name starting with a dot", () => {
    expect(describeNotePath(".hidden", PATHS)).toEqual({
      kind: "blocked",
      reason: "a name cannot start with a dot",
    });
  });

  it("blocks a folder starting with a dot", () => {
    expect(describeNotePath(".jj/note", PATHS)).toEqual({
      kind: "blocked",
      reason: "a name cannot start with a dot",
    });
  });

  it("blocks a dot below a folder, not only at the front", () => {
    expect(describeNotePath("notes/.draft", PATHS)).toEqual({
      kind: "blocked",
      reason: "a name cannot start with a dot",
    });
  });

  it("blocks a note asked for inside a note", () => {
    expect(describeNotePath("index.md/note", PATHS)).toEqual({
      kind: "blocked",
      reason: "a note cannot be a folder",
    });
  });

  it("blocks a note inside a note deeper in the vault", () => {
    expect(describeNotePath("daily/2026-08-05.md/note", PATHS)).toEqual({
      kind: "blocked",
      reason: "a note cannot be a folder",
    });
  });

  it("appends .md to a bare name", () => {
    expect(describeNotePath("kasten", PATHS)).toEqual({ kind: "create", path: "kasten.md" });
  });

  it("leaves an .md that is already there", () => {
    expect(describeNotePath("kasten.md", PATHS)).toEqual({ kind: "create", path: "kasten.md" });
  });

  it("appends .md after any other suffix", () => {
    // The vault holds markdown, so a `.txt` is part of the name and not a
    // second guess at the file type.
    expect(describeNotePath("kasten.txt", PATHS)).toEqual({
      kind: "create",
      path: "kasten.txt.md",
    });
  });

  it("opens a note the vault already has", () => {
    expect(describeNotePath("index", PATHS)).toEqual({ kind: "open", path: "index.md" });
  });

  it("opens a note named in full", () => {
    expect(describeNotePath("daily/2026-08-05.md", PATHS)).toEqual({
      kind: "open",
      path: "daily/2026-08-05.md",
    });
  });

  it("names the folder a new note would bring with it", () => {
    expect(describeNotePath("reading/borges", PATHS)).toEqual({
      kind: "create",
      path: "reading/borges.md",
      newFolder: "reading/",
    });
  });

  it("names no folder when the one asked for is already there", () => {
    expect(describeNotePath("daily/note", PATHS)).toEqual({
      kind: "create",
      path: "daily/note.md",
    });
  });

  it("names a new folder another folder's name only starts with", () => {
    // `readings/` is not `reading/`, and the trailing slash on the folder is
    // what keeps the prefix test on a segment boundary.
    expect(describeNotePath("reading/borges", ["readings/kant.md"])).toEqual({
      kind: "create",
      path: "reading/borges.md",
      newFolder: "reading/",
    });
  });

  it("reads a doubled slash as the folder the vault already has", () => {
    expect(describeNotePath("ideas//note", ["ideas/x.md"])).toEqual({
      kind: "create",
      path: "ideas/note.md",
    });
  });

  it("drops a leading slash from a note at the vault root", () => {
    expect(describeNotePath("/kasten", [])).toEqual({ kind: "create", path: "kasten.md" });
  });

  it("names the new folder once the slashes are tidied", () => {
    expect(describeNotePath("/reading//borges", [])).toEqual({
      kind: "create",
      path: "reading/borges.md",
      newFolder: "reading/",
    });
  });
});

describe("describeFolderPath", () => {
  /** The folder being moved, which is `daily/` in most of these. */
  const SOURCE = "daily";

  it("has nothing to say about an empty input", () => {
    expect(describeFolderPath("", PATHS, SOURCE)).toEqual({ kind: "empty" });
  });

  it("takes a lone slash for an empty input", () => {
    expect(describeFolderPath("/", PATHS, SOURCE)).toEqual({ kind: "empty" });
  });

  it("moves a folder to a name the vault does not have", () => {
    expect(describeFolderPath("journal", PATHS, SOURCE)).toEqual({
      kind: "create",
      path: "journal",
    });
  });

  it("trims what is typed around the path", () => {
    expect(describeFolderPath("  journal  ", PATHS, SOURCE)).toEqual({
      kind: "create",
      path: "journal",
    });
  });

  it("drops the trailing slash the folder list completes with", () => {
    // Tab folds a row in whole, slash and all, and Enter on that names the
    // folder rather than waiting for more.
    expect(describeFolderPath("journal/", PATHS, SOURCE)).toEqual({
      kind: "create",
      path: "journal",
    });
  });

  it("tidies doubled and leading slashes the way a note's path is tidied", () => {
    expect(describeFolderPath("/archive//journal", PATHS, SOURCE)).toEqual({
      kind: "create",
      path: "archive/journal",
    });
  });

  it("adds no .md, because a folder is not a note", () => {
    expect(describeFolderPath("archive/2026", PATHS, SOURCE)).toEqual({
      kind: "create",
      path: "archive/2026",
    });
  });

  it("blocks a name starting with a dot", () => {
    expect(describeFolderPath(".jj", PATHS, SOURCE)).toEqual({
      kind: "blocked",
      reason: "a name cannot start with a dot",
    });
  });

  it("blocks a dot below a folder, not only at the front", () => {
    expect(describeFolderPath("archive/.hidden", PATHS, SOURCE)).toEqual({
      kind: "blocked",
      reason: "a name cannot start with a dot",
    });
  });

  it("blocks a folder asked for inside a note", () => {
    expect(describeFolderPath("index.md/archive", PATHS, SOURCE)).toEqual({
      kind: "blocked",
      reason: "a note cannot be a folder",
    });
  });

  it("blocks a folder landing on a note", () => {
    expect(describeFolderPath("index.md", PATHS, SOURCE)).toEqual({
      kind: "blocked",
      reason: "a note is already there",
    });
  });

  it("blocks a folder moved inside itself", () => {
    expect(describeFolderPath("daily/archive", PATHS, SOURCE)).toEqual({
      kind: "blocked",
      reason: "a folder cannot move inside itself",
    });
  });

  it("allows a folder whose name only starts with the source's", () => {
    // `dailies` is not inside `daily`, and the slash is what keeps the test on
    // a segment boundary.
    expect(describeFolderPath("dailies", PATHS, SOURCE)).toEqual({
      kind: "create",
      path: "dailies",
    });
  });

  it("reads a folder the vault already has as one it cannot take", () => {
    expect(describeFolderPath("projects", PATHS, SOURCE)).toEqual({
      kind: "open",
      path: "projects",
    });
  });

  it("reads a folder nested inside another as one the vault already has", () => {
    expect(describeFolderPath("projects/kasten", PATHS, SOURCE)).toEqual({
      kind: "open",
      path: "projects/kasten",
    });
  });

  it("reads the folder's own path as the one it is already at", () => {
    // Not a collision: leaving a name alone is nothing to do, and the prompt
    // closes on it rather than refusing.
    expect(describeFolderPath("daily", PATHS, SOURCE)).toEqual({ kind: "open", path: "daily" });
  });
});

describe("bookPath", () => {
  it("swaps the note's suffix for the book's", () => {
    expect(bookPath("20 Literature/Books/DDIA.md")).toBe("20 Literature/Books/DDIA.epub");
  });

  it("leaves a dot in a folder name alone", () => {
    expect(bookPath("a.b/c.md")).toBe("a.b/c.epub");
  });
});

describe("safeName", () => {
  it("keeps a name the vault will take", () => {
    expect(safeName("Talk Like TED")).toBe("Talk Like TED");
  });

  it("takes out what a path or a wikilink refuses", () => {
    expect(safeName("Talk Like TED: 9 Secrets [2nd]")).toBe("Talk Like TED 9 Secrets 2nd");
  });

  it("takes off leading and trailing dots, which the vault refuses", () => {
    expect(safeName("...hidden.")).toBe("hidden");
  });

  it("cuts a name that runs long", () => {
    expect(safeName("a".repeat(200))).toHaveLength(80);
  });

  it("answers empty for a name with nothing left in it", () => {
    expect(safeName("///")).toBe("");
  });
});

describe("bookNote", () => {
  it("puts the pair in the inbox under the file's own name", () => {
    expect(bookNote("Talk Like TED.epub")).toEqual({
      name: "Talk Like TED",
      book: "00 Inbox/02 Books/Talk Like TED.epub",
      note: "00 Inbox/02 Books/Talk Like TED.md",
    });
  });

  it("reads the suffix whatever its case, the picker filtering nothing", () => {
    expect(bookNote("DDIA.EPUB")?.name).toBe("DDIA");
  });

  it("keeps a name a file kept dots in", () => {
    expect(bookNote("vol.2 of 3.epub")?.name).toBe("vol.2 of 3");
  });

  it("answers null for a file whose name leaves nothing behind", () => {
    // A path the vault would refuse is not one to guess a name for. The bar
    // says so instead.
    expect(bookNote("///.epub")).toBeNull();
  });
});
