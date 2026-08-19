import {
  bookNote,
  bookType,
  describeFolderPath,
  describeNotePath,
  importedNote,
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

describe("importedNote", () => {
  it("puts the file in the inbox under its own name", () => {
    expect(importedNote("Borges.md")).toBe("00 Inbox/Borges.md");
  });

  it("reads the suffix whatever its case, the picker filtering nothing", () => {
    expect(importedNote("Borges.MD")).toBe("00 Inbox/Borges.md");
  });

  it("takes the suffix off before the name is cut, not after", () => {
    // Otherwise the last three characters of a long name are spent on `.md`
    // and the note lands with half a word for a title.
    expect(importedNote(`${"a".repeat(80)}.md`)).toBe(`00 Inbox/${"a".repeat(80)}.md`);
  });

  it("flattens a name a folder full of notes brought with it", () => {
    // A picker hands back the file's own name and never a path, so this is the
    // name a reader typed a slash into. It files nothing in a folder nobody
    // asked for.
    expect(importedNote("projects/kasten.md")).toBe("00 Inbox/projects kasten.md");
  });

  it("answers null for a file whose name leaves nothing behind", () => {
    expect(importedNote("///.md")).toBeNull();
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

  it("files a pdf apart from the books, under its own suffix", () => {
    // The other folder, and it is not a filing whim: `02 Books` is a claim
    // about what the file is, and a pdf is as often a paper, a report or a
    // deck as it is a book.
    expect(bookNote("Attention Is All You Need.pdf")).toEqual({
      name: "Attention Is All You Need",
      book: "00 Inbox/02 Documents/Attention Is All You Need.pdf",
      note: "00 Inbox/02 Documents/Attention Is All You Need.md",
    });
  });

  it("reads a pdf's suffix in capitals, and files it under the canonical one", () => {
    // The suffix written is the format's own rather than the one that was
    // typed, so a vault of `.PDF` and `.pdf` files sorts as one kind.
    expect(bookNote("Grundzuege.PDF")).toEqual({
      name: "Grundzuege",
      book: "00 Inbox/02 Documents/Grundzuege.pdf",
      note: "00 Inbox/02 Documents/Grundzuege.md",
    });
  });

  it("never turns a pdf into a .pdf.epub", () => {
    // What the older cut did to every file it was handed: `.epub` went on the
    // name whatever it arrived as, so the upload was refused for bytes that
    // did not match a name nobody chose.
    expect(bookNote("Ulysses.pdf")?.book).not.toContain(".epub");
  });

  it("answers null for a file the reader cannot open at all", () => {
    // The picker's `accept` filters its default view and stops nothing, the
    // reader being free to switch it to all files, so this is the answer for
    // an `.mobi` chosen by hand.
    expect(bookNote("Ulysses.mobi")).toBeNull();
  });

  it("answers null for a file carrying no suffix at all", () => {
    expect(bookNote("Ulysses")).toBeNull();
  });

  it("answers null for a file whose name leaves nothing behind", () => {
    // A path the vault would refuse is not one to guess a name for. The bar
    // says so instead.
    expect(bookNote("///.epub")).toBeNull();
  });

  it("answers null for a pdf whose name leaves nothing behind", () => {
    expect(bookNote("///.pdf")).toBeNull();
  });
});

describe("bookType", () => {
  it("types an epub Book", () => {
    expect(bookType("00 Inbox/02 Books/Talk Like TED.epub")).toBe("Book");
  });

  it("types a pdf Source, which is what the ontology calls one", () => {
    expect(bookType("00 Inbox/02 Documents/Attention Is All You Need.pdf")).toBe("Source");
  });

  it("reads the suffix whatever its case", () => {
    expect(bookType("00 Inbox/02 Documents/Grundzuege.PDF")).toBe("Source");
  });

  it("falls back to Book for a suffix it does not know", () => {
    // The older of the two types, and the only one a stale answer can name
    // wrongly. Reachable if a format is added to the backend before it is
    // added here.
    expect(bookType("00 Inbox/02 Books/Ulysses.mobi")).toBe("Book");
  });
});
